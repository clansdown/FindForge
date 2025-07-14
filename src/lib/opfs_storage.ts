import { type MessageData, type ConversationData } from './types';

export interface OPFSFile {
    name: string;
    path: string;
    size: number;
    lastModified: Date;
}

export interface OPFSDirectory {
    name: string;
    path: string;
    lastModified: Date;
}

let rootDirHandle: FileSystemDirectoryHandle | null = null;

/**
 * Initializes OPFS storage by getting the root directory handle
 * @returns Promise resolving when initialization is complete
 */
export async function initOpfsStorage(): Promise<void> {
    if (!('storage' in navigator && 'getDirectory' in navigator.storage)) {
        throw new Error('OPFS is not supported in this browser');
    }

    if (rootDirHandle) {
        return;
    }

    try {
        rootDirHandle = await navigator.storage.getDirectory();
    } catch (err) {
        console.error('Failed to initialize OPFS:', err);
        throw err;
    }
}

/**
 * Checks if OPFS storage is available and initialized
 * @returns Promise resolving to boolean indicating if OPFS is ready
 */
export async function isOpfsReady(): Promise<boolean> {
    if (!rootDirHandle) {
        try {
            await initOpfsStorage();
        } catch {
            return false;
        }
    }
    return !!rootDirHandle;
}

/**
 * Gets a directory handle from OPFS
 * @param path Path to directory
 * @param createIfMissing Whether to create directory if it doesn't exist
 * @returns Promise resolving to directory handle
 */
export async function getOpfsDirectory(
    path: string,
    createIfMissing = false
): Promise<FileSystemDirectoryHandle> {
    await initOpfsStorage();
    if (!rootDirHandle) {
        throw new Error('OPFS not initialized');
    }

    const parts = path.split('/').filter(p => p.trim() !== '');
    let currentDir = rootDirHandle;
    
    for (const part of parts) {
        try {
            currentDir = await currentDir.getDirectoryHandle(part, { create: createIfMissing });
        } catch (err : any) {
            if (err.name === 'NotFoundError' && !createIfMissing) {
                throw new Error(`Directory not found: ${part}`);
            }
            throw err;
        }
    }

    return currentDir;
}

/**
 * Creates a new file in OPFS
 * @param path Full path to file including name
 * @param data File contents
 * @returns Promise resolving when write is complete
 */
export async function writeOpfsFile(
    path: string,
    data: string | ArrayBuffer | Blob
): Promise<OPFSFile> {
    const dirPath = path.split('/').slice(0, -1).join('/');
    const fileName = path.split('/').slice(-1)[0];
    
    const dirHandle = await getOpfsDirectory(dirPath, true);
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    
    try {
        await writable.write(data);
        await writable.close();
    } catch (err) {
        await writable.abort();
        throw err;
    }

    const file = await fileHandle.getFile();
    return {
        name: fileName,
        path,
        size: file.size,
        lastModified: new Date(file.lastModified)
    };
}

/**
 * Reads a file from OPFS
 * @param path Full path to file
 * @returns Promise resolving to file contents
 */
export async function readOpfsFile(path: string): Promise<string> {
    const dirPath = path.split('/').slice(0, -1).join('/');
    const fileName = path.split('/').slice(-1)[0];
    
    const dirHandle = await getOpfsDirectory(dirPath);
    const fileHandle = await dirHandle.getFileHandle(fileName);
    const file = await fileHandle.getFile();

    return file.text();
}

/**
 * Lists contents of an OPFS directory
 * @param path Path to directory
 * @returns Promise resolving to array of files and directories
 */
export async function listOpfsDirectory(path: string): Promise<{
    files: OPFSFile[];
    directories: OPFSDirectory[];
}> {
    const dirHandle = await getOpfsDirectory(path);
    const result = {
        files: [] as OPFSFile[],
        directories: [] as OPFSDirectory[]
    };

    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file') {
            const file = await (entry as FileSystemFileHandle).getFile();
            result.files.push({
                name: entry.name,
                path: `${path}/${entry.name}`,
                size: file.size,
                lastModified: new Date(file.lastModified)
            });
        } else if (entry.kind === 'directory') {
            result.directories.push({
                name: entry.name,
                path: `${path}/${entry.name}`,
                lastModified: new Date() // OPFS doesn't track directory modified time
            });
        }
    }

    return result;
}

/**
 * Deletes a file from OPFS
 * @param path Full path to file
 * @returns Promise resolving when deletion is complete
 */
export async function deleteOpfsFile(path: string): Promise<void> {
    const dirPath = path.split('/').slice(0, -1).join('/');
    const fileName = path.split('/').slice(-1)[0];
    
    const dirHandle = await getOpfsDirectory(dirPath);
    await dirHandle.removeEntry(fileName);
}

/**
 * Deletes a directory from OPFS
 * @param path Path to directory
 * @param recursive Whether to recursively delete contents
 * @returns Promise resolving when deletion is complete
 */
export async function deleteOpfsDirectory(
    path: string,
    recursive = false
): Promise<void> {
    const parentPath = path.split('/').slice(0, -1).join('/') || '.';
    const dirName = path.split('/').slice(-1)[0];
    
    const parentHandle = await getOpfsDirectory(parentPath);
    await parentHandle.removeEntry(dirName, { recursive });
}
