export const APP_PREFIX = 'research';
export const CLOUD_PREFIX = 'cloud';
export const CREDENTIALS_PREFIX = 'credentials';

export interface OPFSFile {
    name: string;
    path: string;
    size: number;
    lastModified: Date;
}

export interface OPFSFileWithContent {
    name: string;
    path: string;
    size: number;
    lastModified: Date;
    getContent: () => Promise<string>;
}

export interface OPFSDirectory {
    name: string;
    path: string;
    lastModified: Date;
}

let rootDirHandle: FileSystemDirectoryHandle | null = null;
let appDirHandle: FileSystemDirectoryHandle | null = null;
let migrationDone = false;

async function initRoot(): Promise<FileSystemDirectoryHandle> {
    if (!('storage' in navigator && 'getDirectory' in navigator.storage)) {
        throw new Error('OPFS is not supported in this browser');
    }
    if (rootDirHandle) return rootDirHandle;
    rootDirHandle = await navigator.storage.getDirectory();
    return rootDirHandle;
}

export async function isOpfsReady(): Promise<boolean> {
    try {
        await initRoot();
        return true;
    } catch {
        return false;
    }
}

/**
 * Returns the app root directory handle (/research/).
 * Triggers one-time migration on first call.
 */
export async function getOPFSHandle(): Promise<FileSystemDirectoryHandle> {
    if (appDirHandle) return appDirHandle;

    const root = await initRoot();
    if (!migrationDone) {
        await migrateToNamespacedPaths();
        migrationDone = true;
    }
    appDirHandle = await root.getDirectoryHandle(APP_PREFIX, { create: true });
    return appDirHandle;
}

/**
 * Returns the cloud settings directory handle (/cloud/).
 */
export async function getCloudHandle(): Promise<FileSystemDirectoryHandle> {
    const root = await initRoot();
    return await root.getDirectoryHandle(CLOUD_PREFIX, { create: true });
}

/**
 * Returns the credentials directory handle (/credentials/).
 */
export async function getCredentialsHandle(): Promise<FileSystemDirectoryHandle> {
    const root = await initRoot();
    return await root.getDirectoryHandle(CREDENTIALS_PREFIX, { create: true });
}

async function copyEntries(
    src: FileSystemDirectoryHandle,
    dest: FileSystemDirectoryHandle
): Promise<void> {
    for await (const [name, handle] of src) {
        if (handle.kind === 'file') {
            const fileHandle = handle as FileSystemFileHandle;
            const file = await fileHandle.getFile();
            const content = await file.text();
            const newFile = await dest.getFileHandle(name, { create: true });
            const writable = await newFile.createWritable();
            await writable.write(content);
            await writable.close();
        } else if (handle.kind === 'directory') {
            const subDir = handle as FileSystemDirectoryHandle;
            const newSubDir = await dest.getDirectoryHandle(name, { create: true });
            await copyEntries(subDir, newSubDir);
        }
    }
}

/**
 * One-time migration: copies old root-level OPFS data into /research/.
 * Idempotent — skips if /research/ already exists.
 */
export async function migrateToNamespacedPaths(): Promise<void> {
    const root = await initRoot();
    try {
        await root.getDirectoryHandle(APP_PREFIX);
        return;
    } catch {
        // APP_PREFIX directory doesn't exist yet, proceed with migration
    }

    const appHandle = await root.getDirectoryHandle(APP_PREFIX, { create: true });

    try {
        const oldConversations = await root.getDirectoryHandle('conversations');
        const newConversations = await appHandle.getDirectoryHandle('conversations', { create: true });
        await copyEntries(oldConversations, newConversations);
    } catch {
        // No old conversations to migrate
    }

    // Migrate localStorage config to OPFS
    const oldConfig = localStorage.getItem('appConfig');
    if (oldConfig) {
        try {
            const prefsDir = await appHandle.getDirectoryHandle('preferences', { create: true });
            const configFile = await prefsDir.getFileHandle('config.json', { create: true });
            const writable = await configFile.createWritable();
            await writable.write(oldConfig);
            await writable.close();
        } catch {
            console.error('Failed to migrate localStorage config to OPFS');
        }
    }

    // Migrate localStorage API key to /credentials/
    try {
        const parsed = oldConfig ? JSON.parse(oldConfig) : null;
        if (parsed?.apiKey) {
            const credsDir = await root.getDirectoryHandle(CREDENTIALS_PREFIX, { create: true });
            const keyFile = await credsDir.getFileHandle('openrouter', { create: true });
            const writable = await keyFile.createWritable();
            await writable.write(parsed.apiKey);
            await writable.close();
        }
    } catch {
        console.error('Failed to migrate API key to /credentials/');
    }
}

async function getDirectory(
    base: FileSystemDirectoryHandle,
    path: string,
    createIfMissing = false
): Promise<FileSystemDirectoryHandle> {
    const parts = path.split('/').filter(p => p.trim() !== '');
    let current = base;
    for (const part of parts) {
        try {
            current = await current.getDirectoryHandle(part, { create: createIfMissing });
        } catch (err: unknown) {
            if (err instanceof DOMException && err.name === 'NotFoundError' && !createIfMissing) {
                throw new Error(`Directory not found: ${part}`);
            }
            throw err;
        }
    }
    return current;
}

export async function ensureDirectory(
    parent: FileSystemDirectoryHandle,
    name: string
): Promise<FileSystemDirectoryHandle> {
    return await parent.getDirectoryHandle(name, { create: true });
}

// ── App-prefixed file I/O (paths relative to /research/) ──

/**
 * Low-level primitive. When writing app data under `/research/`,
 * you MUST also call `recordWrite(path, hash)` from syncJournal.ts
 * and `queueSync()` from cloudSync.ts so the change is tracked
 * for cloud sync. See src/lib/storage.ts for the canonical pattern.
 */
export async function writeLocalFile(
    path: string,
    data: string | ArrayBuffer | Blob
): Promise<void> {
    const dirPath = path.split('/').slice(0, -1).join('/');
    const fileName = path.split('/').slice(-1)[0];

    const appHandle = await getOPFSHandle();
    const dirHandle = dirPath ? await getDirectory(appHandle, dirPath, true) : appHandle;
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();

    try {
        await writable.write(data);
        await writable.close();
    } catch (err) {
        await writable.abort();
        throw err;
    }
}

export async function readLocalFile(path: string): Promise<string | null> {
    try {
        const dirPath = path.split('/').slice(0, -1).join('/');
        const fileName = path.split('/').slice(-1)[0];

        const appHandle = await getOPFSHandle();
        const dirHandle = dirPath ? await getDirectory(appHandle, dirPath) : appHandle;
        const fileHandle = await dirHandle.getFileHandle(fileName);
        const file = await fileHandle.getFile();
        return file.text();
    } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'NotFoundError') return null;
        throw err;
    }
}

/**
 * Low-level primitive. When deleting app data under `/research/`,
 * you MUST also call `recordDelete(path)` from syncJournal.ts
 * and `queueSync()` from cloudSync.ts. See src/lib/storage.ts.
 */
export async function deleteLocalFile(path: string): Promise<void> {
    const dirPath = path.split('/').slice(0, -1).join('/');
    const fileName = path.split('/').slice(-1)[0];

    const appHandle = await getOPFSHandle();
    const dirHandle = dirPath ? await getDirectory(appHandle, dirPath) : appHandle;
    await dirHandle.removeEntry(fileName);
}

export async function listLocalDirectory(path: string): Promise<{
    files: OPFSFile[];
    directories: OPFSDirectory[];
}> {
    const appHandle = await getOPFSHandle();
    const dirHandle = path ? await getDirectory(appHandle, path) : appHandle;
    const result = { files: [] as OPFSFile[], directories: [] as OPFSDirectory[] };

    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file') {
            const file = await (entry as FileSystemFileHandle).getFile();
            result.files.push({
                name: entry.name,
                path: path ? `${path}/${entry.name}` : entry.name,
                size: file.size,
                lastModified: new Date(file.lastModified)
            });
        } else if (entry.kind === 'directory') {
            result.directories.push({
                name: entry.name,
                path: path ? `${path}/${entry.name}` : entry.name,
                lastModified: new Date()
            });
        }
    }
    return result;
}

export async function walkOpfsDirectory(
    dir: FileSystemDirectoryHandle,
    prefix: string
): Promise<string[]> {
    const paths: string[] = [];
    for await (const entry of dir.values()) {
        const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.kind === 'directory') {
            paths.push(...await walkOpfsDirectory(entry as FileSystemDirectoryHandle, entryPath));
        } else {
            paths.push(entryPath);
        }
    }
    return paths;
}

// ── Compat: old opfs_storage exports (now namespaced) ──

export async function initOpfsStorage(): Promise<void> {
    await initRoot();
}

export async function getOpfsDirectory(
    path: string,
    createIfMissing = false
): Promise<FileSystemDirectoryHandle> {
    const appHandle = await getOPFSHandle();
    return path ? getDirectory(appHandle, path, createIfMissing) : appHandle;
}

export async function writeOpfsFile(
    path: string,
    data: string | ArrayBuffer | Blob
): Promise<OPFSFile> {
    await writeLocalFile(path, data);
    return {
        name: path.split('/').slice(-1)[0],
        path,
        size: typeof data === 'string' ? data.length : 0,
        lastModified: new Date()
    };
}

export async function readOpfsFile(path: string): Promise<string> {
    const content = await readLocalFile(path);
    if (content === null) throw new Error(`File not found: ${path}`);
    return content;
}

export async function deleteOpfsFile(path: string): Promise<void> {
    await deleteLocalFile(path);
}

export async function listOpfsDirectory(path: string): Promise<{
    files: OPFSFile[];
    directories: OPFSDirectory[];
}> {
    return listLocalDirectory(path);
}

export async function deleteOpfsDirectory(
    path: string,
    recursive = false
): Promise<void> {
    const parentPath = path.split('/').slice(0, -1).join('/') || '.';
    const dirName = path.split('/').slice(-1)[0];

    const appHandle = await getOPFSHandle();
    const parentHandle = parentPath && parentPath !== '.'
        ? await getDirectory(appHandle, parentPath)
        : appHandle;
    await parentHandle.removeEntry(dirName, { recursive });
}

export async function* getAllFilesIterator(): AsyncGenerator<OPFSFileWithContent> {
    const appHandle = await getOPFSHandle();

    async function* traverseDirectory(
        dirHandle: FileSystemDirectoryHandle,
        currentPath: string = ''
    ): AsyncGenerator<OPFSFileWithContent> {
        for await (const entry of dirHandle.values()) {
            const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
            if (entry.kind === 'directory') {
                yield* traverseDirectory(entry as FileSystemDirectoryHandle, entryPath);
            } else if (entry.kind === 'file') {
                const file = await (entry as FileSystemFileHandle).getFile();
                yield {
                    name: entry.name,
                    path: entryPath,
                    size: file.size,
                    lastModified: new Date(file.lastModified),
                    getContent: async () => file.text()
                };
            }
        }
    }

    yield* traverseDirectory(appHandle);
}

// ── Cloud preferences (/cloud/preferences/) ──

/**
 * Reads from `/cloud/preferences/` — local-only shared settings.
 * These paths are NEVER synced. No journaling or queueSync needed.
 */
export async function readCloudPreference(name: string): Promise<string | null> {
    try {
        const cloudHandle = await getCloudHandle();
        const prefsHandle = await ensureDirectory(cloudHandle, 'preferences');
        const fileHandle = await prefsHandle.getFileHandle(name);
        const file = await fileHandle.getFile();
        return file.text();
    } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'NotFoundError') return null;
        throw err;
    }
}

/**
 * Writes to `/cloud/preferences/` — local-only shared settings.
 * These paths are NEVER synced. No journaling or queueSync needed.
 */
export async function writeCloudPreference(name: string, value: string): Promise<void> {
    const cloudHandle = await getCloudHandle();
    const prefsHandle = await ensureDirectory(cloudHandle, 'preferences');
    const fileHandle = await prefsHandle.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    try {
        await writable.write(value);
        await writable.close();
    } catch (err) {
        await writable.abort();
        throw err;
    }
}

// ── Shared credentials (/credentials/) ──

/**
 * Reads from `/credentials/` — shared across FindForge apps.
 * Credential pipeline uses immediate `syncCredentialToCloud()` instead
 * of the journal/debounce model. No `recordWrite`/`queueSync` needed.
 */
export async function readCredential(provider: string): Promise<string | null> {
    try {
        const credsHandle = await getCredentialsHandle();
        const fileHandle = await credsHandle.getFileHandle(provider);
        const file = await fileHandle.getFile();
        return file.text();
    } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'NotFoundError') return null;
        throw err;
    }
}

/**
 * Writes to `/credentials/` — shared across FindForge apps.
 * Calls `syncCredentialToCloud()` from the caller (see storage.ts)
 * instead of the journal/debounce model. No `recordWrite`/`queueSync` needed.
 */
export async function writeCredential(provider: string, value: string): Promise<void> {
    const credsHandle = await getCredentialsHandle();
    const fileHandle = await credsHandle.getFileHandle(provider, { create: true });
    const writable = await fileHandle.createWritable();
    try {
        await writable.write(value);
        await writable.close();
    } catch (err) {
        await writable.abort();
        throw err;
    }
}

export async function deleteCredential(provider: string): Promise<void> {
    const credsHandle = await getCredentialsHandle();
    await credsHandle.removeEntry(provider);
}
