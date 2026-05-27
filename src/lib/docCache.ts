// ── Persistent document cache (OPFS-backed, LRU eviction) ──
//
// Stored under /research/doc-cache/ within the app's OPFS namespace.
// Cache files are NEVER synced to the cloud — the sync engine ignores
// the doc-cache/ prefix (see SYNC_IGNORE_PREFIXES in cloudSync.ts).
//
// Keys are URLs. Two cache layers:
//   {url}             → raw fetched content (PDF, HTML, etc.)
//   extracted:{docId}  → post-conversion markdown (from extract2md)
//
// Size limit is read from /cloud/preferences/docCacheSizeLimit (default 1 GB).
// When full, the least-recently-accessed entries are evicted first.

import { computeHash } from '../cloudSync';
import { readCloudPreference, writeCloudPreference } from './opfs';

// ── Types ──

interface DocCacheEntry {
    key: string;
    dataFile: string;
    size: number;
    contentType: string;
    writeTime: number;
    accessTime: number;
}

interface DocCacheIndex {
    entries: DocCacheEntry[];
}

// ── Constants ──

const CACHE_DIR = 'research/doc-cache';
const INDEX_FILE = 'index.json';
const DATA_DIR = 'data';
export const DEFAULT_MAX_SIZE = 1_073_741_824; // 1 GB
const PREFERENCE_KEY = 'docCacheSizeLimit';

// ── PWA detection ──

export function isPwaInstalled(): boolean {
    return (
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as any).standalone === true
    );
}

// ── OPFS helpers ──

async function getRoot(): Promise<FileSystemDirectoryHandle> {
    return navigator.storage.getDirectory();
}

async function resolveDir(path: string, create = false): Promise<FileSystemDirectoryHandle> {
    const parts = path.split('/').filter(Boolean);
    let dir = await getRoot();
    for (const part of parts) {
        dir = await dir.getDirectoryHandle(part, { create });
    }
    return dir;
}

async function getCacheDir(create = false): Promise<FileSystemDirectoryHandle> {
    return resolveDir(CACHE_DIR, create);
}

async function getDataDir(create = false): Promise<FileSystemDirectoryHandle> {
    const cache = await getCacheDir(create);
    return cache.getDirectoryHandle(DATA_DIR, { create });
}

// ── Index I/O ──

async function readIndex(): Promise<DocCacheIndex> {
    try {
        const cache = await getCacheDir(false);
        const file = await cache.getFileHandle(INDEX_FILE);
        const blob = await file.getFile();
        return JSON.parse(await blob.text());
    } catch {
        return { entries: [] };
    }
}

async function writeIndex(index: DocCacheIndex): Promise<void> {
    const cache = await getCacheDir(true);
    const file = await cache.getFileHandle(INDEX_FILE, { create: true });
    const writable = await file.createWritable();
    try {
        await writable.write(JSON.stringify(index));
        await writable.close();
    } catch (e) {
        await writable.abort();
        throw e;
    }
}

function totalSize(index: DocCacheIndex): number {
    return index.entries.reduce((s, e) => s + e.size, 0);
}

// ── LRU eviction ──

async function evictLru(index: DocCacheIndex, targetBytes: number): Promise<DocCacheIndex> {
    const dataDir = await getDataDir(true);
    const sorted = [...index.entries].sort((a, b) => a.accessTime - b.accessTime);
    let remaining = [...index.entries];

    while (totalSize({ entries: remaining }) > targetBytes && remaining.length > 0) {
        const oldest = remaining.sort((a, b) => a.accessTime - b.accessTime)[0];
        try {
            await dataDir.removeEntry(oldest.dataFile);
        } catch { /* already gone */ }
        remaining = remaining.filter(e => e.dataFile !== oldest.dataFile);
    }

    return { entries: remaining };
}

// ── Limit ──

async function loadLimit(): Promise<number> {
    const val = await readCloudPreference(PREFERENCE_KEY);
    if (val == null) return DEFAULT_MAX_SIZE;
    const n = Number(val);
    return isNaN(n) ? DEFAULT_MAX_SIZE : n;
}

/** Persist a new size limit. Returns the saved value (clamped). */
export async function setSizeLimit(bytes: number): Promise<number> {
    const clamped = Math.max(1024 * 1024, Math.min(bytes, 10 * DEFAULT_MAX_SIZE));
    await writeCloudPreference(PREFERENCE_KEY, String(clamped));
    return clamped;
}

// ── Public API ──

/** Retrieve cached content by key URL. Returns null on miss. Updates accessTime on hit. */
export async function getFromCache(key: string): Promise<Blob | null> {
    const index = await readIndex();
    const entry = index.entries.find(e => e.key === key);
    if (!entry) return null;

    entry.accessTime = Date.now();
    await writeIndex(index);

    try {
        const dataDir = await getDataDir(false);
        const file = await dataDir.getFileHandle(entry.dataFile);
        return await file.getFile();
    } catch {
        index.entries = index.entries.filter(e => e.key !== key);
        await writeIndex(index);
        return null;
    }
}

/** Store content in the cache. Evicts LRU entries if over the configured limit. */
export async function addToCache(
    key: string,
    data: Blob | string,
    contentType: string,
): Promise<void> {
    const blob = typeof data === 'string' ? new Blob([data], { type: contentType }) : data;
    const dataFile = computeHash(key);
    const limit = await loadLimit();

    let index = await readIndex();

    // Remove previous entry for same key
    const existing = index.entries.find(e => e.key === key);
    if (existing) {
        try {
            const dataDir = await getDataDir(false);
            await dataDir.removeEntry(existing.dataFile);
        } catch { /* ok */ }
        index.entries = index.entries.filter(e => e.key !== key);
    }

    // Evict if needed
    const newSize = blob.size;
    if (totalSize(index) + newSize > limit) {
        index = await evictLru(index, limit - newSize);
    }

    // Warn non-PWA users near capacity
    if (!isPwaInstalled()) {
        const usedAfter = totalSize(index) + newSize;
        const pct = (usedAfter / limit) * 100;
        if (pct > 90) {
            console.warn(
                `[docCache] ${usedAfter} / ${limit} bytes used (${pct.toFixed(0)}%). ` +
                `Install the app for unlimited local storage.`,
            );
        }
    }

    // Write data file
    const dataDir = await getDataDir(true);
    const fh = await dataDir.getFileHandle(dataFile, { create: true });
    const writable = await fh.createWritable();
    try {
        await writable.write(blob);
        await writable.close();
    } catch (e) {
        await writable.abort();
        throw e;
    }

    const now = Date.now();
    index.entries.push({ key, dataFile, size: newSize, contentType, writeTime: now, accessTime: now });
    await writeIndex(index);
}

/** Remove a single entry from the cache. */
export async function removeFromCache(key: string): Promise<void> {
    const index = await readIndex();
    const entry = index.entries.find(e => e.key === key);
    if (!entry) return;
    try {
        const dataDir = await getDataDir(false);
        await dataDir.removeEntry(entry.dataFile);
    } catch { /* ok */ }
    index.entries = index.entries.filter(e => e.key !== key);
    await writeIndex(index);
}

/** Get current cache usage stats. */
export async function getCacheStats(): Promise<{ usedBytes: number; entryCount: number; limitBytes: number }> {
    const limit = await loadLimit();
    const index = await readIndex();
    return { usedBytes: totalSize(index), entryCount: index.entries.length, limitBytes: limit };
}

/** Delete the entire cache (directory and all files). */
export async function clearCache(): Promise<void> {
    const root = await getRoot();
    try {
        const cache = await root.getDirectoryHandle(CACHE_DIR.split('/')[0]);
        await cache.removeEntry(CACHE_DIR.split('/').slice(1).join('/'), { recursive: true });
    } catch { /* already gone */ }
}
