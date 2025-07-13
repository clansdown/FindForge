import { type MessageData, type ConversationData, type Config } from './types';

export enum StorageProvider {
    GoogleDrive = 'google_drive',
    // Future backends could include:
    // Dropbox = 'dropbox',
    // OneDrive = 'onedrive',
    // etc.
}

export interface StorageQuota {
    used: number; // bytes
    total: number; // bytes
    // Additional provider-specific fields could be added here
}

export interface StorageFile {
    id: string;
    name: string;
    path: string;
    size: number;
    mimeType: string;
    lastModified: Date;
    parentId?: string;
}

export interface StorageDirectory {
    id: string;
    name: string;
    path: string;
    lastModified: Date;
    parentId?: string;
}

/**
 * Calculates the amount of storage used by the app across all backends
 * @param provider Optional specific provider to check, checks all if undefined
 * @returns Promise resolving to storage used in bytes
 */
export async function calculateStorageUsed(provider?: StorageProvider): Promise<number> {
    // TODO: Implement based on selected provider
    throw new Error('Not implemented');
}

/**
 * Gets storage quota information for the current user
 * @param provider Storage provider to check quota for
 * @returns Promise resolving to StorageQuota object
 */
export async function getStorageQuota(provider: StorageProvider): Promise<StorageQuota> {
    // TODO: Implement based on selected provider
    throw new Error('Not implemented');
}

/**
 * Gets a handle to a directory in cloud storage
 * @param path Path to directory
 * @param createIfMissing Whether to create directory if it doesn't exist
 * @param provider Storage provider to use
 * @returns Promise resolving to directory handle
 */
export async function getDirectoryHandle(
    path: string,
    createIfMissing = false,
    provider: StorageProvider = StorageProvider.GoogleDrive
): Promise<StorageDirectory> {
    // TODO: Implement based on selected provider
    throw new Error('Not implemented');
}

/**
 * Creates a new directory in cloud storage
 * @param name Name of new directory
 * @param parentId Optional parent directory ID
 * @param provider Storage provider to use
 * @returns Promise resolving to created directory handle
 */
export async function createDirectory(
    name: string,
    parentId?: string,
    provider: StorageProvider = StorageProvider.GoogleDrive
): Promise<StorageDirectory> {
    // TODO: Implement based on selected provider
    throw new Error('Not implemented');
}

/**
 * Writes data to a file in cloud storage
 * @param path Full path to file including name
 * @param data File contents
 * @param mimeType MIME type of file
 * @param provider Storage provider to use
 * @returns Promise resolving when write is complete
 */
export async function writeFile(
    path: string,
    data: string | ArrayBuffer | Blob,
    mimeType: string,
    provider: StorageProvider = StorageProvider.GoogleDrive
): Promise<StorageFile> {
    // TODO: Implement based on selected provider
    throw new Error('Not implemented');
}

/**
 * Reads a file from cloud storage
 * @param fileId ID or path of file to read
 * @param provider Storage provider to use
 * @returns Promise resolving to file contents as string
 */
export async function readFile(
    fileId: string,
    provider: StorageProvider = StorageProvider.GoogleDrive
): Promise<string> {
    // TODO: Implement based on selected provider
    throw new Error('Not implemented');
}

/**
 * Lists contents of a directory
 * @param directoryId ID or path of directory to list
 * @param provider Storage provider to use
 * @returns Promise resolving to array of files and directories
 */
export async function getDirectoryList(
    directoryId: string,
    provider: StorageProvider = StorageProvider.GoogleDrive
): Promise<{ files: StorageFile[]; directories: StorageDirectory[] }> {
    // TODO: Implement based on selected provider
    throw new Error('Not implemented');
}

/**
 * Checks if cloud storage is available and initialized
 * @param provider Storage provider to check
 * @returns Promise resolving to boolean indicating if storage is ready
 */
export async function isCloudStorageReady(provider: StorageProvider): Promise<boolean> {
    // TODO: Implement based on selected provider
    throw new Error('Not implemented');
}

/**
 * Migrates local data to cloud storage
 * @param provider Storage provider to migrate to
 * @param progressCallback Optional progress callback
 * @returns Promise resolving when migration is complete
 */
export async function migrateToCloudStorage(
    provider: StorageProvider,
    progressCallback?: (progress: number) => void
): Promise<void> {
    // TODO: Implement migration logic
    throw new Error('Not implemented');
}

/**
 * Downloads all cloud storage data to local storage
 * @param provider Storage provider to download from
 * @param progressCallback Optional progress callback
 * @returns Promise resolving when download is complete
 */
export async function downloadFromCloudStorage(
    provider: StorageProvider,
    progressCallback?: (progress: number) => void
): Promise<void> {
    // TODO: Implement download logic
    throw new Error('Not implemented');
}
