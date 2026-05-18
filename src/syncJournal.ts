import { getOPFSHandle } from './lib/opfs';
import type { SyncJournalEntry, SyncCheckpoint } from './types/cloudSync';

const JOURNAL_DIR = 'sync';
const JOURNAL_A = 'journal-a';
const JOURNAL_B = 'journal-b';
const CHECKPOINT_FILE = 'checkpoint';
const DIRTY_RECOVERY_KEY = 'syncJournal_dirtyRecovery';
const MAX_JOURNAL_ENTRIES = 10000;

let checkpoint: SyncCheckpoint = { lastId: 0, currentJournal: JOURNAL_A, lastCloudCheckTime: '' };
let dirtyEntries: Map<string, { action: SyncJournalEntry['action']; hash?: string }> = new Map();
let journalInitialized = false;
let initPromise: Promise<void> | null = null;

// Read cache — parsed entries cached per journal name
let cachedJournalName: string | null = null;
let cachedEntries: SyncJournalEntry[] | null = null;

async function getSyncDir(): Promise<FileSystemDirectoryHandle> {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(JOURNAL_DIR, { create: true });
}

async function getJournalHandle(name: string): Promise<FileSystemFileHandle> {
    const syncDir = await getSyncDir();
    return await syncDir.getFileHandle(name, { create: true });
}

async function appendToJournal(name: string, entry: SyncJournalEntry): Promise<void> {
    const fileHandle = await getJournalHandle(name);
    const file = await fileHandle.getFile();
    const writable = await fileHandle.createWritable({ keepExistingData: true });
    try {
        const position = file.size;
        await writable.seek(position);
        await writable.write(JSON.stringify(entry) + '\n');
        await writable.close();
    } catch (err) {
        await writable.abort();
        throw err;
    }
}

async function readJournalEntries(name: string): Promise<SyncJournalEntry[]> {
    // Return cached entries if reading the same journal
    if (cachedJournalName === name && cachedEntries !== null) {
        return cachedEntries;
    }

    try {
        const syncDir = await getSyncDir();
        const fileHandle = await syncDir.getFileHandle(name);
        const file = await fileHandle.getFile();
        const content = await file.text();
        if (!content.trim()) {
            cachedJournalName = name;
            cachedEntries = [];
            return [];
        }

        // Handle possible truncated last line (crash mid-write)
        const lines = content.split('\n');
        let lastValidIdx = lines.length - 1;
        while (lastValidIdx >= 0 && lines[lastValidIdx].trim() === '') {
            lastValidIdx--;
        }

        const entries: SyncJournalEntry[] = [];
        for (let i = 0; i <= lastValidIdx; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            try {
                entries.push(JSON.parse(line) as SyncJournalEntry);
            } catch {
                console.warn(`[syncJournal] Corrupt line ${i + 1} in ${name}, skipping`);
            }
        }

        cachedJournalName = name;
        cachedEntries = entries;
        return entries;
    } catch (err) {
        console.warn(`[syncJournal] Failed to read journal ${name}:`, err);
        return [];
    }
}

function invalidateCache(): void {
    cachedJournalName = null;
    cachedEntries = null;
}

async function saveCheckpoint(): Promise<void> {
    const syncDir = await getSyncDir();
    const fileHandle = await syncDir.getFileHandle(CHECKPOINT_FILE, { create: true });
    const writable = await fileHandle.createWritable();
    try {
        await writable.write(JSON.stringify(checkpoint));
        await writable.close();
    } catch (err) {
        await writable.abort();
        throw err;
    }
}

export async function init(): Promise<void> {
    if (journalInitialized) return;
    if (initPromise) {
        await initPromise;
        return;
    }

    initPromise = (async () => {
        await getOPFSHandle();

        // Load checkpoint
        try {
            const syncDir = await getSyncDir();
            const fileHandle = await syncDir.getFileHandle(CHECKPOINT_FILE);
            const file = await fileHandle.getFile();
            const content = await file.text();
            if (content) {
                const saved = JSON.parse(content) as SyncCheckpoint;
                if (saved.lastId !== undefined && saved.currentJournal && saved.lastCloudCheckTime !== undefined) {
                    checkpoint = saved;
                }
            }
        } catch {
            // No checkpoint yet, use defaults
        }

        // Try to read current journal; fall back to alternate on failure
        let entries = await readJournalEntries(checkpoint.currentJournal);
        if (entries.length === 0 && cachedEntries === null) {
            // Current journal might be corrupted — try alternate
            const alternate = checkpoint.currentJournal === JOURNAL_A ? JOURNAL_B : JOURNAL_A;
            const altEntries = await readJournalEntries(alternate);
            if (altEntries.length > 0) {
                console.warn(`[syncJournal] Recovering from alternate journal ${alternate}`);
                checkpoint.currentJournal = alternate;
                entries = altEntries;
                await saveCheckpoint();
            }
        }

        // Determine next ID from existing entries
        if (entries.length > 0) {
            const maxId = Math.max(...entries.map(e => e.id));
            if (maxId > checkpoint.lastId) {
                checkpoint.lastId = maxId;
            }
        }

        // Replay dirty recovery from localStorage (crash before drainQueue)
        await replayDirtyRecovery();

        journalInitialized = true;

        // Register beforeunload handler for best-effort crash recovery
        window.addEventListener('beforeunload', onBeforeUnload);
    })();

    await initPromise;
}

// ── Crash recovery: save dirty entries to localStorage on beforeunload ──

function onBeforeUnload(): void {
    if (dirtyEntries.size === 0) return;
    const recovery: Array<{ path: string; action: string; hash?: string }> = [];
    for (const [path, entry] of dirtyEntries) {
        recovery.push({ path, action: entry.action, hash: entry.hash });
    }
    try {
        localStorage.setItem(DIRTY_RECOVERY_KEY, JSON.stringify(recovery));
    } catch {
        // localStorage full or unavailable
    }
}

async function replayDirtyRecovery(): Promise<void> {
    try {
        const raw = localStorage.getItem(DIRTY_RECOVERY_KEY);
        if (!raw) return;
        const recovery = JSON.parse(raw) as Array<{ path: string; action: SyncJournalEntry['action']; hash?: string }>;
        for (const item of recovery) {
            dirtyEntries.set(item.path, { action: item.action, hash: item.hash });
        }
        localStorage.removeItem(DIRTY_RECOVERY_KEY);
    } catch {
        localStorage.removeItem(DIRTY_RECOVERY_KEY);
    }
}

// ── Journal rotation with proper cleanup ──

async function rotateJournal(): Promise<void> {
    const oldJournal = checkpoint.currentJournal;
    const newJournal = oldJournal === JOURNAL_A ? JOURNAL_B : JOURNAL_A;

    // Truncate the target journal
    const syncDir = await getSyncDir();
    try {
        await syncDir.removeEntry(newJournal);
    } catch {
        // Doesn't exist, that's fine
    }

    checkpoint.currentJournal = newJournal;
    await saveCheckpoint();
    invalidateCache();

    // Delete old journal after rotation is confirmed (checkpoint saved)
    try {
        await syncDir.removeEntry(oldJournal);
    } catch {
        // Old journal may not exist, that's fine
    }
}

// ── Public instrumentation API ──

export function recordWrite(path: string, hash: string): void {
    dirtyEntries.set(path, { action: 'write', hash });
}

export function recordDelete(path: string): void {
    dirtyEntries.set(path, { action: 'delete' });
}

export function recordDeleteRecursive(path: string): void {
    dirtyEntries.set(path, { action: 'delete_recursive' });
}

export async function drainQueue(): Promise<void> {
    if (dirtyEntries.size === 0) return;
    if (!journalInitialized) await init();

    const entries = await readJournalEntries(checkpoint.currentJournal);
    if (entries.length >= MAX_JOURNAL_ENTRIES) {
        await rotateJournal();
    }

    invalidateCache();

    const drained = dirtyEntries;
    dirtyEntries = new Map();
    const sortedPaths = [...drained.keys()].sort();
    for (const path of sortedPaths) {
        const entry = drained.get(path)!;
        checkpoint.lastId += 1;
        const journalEntry: SyncJournalEntry = {
            id: checkpoint.lastId,
            action: entry.action,
            path,
            hash: entry.hash,
            timestampMs: Date.now()
        };
        await appendToJournal(checkpoint.currentJournal, journalEntry);
    }

    await saveCheckpoint();

    // Clear recovery data since entries are now persisted
    try {
        localStorage.removeItem(DIRTY_RECOVERY_KEY);
    } catch { /* ignore */ }
}

export function getCheckpoint(): SyncCheckpoint {
    return { ...checkpoint };
}

export async function setLastCloudCheckTime(iso: string): Promise<void> {
    checkpoint.lastCloudCheckTime = iso;
    await saveCheckpoint();
}

export async function getJournalEntriesSince(lastId: number): Promise<SyncJournalEntry[]> {
    if (!journalInitialized) await init();
    let entries = await readJournalEntries(checkpoint.currentJournal);

    // If lastId predates the current journal, also check alternate
    if (entries.length > 0 && entries[0].id > lastId + 1) {
        const alternate = checkpoint.currentJournal === JOURNAL_A ? JOURNAL_B : JOURNAL_A;
        const altEntries = await readJournalEntries(alternate);
        if (altEntries.length > 0) {
            entries = [...altEntries, ...entries];
        }
    }

    return entries.filter(e => e.id > lastId);
}

// ── Journal truncation after successful sync ──

export async function truncateJournalEntriesBefore(syncedId: number): Promise<void> {
    if (syncedId <= 0) return;
    if (!journalInitialized) await init();

    const entries = await readJournalEntries(checkpoint.currentJournal);
    const kept = entries.filter(e => e.id > syncedId);

    if (kept.length === entries.length) return;

    // Rewrite journal with only un-synced entries
    const syncDir = await getSyncDir();
    const fileHandle = await syncDir.getFileHandle(checkpoint.currentJournal, { create: true });
    const writable = await fileHandle.createWritable();
    try {
        for (const entry of kept) {
            await writable.write(JSON.stringify(entry) + '\n');
        }
        await writable.close();
    } catch (err) {
        await writable.abort();
        throw err;
    }

    invalidateCache();
    await saveCheckpoint();
}