import { writable } from 'svelte/store';
import { isSignedIn, getClerkToken, isClerkEnabled } from './auth';
export { isSignedIn, getClerk } from './auth';
import {
    readLocalFile,
    writeLocalFile,
    deleteLocalFile,
    listLocalDirectory,
    walkOpfsDirectory,
    readCredential,
    writeCredential,
    readCloudPreference,
    writeCloudPreference,
    getOPFSHandle,
    getCredentialsHandle,
    ensureDirectory
} from './lib/opfs';
import {
    init as initJournal,
    recordWrite,
    recordDelete,
    recordDeleteRecursive,
    drainQueue,
    getCheckpoint,
    setLastCloudCheckTime,
    getJournalEntriesSince,
    truncateJournalEntriesBefore
} from './syncJournal';
import type {
    SyncFileInfo,
    SyncManifest,
    SyncManifestEntry,
    SyncConflict,
    SyncDeletion,
    SyncActions,
    CloudState,
    WorkerErrorResponse
} from './types/cloudSync';

// ── Constants ──

const WORKER_BASE_URL = import.meta.env.DEV
    ? '/storage'
    : 'https://findforge-storage.chris-f57.workers.dev';

const SYNC_INTERVAL_MS = 60 * 60 * 1000;
const SYNC_DEBOUNCE_MS = 5000;

let allowCloudDeletionsCache: boolean | null = null;

async function shouldAllowCloudDeletions(): Promise<boolean> {
    if (allowCloudDeletionsCache !== null) return allowCloudDeletionsCache;
    const val = await readCloudPreference('cloudSyncDeleteRemote');
    allowCloudDeletionsCache = val === 'true';
    return allowCloudDeletionsCache;
}

export const CLOUD_PREFIX = 'research/';
export const CREDENTIALS_CLOUD_PREFIX = 'credentials/';

const MANIFEST_PATH = 'preferences/syncManifest';
const CLOUD_STATE_PATH = 'cloud-state.json';
const SYNC_SAFETY_WINDOW_MS = 10000;

/**
 * Path prefixes under /research/ that should NEVER be synced to the cloud.
 *
 * - `preferences/syncManifest` — local-only sync state file, updated atomically inside lock
 * - `sync/` — crash-recovery journal files (journals A/B, checkpoint)
 * - `doc-cache/` — document cache for fetched papers / PDFs, private to this device
 *
 * Add new local-only prefixes here so both the diff walk and the complete
 * re-sync walk stay in sync. Missing a prefix in one filter but not the other
 * would cause cache files to be synced (or the manifest to be treated as data).
 */
const SYNC_IGNORE_PREFIXES = [
    'preferences/syncManifest',
    'sync/',
    'doc-cache/',
];

function isPathIgnored(path: string): boolean {
    return SYNC_IGNORE_PREFIXES.some(prefix => path.startsWith(prefix));
}

// ── State ──

type CloudSyncState = {
    enabled: boolean;
    isSyncing: boolean;
    lastSyncTime: string | null;
    lastSyncError: string | null;
    syncProgress: { current: number; total: number; phase: string } | null;
};

const _state: CloudSyncState = {
    enabled: false,
    isSyncing: false,
    lastSyncTime: null,
    lastSyncError: null,
    syncProgress: null
};

export const cloudSyncStore = writable<CloudSyncState>({ ..._state });

const STATE = new Proxy(_state, {
    set(target, prop, value) {
        (target as Record<string, unknown>)[prop as string] = value;
        cloudSyncStore.set({ ...target });
        return true;
    }
});

let syncReloadCallback: ((changedPaths: string[]) => Promise<void>) | null = null;
let syncTimerHandle: ReturnType<typeof setInterval> | null = null;
let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// ── Cloud sync prompt (first-run opt-in) ──

let _cloudSyncPromptNeeded = false;

export function isCloudSyncPromptNeeded(): boolean {
    return _cloudSyncPromptNeeded;
}

export async function dismissCloudSyncPrompt(): Promise<void> {
    _cloudSyncPromptNeeded = false;
    await writeCloudPreference('cloudSyncPromptDismissed', 'true');
}

export type ConflictResolver = (conflict: SyncConflict) => Promise<'local' | 'remote'>;
let conflictResolver: ConflictResolver | null = null;

export function setConflictResolver(resolver: ConflictResolver): void {
    conflictResolver = resolver;
}

// ── Token management ──

async function fetchWithAuth(
    url: string,
    options: RequestInit = {},
    retried = false
): Promise<Response> {
    const token = await getClerkToken({ skipCache: retried });
    if (!token) throw new Error('Not authenticated');

    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${token}`);

    const response = await fetch(url, { ...options, headers });

    if (response.status === 401) {
        const body = await response.clone().json().catch(() => ({})) as WorkerErrorResponse;
        if (body.code === 'token_expired' && !retried) {
            return fetchWithAuth(url, options, true);
        }
        throw new Error(`Authentication failed: ${body.error || response.statusText}`);
    }

    if (response.status === 429) {
        throw new Error('Rate limited. Try again later.');
    }

    if (!response.ok) {
        throw new Error(`Worker error ${response.status}: ${response.statusText}`);
    }

    return response;
}

// MD5 implementation for B2 ETag compatibility
// Based on the reference implementation by Joseph Myers
function md5(s: string): string {
    function add32(a: number, b: number): number {
        const lsw = (a & 0xFFFF) + (b & 0xFFFF);
        const msw = (a >> 16) + (b >> 16) + (lsw >> 16);
        return (msw << 16) | (lsw & 0xFFFF);
    }
    function cmn(q: number, a: number, b: number, x: number, s: number, t: number): number {
        return add32((a << s) | (a >>> (32 - s)), add32(add32(b, q), add32(x, t)));
    }
    function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
        return cmn((b & c) | ((~b) & d), a, b, x, s, t);
    }
    function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
        return cmn((b & d) | (c & (~d)), a, b, x, s, t);
    }
    function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
        return cmn(b ^ c ^ d, a, b, x, s, t);
    }
    function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
        return cmn(c ^ (b | (~d)), a, b, x, s, t);
    }
    const n = s.length;
    const m: number[] = [];
    for (let i = 0; i < n; i++) {
        m[i >> 2] |= s.charCodeAt(i) << ((i % 4) * 8);
    }
    m[n >> 2] |= 0x80 << ((n % 4) * 8);
    const len = n * 8;
    m[(((n + 8) >> 6) << 4) + 14] = len;
    m[(((n + 8) >> 6) << 4) + 15] = Math.floor(len / 0x100000000);
    let a = 0x67452301, b1 = 0xefcdab89, c1 = 0x98badcfe, d1 = 0x10325476;
    for (let i = 0; i < m.length; i += 16) {
        const aa = a, bb = b1, cc = c1, dd = d1;
        a = ff(a, b1, c1, d1, m[i + 0], 7, 0xd76aa478); d1 = ff(d1, a, b1, c1, m[i + 1], 12, 0xe8c7b756); c1 = ff(c1, d1, a, b1, m[i + 2], 17, 0x242070db); b1 = ff(b1, c1, d1, a, m[i + 3], 22, 0xc1bdceee);
        a = ff(a, b1, c1, d1, m[i + 4], 7, 0xf57c0faf); d1 = ff(d1, a, b1, c1, m[i + 5], 12, 0x4787c62a); c1 = ff(c1, d1, a, b1, m[i + 6], 17, 0xa8304613); b1 = ff(b1, c1, d1, a, m[i + 7], 22, 0xfd469501);
        a = ff(a, b1, c1, d1, m[i + 8], 7, 0x698098d8); d1 = ff(d1, a, b1, c1, m[i + 9], 12, 0x8b44f7af); c1 = ff(c1, d1, a, b1, m[i + 10], 17, 0xffff5bb1); b1 = ff(b1, c1, d1, a, m[i + 11], 22, 0x895cd7be);
        a = ff(a, b1, c1, d1, m[i + 12], 7, 0x6b901122); d1 = ff(d1, a, b1, c1, m[i + 13], 12, 0xfd987193); c1 = ff(c1, d1, a, b1, m[i + 14], 17, 0xa679438e); b1 = ff(b1, c1, d1, a, m[i + 15], 22, 0x49b40821);
        a = gg(a, b1, c1, d1, m[i + 1], 5, 0xf61e2562); d1 = gg(d1, a, b1, c1, m[i + 6], 9, 0xc040b340); c1 = gg(c1, d1, a, b1, m[i + 11], 14, 0x265e5a51); b1 = gg(b1, c1, d1, a, m[i + 0], 20, 0xe9b6c7aa);
        a = gg(a, b1, c1, d1, m[i + 5], 5, 0xd62f105d); d1 = gg(d1, a, b1, c1, m[i + 10], 9, 0x02441453); c1 = gg(c1, d1, a, b1, m[i + 15], 14, 0xd8a1e681); b1 = gg(b1, c1, d1, a, m[i + 4], 20, 0xe7d3fbc8);
        a = gg(a, b1, c1, d1, m[i + 9], 5, 0x21e1cde6); d1 = gg(d1, a, b1, c1, m[i + 14], 9, 0xc33707d6); c1 = gg(c1, d1, a, b1, m[i + 3], 14, 0xf4d50d87); b1 = gg(b1, c1, d1, a, m[i + 8], 20, 0x455a14ed);
        a = gg(a, b1, c1, d1, m[i + 13], 5, 0xa9e3e905); d1 = gg(d1, a, b1, c1, m[i + 2], 9, 0xfcefa3f8); c1 = gg(c1, d1, a, b1, m[i + 7], 14, 0x676f02d9); b1 = gg(b1, c1, d1, a, m[i + 12], 20, 0x8d2a4c8a);
        a = hh(a, b1, c1, d1, m[i + 5], 4, 0xfffa3942); d1 = hh(d1, a, b1, c1, m[i + 8], 11, 0x8771f681); c1 = hh(c1, d1, a, b1, m[i + 11], 16, 0x6d9d6122); b1 = hh(b1, c1, d1, a, m[i + 14], 23, 0xfde5380c);
        a = hh(a, b1, c1, d1, m[i + 1], 4, 0xa4beea44); d1 = hh(d1, a, b1, c1, m[i + 4], 11, 0x4bdecfa9); c1 = hh(c1, d1, a, b1, m[i + 7], 16, 0xf6bb4b60); b1 = hh(b1, c1, d1, a, m[i + 10], 23, 0xbebfbc70);
        a = hh(a, b1, c1, d1, m[i + 13], 4, 0x289b7ec6); d1 = hh(d1, a, b1, c1, m[i + 2], 11, 0xeaa127fa); c1 = hh(c1, d1, a, b1, m[i + 5], 16, 0xd4ef3085); b1 = hh(b1, c1, d1, a, m[i + 8], 23, 0x04881d05);
        a = hh(a, b1, c1, d1, m[i + 9], 4, 0xd9d4d039); d1 = hh(d1, a, b1, c1, m[i + 12], 11, 0xe6db99e5); c1 = hh(c1, d1, a, b1, m[i + 15], 16, 0x1fa27cf8); b1 = hh(b1, c1, d1, a, m[i + 2], 23, 0xc4ac5665);
        a = ii(a, b1, c1, d1, m[i + 0], 6, 0xf4292244); d1 = ii(d1, a, b1, c1, m[i + 7], 10, 0x432aff97); c1 = ii(c1, d1, a, b1, m[i + 14], 15, 0xab9423a7); b1 = ii(b1, c1, d1, a, m[i + 5], 21, 0xfc93a039);
        a = ii(a, b1, c1, d1, m[i + 12], 6, 0x655b59c3); d1 = ii(d1, a, b1, c1, m[i + 3], 10, 0x8f0ccc92); c1 = ii(c1, d1, a, b1, m[i + 10], 15, 0xffeff47d); b1 = ii(b1, c1, d1, a, m[i + 1], 21, 0x85845dd1);
        a = ii(a, b1, c1, d1, m[i + 8], 6, 0x6fa87e4f); d1 = ii(d1, a, b1, c1, m[i + 15], 10, 0xfe2ce6e0); c1 = ii(c1, d1, a, b1, m[i + 6], 15, 0xa3014314); b1 = ii(b1, c1, d1, a, m[i + 13], 21, 0x4e0811a1);
        a = ii(a, b1, c1, d1, m[i + 4], 6, 0xf7537e82); d1 = ii(d1, a, b1, c1, m[i + 11], 10, 0xbd3af235); c1 = ii(c1, d1, a, b1, m[i + 2], 15, 0x2ad7d2bb); b1 = ii(b1, c1, d1, a, m[i + 9], 21, 0xeb86d391);
        a = add32(a, aa); b1 = add32(b1, bb); c1 = add32(c1, cc); d1 = add32(d1, dd);
    }
    function toHex(v: number): string {
        const hex = (v >>> 0).toString(16);
        return ('0000000' + hex).slice(-8);
    }
    return toHex(a) + toHex(b1) + toHex(c1) + toHex(d1);
}

function computeHash(content: string | ArrayBuffer): string {
    if (typeof content === 'string') {
        return md5(content);
    }
    const bytes = new Uint8Array(content as ArrayBuffer);
    let str = '';
    for (let i = 0; i < bytes.length; i++) {
        str += String.fromCharCode(bytes[i]);
    }
    return md5(str);
}

export { computeHash };

// ── Worker API ──

function getCloudPath(localPath: string): string {
    const prefix = localPath.startsWith('credentials/') ? CREDENTIALS_CLOUD_PREFIX : CLOUD_PREFIX;
    const requestPath = localPath.startsWith('credentials/')
        ? localPath.slice('credentials/'.length)
        : localPath;
    const segments = requestPath.split('/').map(encodeURIComponent).join('/');
    return prefix + segments;
}

async function uploadFile(
    localPath: string,
    content: string | ArrayBuffer,
    contentType: string
): Promise<{ etag: string }> {
    const url = WORKER_BASE_URL + '/' + getCloudPath(localPath);
    const response = await fetchWithAuth(url, {
        method: 'PUT',
        body: content,
        headers: { 'Content-Type': contentType }
    });
    const etag = response.headers.get('ETag') || '';
    return { etag };
}

type DownloadResult = {
    content: string | ArrayBuffer;
    etag: string;
};

async function downloadFile(localPath: string): Promise<DownloadResult | null> {
    try {
        const url = WORKER_BASE_URL + '/' + getCloudPath(localPath);
        const response = await fetchWithAuth(url);
        const contentType = response.headers.get('Content-Type') || '';
        const etag = response.headers.get('ETag') || '';
        const isBinary = contentType.startsWith('image/') || contentType.startsWith('application/octet-stream');
        const content = isBinary ? await response.arrayBuffer() : await response.text();
        return { content, etag };
    } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('404')) return null;
        throw err;
    }
}

async function deleteRemoteFile(localPath: string): Promise<void> {
    if (!(await shouldAllowCloudDeletions())) return;
    const url = WORKER_BASE_URL + '/' + getCloudPath(localPath);
    await fetchWithAuth(url, { method: 'DELETE' });
}

async function listRemoteFiles(prefix: string): Promise<SyncFileInfo[]> {
    const isCredentialsPrefix = prefix === 'credentials' || prefix.startsWith('credentials/');
    const cloudPrefix = isCredentialsPrefix ? CREDENTIALS_CLOUD_PREFIX : CLOUD_PREFIX;
    const requestPrefix = isCredentialsPrefix
        ? (prefix.startsWith('credentials/') ? prefix.slice('credentials/'.length) : '')
        : prefix;

    const files: SyncFileInfo[] = [];
    let continuationToken: string | undefined;

    do {
        const params = new URLSearchParams({
            'list-type': '2',
            prefix: cloudPrefix + requestPrefix
        });
        if (continuationToken) params.set('continuation-token', continuationToken);

        const url = WORKER_BASE_URL + '/?' + params.toString();
        const response = await fetchWithAuth(url);
        const text = await response.text();

        // Parse B2 XML format
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'application/xml');
        const contents = doc.getElementsByTagName('Contents');

        for (let i = 0; i < contents.length; i++) {
            const keyEl = contents[i].getElementsByTagName('Key')[0];
            const etagEl = contents[i].getElementsByTagName('ETag')[0];
            const sizeEl = contents[i].getElementsByTagName('Size')[0];
            const lastModEl = contents[i].getElementsByTagName('LastModified')[0];

            if (keyEl) {
                // Strip cloud prefix to get relative path
                const fullKey = keyEl.textContent || '';
                const relPath = fullKey.startsWith(cloudPrefix)
                    ? fullKey.slice(cloudPrefix.length)
                    : fullKey;
                files.push({
                    path: prefix ? `${prefix}/${relPath}` : relPath,
                    etag: etagEl?.textContent || '',
                    size: parseInt(sizeEl?.textContent || '0'),
                    lastModified: lastModEl?.textContent || ''
                });
            }
        }

        const nextToken = doc.getElementsByTagName('NextContinuationToken')[0];
        continuationToken = nextToken?.textContent || undefined;
    } while (continuationToken);

    return files;
}

async function getCloudState(prefix: string): Promise<CloudState | null> {
    const isCredentialsPrefix = prefix === 'credentials' || prefix.startsWith('credentials/');
    const cloudPrefix = isCredentialsPrefix ? CREDENTIALS_CLOUD_PREFIX : CLOUD_PREFIX;
    try {
        const url = WORKER_BASE_URL + '/' + cloudPrefix + 'cloud-state.json';
        const response = await fetchWithAuth(url);
        const text = await response.text();
        return JSON.parse(text) as CloudState;
    } catch {
        return null;
    }
}

// ── Remote data detection ──

export async function checkRemoteDataExists(): Promise<boolean> {
    if (!isClerkEnabled() || !isSignedIn()) return false;

    try {
        const credFiles = await listRemoteFiles('credentials');
        const hasRealCreds = credFiles.some(
            f => !f.path.endsWith('syncManifest') && !f.path.endsWith('cloud-state.json')
        );
        if (hasRealCreds) return true;

        const appFiles = await listRemoteFiles('');
        const hasRealData = appFiles.some(f => !f.path.endsWith('cloud-state.json'));
        if (hasRealData) return true;

        return false;
    } catch {
        return false;
    }
}

// ── Manifest management ──

async function loadManifest(): Promise<SyncManifest> {
    try {
        const content = await readLocalFile(MANIFEST_PATH);
        if (content) return JSON.parse(content) as SyncManifest;
    } catch {
        // No manifest yet
    }
    return {};
}

async function saveManifest(manifest: SyncManifest): Promise<void> {
    const dirPath = MANIFEST_PATH.split('/').slice(0, -1).join('/');
    const appHandle = await getOPFSHandle();
    await ensureDirectory(appHandle, dirPath);
    await writeLocalFile(MANIFEST_PATH, JSON.stringify(manifest));
}

// ── Diff computation ──

async function computeSyncActions(existingManifest: SyncManifest): Promise<SyncActions> {
    const actions: SyncActions = { uploads: [], downloads: [], conflicts: [], deletions: [] };

    // Get local files
    const appHandle = await getOPFSHandle();
    const localPaths = await walkOpfsDirectory(appHandle, '');
    // Filter out sync journal and manifest paths
    const appPaths = localPaths.filter((p: string) => !isPathIgnored(p));

    // Get remote file list
    let remoteFiles: SyncFileInfo[] = [];
    try {
        remoteFiles = await listRemoteFiles('');
    } catch {
        // Remote listing failed, assume no remote files
    }

    const remotePathSet = new Set(remoteFiles.map(f => f.path));

    // Compute local changes from journal
    const checkpoint = getCheckpoint();
    const journalEntries = await getJournalEntriesSince(0);

    const changedPaths = new Set<string>();
    for (const entry of journalEntries) {
        if (entry.action === 'write') {
            changedPaths.add(entry.path);
        } else if (entry.action === 'delete' || entry.action === 'delete_recursive') {
            // Mark for deletion
            if (remotePathSet.has(entry.path)) {
                actions.deletions.push({ path: entry.path, source: 'local' });
            }
        }
    }

    // Check each local file
    for (const path of appPaths) {
        let content: string | null;
        try {
            content = await readLocalFile(path);
        } catch {
            continue;
        }
        if (content === null) continue;

        const localHash = computeHash(content);
        const manifestEntry = existingManifest[path];
        const remoteFile = remoteFiles.find(f => f.path === path);

        if (!remoteFile) {
            // Upload if new (not in manifest) or changed
            if (!existingManifest[path] || changedPaths.has(path)) {
                actions.uploads.push(path);
            }
        } else if (localHash !== manifestEntry?.hash) {
            if (remoteFile.etag !== manifestEntry?.etag) {
                // Both changed — conflict
                actions.conflicts.push({ path, localHash, remoteEtag: remoteFile.etag });
            } else {
                // Only local changed
                actions.uploads.push(path);
            }
        } else if (remoteFile.etag !== manifestEntry?.etag) {
            // Only remote changed
            actions.downloads.push(path);
        }
    }

    // Check remote files not in local
    for (const remoteFile of remoteFiles) {
        if (remoteFile.path === CLOUD_STATE_PATH) continue;
        if (!appPaths.includes(remoteFile.path) && remotePathSet.has(remoteFile.path)) {
            actions.downloads.push(remoteFile.path);
        }
    }

    return actions;
}

async function resolveConflicts(
    conflicts: SyncConflict[],
    priority: 'local' | 'remote'
): Promise<{ uploads: string[]; downloads: string[] }> {
    const uploads: string[] = [];
    const downloads: string[] = [];

    for (const conflict of conflicts) {
        if (priority === 'local') {
            uploads.push(conflict.path);
        } else {
            downloads.push(conflict.path);
        }
    }

    return { uploads, downloads };
}

// ── Sync lock ──

let syncQueue: Promise<void> = Promise.resolve();

/**
 * Bulk download operations (syncFromCloud, syncResetThenPull) do NOT
 * call recordWrite/recordDelete. They update the sync manifest atomically
 * inside the same locked operation, so journal entries would be redundant.
 */
function withSyncLock<T>(fn: (ctx: { changedPaths: string[] }) => Promise<T>): Promise<T> {
    const prev = syncQueue;
    let releaseLock: () => void;
    syncQueue = new Promise<void>(resolve => { releaseLock = resolve; });

    return prev.then(async () => {
        STATE.isSyncing = true;
        const changedPaths: string[] = [];
        try {
            return await fn({ changedPaths });
        } finally {
            STATE.isSyncing = false;
            releaseLock!();
            if (syncReloadCallback && changedPaths.length > 0) {
                syncReloadCallback(changedPaths).catch(console.error);
            }
        }
    });
}

// ── Core sync operations ──

export async function syncToCloud(): Promise<void> {
    if (!STATE.enabled || STATE.isSyncing) return;
    if (!isClerkEnabled() || !isSignedIn()) return;

    return withSyncLock(async () => {
        await drainQueue();

        const existingManifest = await loadManifest();
        const actions = await computeSyncActions(existingManifest);

        const newManifest: SyncManifest = { ...existingManifest };

        // Process uploads
        const totalUploads = actions.uploads.length;
        let uploadIdx = 0;
        let uploadFailed = false;
        for (const path of actions.uploads) {
            uploadIdx++;
            STATE.syncProgress = { current: uploadIdx, total: totalUploads, phase: 'Uploading' };
            try {
                const content = await readLocalFile(path);
                if (content === null) continue;
                const { etag } = await uploadFile(
                    path,
                    content,
                    path.endsWith('.json') ? 'application/json' : 'text/plain'
                );
                newManifest[path] = {
                    hash: computeHash(content),
                    etag,
                    mtime: new Date().toISOString()
                };
            } catch (err) {
                uploadFailed = true;
                console.error(`Failed to upload ${path}:`, err);
            }
        }

        // Process deletions
        for (const del of actions.deletions) {
            try {
                await deleteRemoteFile(del.path);
                delete newManifest[del.path];
            } catch (err) {
                console.error(`Failed to delete ${del.path}:`, err);
            }
        }

        await saveManifest(newManifest);
        const now = new Date().toISOString();
        STATE.lastSyncTime = now;
        await setLastCloudCheckTime(now);
        if (!uploadFailed && actions.uploads.length > 0) {
            await truncateJournalEntriesBefore(getCheckpoint().lastId);
        }
        STATE.syncProgress = null;
    });
}

export async function syncFromCloud(): Promise<void> {
    if (!STATE.enabled) return;
    if (!isClerkEnabled() || !isSignedIn()) return;

    return withSyncLock(async (ctx) => {
        // Fast-path: check cloud state
        const cloudState = await getCloudState('');
        const checkpoint = getCheckpoint();
        if (cloudState && checkpoint.lastCloudCheckTime &&
            cloudState.lastUpdateTime <= checkpoint.lastCloudCheckTime) {
            // No changes since last check
            return;
        }

        const existingManifest = await loadManifest();
        const actions = await computeSyncActions(existingManifest);

        // Resolve conflicts: use custom resolver or default to remote-wins
        const conflictPriority: 'local' | 'remote' = conflictResolver ? 'local' : 'remote';
        const { downloads } = await resolveConflicts(actions.conflicts, conflictPriority);

        const allDownloads = [...actions.downloads, ...downloads];

        // Process downloads
        // Note: Manifest is updated atomically below — no journal entry needed for downloads.
        const newManifest: SyncManifest = { ...existingManifest };
        const totalDownloads = allDownloads.length;
        let dlIdx = 0;
        for (const path of allDownloads) {
            dlIdx++;
            STATE.syncProgress = { current: dlIdx, total: totalDownloads, phase: 'Downloading' };
            try {
                const result = await downloadFile(path);
                if (result === null) continue;
                await writeLocalFile(path, result.content);
                newManifest[path] = {
                    hash: computeHash(result.content),
                    etag: result.etag,
                    mtime: new Date().toISOString()
                };
                ctx.changedPaths.push(path);
            } catch (err) {
                console.error(`Failed to download ${path}:`, err);
            }
        }

        await saveManifest(newManifest);
        const now = new Date().toISOString();
        STATE.lastSyncTime = now;
        await setLastCloudCheckTime(now);
        STATE.syncProgress = null;

    });
}

export async function syncBothWays(): Promise<void> {
    await syncToCloud();
    await syncFromCloud();
}

export async function syncResetThenPull(): Promise<void> {
    if (!STATE.enabled) return;
    if (!isClerkEnabled() || !isSignedIn()) return;

    return withSyncLock(async (ctx) => {
        const appHandle = await getOPFSHandle();
        const localPaths = await walkOpfsDirectory(appHandle, '');
        const appPaths = localPaths.filter((p: string) => !isPathIgnored(p));

        // Phase 1: Mark all local files as dirty and persist to journal
        for (const path of appPaths) {
            const content = await readLocalFile(path);
            if (content !== null) {
                recordWrite(path, computeHash(content));
            }
        }
        await drainQueue();

        // Phase 2: Clear manifest to force fresh state
        await saveManifest({});

        // Phase 3: Upload all local files
        const newManifest: SyncManifest = {};
        for (let i = 0; i < appPaths.length; i++) {
            const path = appPaths[i];
            STATE.syncProgress = { current: i + 1, total: appPaths.length, phase: 'Uploading' };
            try {
                const content = await readLocalFile(path);
                if (content === null) continue;
                const { etag } = await uploadFile(
                    path,
                    content,
                    path.endsWith('.json') ? 'application/json' : 'text/plain'
                );
                newManifest[path] = {
                    hash: computeHash(content),
                    etag,
                    mtime: new Date().toISOString()
                };
            } catch (err) {
                console.error(`Failed to upload ${path}:`, err);
            }
        }

        // Phase 4: Download remote files we don't already have
        const uploadedPaths = new Set(Object.keys(newManifest));
        const remoteFiles = await listRemoteFiles('');
        const remoteOnly = remoteFiles.filter(f => !uploadedPaths.has(f.path));
        for (let i = 0; i < remoteOnly.length; i++) {
            const remoteFile = remoteOnly[i];
            STATE.syncProgress = { current: i + 1, total: remoteOnly.length, phase: 'Downloading' };
            try {
                const result = await downloadFile(remoteFile.path);
                if (result === null) continue;
                await writeLocalFile(remoteFile.path, result.content);
                newManifest[remoteFile.path] = {
                    hash: computeHash(result.content),
                    etag: result.etag,
                    mtime: remoteFile.lastModified
                };
                ctx.changedPaths.push(remoteFile.path);
            } catch (err) {
                console.error(`Failed to download ${remoteFile.path}:`, err);
            }
        }

        // Phase 5: Save manifest and trim journal
        await saveManifest(newManifest);
        await truncateJournalEntriesBefore(getCheckpoint().lastId);
        const now = new Date().toISOString();
        STATE.lastSyncTime = now;
        await setLastCloudCheckTime(now);
        STATE.syncProgress = null;
    });
}

// ── Credential sync (separate pipeline) ──

export async function syncCredentialToCloud(provider: string): Promise<void> {
    if (!isClerkEnabled() || !isSignedIn()) return;

    const content = await readCredential(provider);
    if (content === null) return;

    const path = `credentials/${provider}`;
    const { etag } = await uploadFile(path, content, 'text/plain');

    // Update credential manifest
    const credsHandle = await getCredentialsHandle();
    try {
        const manifestFile = await credsHandle.getFileHandle('syncManifest');
        const file = await manifestFile.getFile();
        const old = await file.text();
        const manifest: SyncManifest = old ? JSON.parse(old) : {};
        manifest[provider] = { hash: computeHash(content), etag, mtime: new Date().toISOString() };
        const writable = await manifestFile.createWritable();
        await writable.write(JSON.stringify(manifest));
        await writable.close();
    } catch {
        // No manifest yet, create one
        const manifest: SyncManifest = {
            [provider]: { hash: computeHash(content), etag, mtime: new Date().toISOString() }
        };
        const manifestFile = await credsHandle.getFileHandle('syncManifest', { create: true });
        const writable = await manifestFile.createWritable();
        await writable.write(JSON.stringify(manifest));
        await writable.close();
    }
}

export async function syncCredentialsFromCloud(force = false): Promise<void> {
    if (!isClerkEnabled() || !isSignedIn()) return;

    return withSyncLock(async (ctx) => {
        // Fast-path via cloud-state
        if (!force) {
            const cloudState = await getCloudState('credentials/');
            const checkpoint = getCheckpoint();
            if (cloudState && checkpoint.lastCloudCheckTime &&
                cloudState.lastUpdateTime <= checkpoint.lastCloudCheckTime) {
                return;
            }
        }

        const remoteFiles = await listRemoteFiles('credentials');

        for (const remoteFile of remoteFiles) {
            const provider = remoteFile.path.split('/').pop() || '';
            if (provider === 'syncManifest' || provider === 'cloud-state.json') continue;

            try {
                const result = await downloadFile(remoteFile.path);
                if (result === null) continue;

                const existing = await readCredential(provider);
                if (!existing || force) {
                    await writeCredential(provider, typeof result.content === 'string' ? result.content : '');
                    ctx.changedPaths.push(`credentials/${provider}`);
                }
            } catch (err) {
                console.error(`Failed to sync credential ${provider}:`, err);
            }
        }

    });
}

// ── Public API ──

export function setSyncReloadCallback(cb: (changedPaths: string[]) => Promise<void>): void {
    syncReloadCallback = cb;
}

export async function initCloudSync(): Promise<void> {
    await initJournal();

    // Read local preference
    let shouldEnable = (await readCloudPreference('cloudSyncEnabled')) === 'true';

    // Auto-enable or prompt if not yet decided
    if (!shouldEnable && isClerkEnabled() && isSignedIn()) {
        const dismissed = await readCloudPreference('cloudSyncPromptDismissed');
        if (dismissed !== 'true') {
            try {
                const hasRemoteData = await checkRemoteDataExists();
                if (hasRemoteData) {
                    await writeCloudPreference('cloudSyncEnabled', 'true');
                    shouldEnable = true;
                } else {
                    _cloudSyncPromptNeeded = true;
                }
            } catch {
                // Network error — leave disabled
            }
        }
    }

    STATE.enabled = shouldEnable;
    if (!STATE.enabled) return;

    if (!isClerkEnabled() || !isSignedIn()) return;

    // Load last sync time from local state
    try {
        const lastSyncStr = await readLocalFile('preferences/cloudSync');
        if (lastSyncStr) {
            const parsed = JSON.parse(lastSyncStr) as { lastSyncTime: string };
            STATE.lastSyncTime = parsed.lastSyncTime;
        }
    } catch {
        // No previous sync state
    }

    // Check if journal is empty (first run) — do initial sync
    const checkpoint = getCheckpoint();
    if (checkpoint.lastId === 0) {
        // First run: push local first to establish baseline, then pull
        try {
            await syncBothWays();
        } catch {
            // Cloud not available — local data is preserved
        }
    } else {
        // Push local changes
        await syncToCloud();
    }

    // Start periodic sync timer
    if (syncTimerHandle) clearInterval(syncTimerHandle);
    syncTimerHandle = setInterval(() => {
        syncFromCloud().catch(console.error);
    }, SYNC_INTERVAL_MS);

    // Initial credential sync (awaited so credentials are in OPFS before mount)
    await syncCredentialsFromCloud(true).catch(console.error);
}

export async function enableCloudSync(): Promise<void> {
    _cloudSyncPromptNeeded = false;
    STATE.enabled = true;
    await writeCloudPreference('cloudSyncEnabled', 'true');
    await initCloudSync();
}

export async function disableCloudSync(): Promise<void> {
    STATE.enabled = false;
    if (syncTimerHandle) {
        clearInterval(syncTimerHandle);
        syncTimerHandle = null;
    }
    if (syncDebounceTimer) {
        clearTimeout(syncDebounceTimer);
        syncDebounceTimer = null;
    }
    await writeCloudPreference('cloudSyncEnabled', 'false');
}

export function queueSync(): void {
    if (!STATE.enabled) return;
    if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(() => {
        syncToCloud().catch(console.error);
    }, SYNC_DEBOUNCE_MS);
}

export async function triggerManualSync(): Promise<void> {
    STATE.lastSyncError = null;
    try {
        await syncBothWays();
    } catch (err) {
        STATE.lastSyncError = err instanceof Error ? err.message : String(err);
        throw err;
    }
}

export async function triggerCompleteResync(): Promise<void> {
    STATE.lastSyncError = null;
    try {
        await syncResetThenPull();
    } catch (err) {
        STATE.lastSyncError = err instanceof Error ? err.message : String(err);
        throw err;
    }
}

export async function setDeleteRemoteOnLocalDelete(value: boolean): Promise<void> {
    allowCloudDeletionsCache = value;
    await writeCloudPreference('cloudSyncDeleteRemote', value ? 'true' : 'false');
}
