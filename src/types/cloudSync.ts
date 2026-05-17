export interface SyncFileInfo {
    path: string;
    etag: string;
    size: number;
    lastModified: string;
}

export interface SyncConflict {
    path: string;
    localHash: string;
    remoteEtag: string;
}

export interface SyncDeletion {
    path: string;
    source: 'local' | 'remote';
}

export interface SyncActions {
    uploads: string[];
    downloads: string[];
    conflicts: SyncConflict[];
    deletions: SyncDeletion[];
}

export interface SyncManifestEntry {
    hash: string;
    etag: string;
    mtime: string;
}

export type SyncManifest = Record<string, SyncManifestEntry>;

export interface SyncJournalEntry {
    id: number;
    action: 'write' | 'delete' | 'delete_recursive';
    path: string;
    hash?: string;
    timestampMs: number;
}

export interface SyncCheckpoint {
    lastId: number;
    currentJournal: string;
    lastCloudCheckTime: string;
}

export interface CloudState {
    lastUpdateTime: string;
}

export interface WorkerErrorResponse {
    error: string;
    code: string;
}
