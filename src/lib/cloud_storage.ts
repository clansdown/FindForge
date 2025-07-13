import { authorizeDrive, createDriveFolder, isGoogleDriveSetUp, listDriveFiles, writeDriveFile } from './google_drive';
import { type MessageData, type ConversationData, type Config } from './types';

export enum StorageProvider {
    GoogleDrive = 'google_drive',
    // Future backends could include:
    // Dropbox = 'dropbox',
    // OneDrive = 'onedrive',
    // etc.
}

let currentProvider: StorageProvider | null = null;
let isInitialized = false;

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
/**
 * Initializes cloud storage with a specific provider if configured
 * @returns Promise resolving to true if a cloud provider was configured, false otherwise
 */
export async function initCloudStorage(): Promise<boolean> {
    if (isInitialized) {
        return currentProvider !== null;
    }

    // Check for Google Drive first
    if (isGoogleDriveSetUp()) {
        currentProvider = StorageProvider.GoogleDrive;
        try {
            await authorizeDrive(false); // Initialize silently if possible
            isInitialized = true;
            return true;
        } catch (err) {
            console.warn('Failed to initialize Google Drive', err);
            currentProvider = null;
        }
    }

    // Future: Add checks for other providers here
    isInitialized = true;
    return false;
}

export async function calculateStorageUsed(provider?: StorageProvider): Promise<number> {
    await ensureInitialized();
    const targetProvider = provider || currentProvider;
    
    if (targetProvider === StorageProvider.GoogleDrive) {
        const files = await listDriveFiles();
        return files.files?.reduce((sum, file) => sum + (parseInt(file.size || '0') || 0), 0) || 0;
    }
    
    throw new Error(`Storage provider ${targetProvider} not implemented`);
}

function ensureInitialized(): Promise<void> {
    if (!isInitialized) {
        return initCloudStorage().then();
    }
    return Promise.resolve();
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
    provider?: StorageProvider
): Promise<StorageDirectory> {
    await ensureInitialized();
    const targetProvider = provider || currentProvider;
    
    if (!targetProvider) {
        throw new Error('No cloud storage provider configured');
    }

    if (targetProvider === StorageProvider.GoogleDrive) {
        const parts = path.split('/').filter(p => p.trim() !== '');
        let currentParentId : string = 'appDataFolder';
        
        for (const part of parts) {
            // Search for existing folder
            const response = await gapi.client.drive.files.list({
                q: `'${currentParentId}' in parents and name='${part}' and trashed = false and mimeType='application/vnd.google-apps.folder'`,
                spaces: 'appDataFolder',
                fields: 'files(id,name,modifiedTime)'
            });
            
            if (response.result.files?.length) {
                if (response.result.files[0].id) {
                    currentParentId = response.result.files[0].id;
                } else {
                    throw new Error(`Folder ${part} found but has no ID`);
                }
            } else if (createIfMissing) {
                currentParentId = await createDriveFolder(part, currentParentId);
            } else {
                throw new Error(`Directory not found: ${part}`);
            }
        }

        return {
            id: currentParentId,
            name: parts[parts.length - 1] || 'appDataFolder',
            path,
            lastModified: new Date()
        };
    }
    
    throw new Error(`Storage provider ${targetProvider} not implemented`);
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
    provider?: StorageProvider
): Promise<StorageFile> {
    await ensureInitialized();
    const targetProvider = provider || currentProvider;
    
    if (!targetProvider) {
        throw new Error('No cloud storage provider configured');
    }

    if (targetProvider === StorageProvider.GoogleDrive) {
        let parentPath = path.split('/').slice(0, -1).join('/');
        parentPath = parentPath || '.';
        const fileName = path.split('/').slice(-1)[0];
        
        const dirHandle = await getDirectoryHandle(parentPath, true);
        const fileId = await writeDriveFile(fileName, data.toString(), dirHandle.id);
        
        return {
            id: fileId,
            name: fileName,
            path,
            size: data instanceof ArrayBuffer ? data.byteLength : 
                  data instanceof Blob ? data.size :
                  typeof data === 'string' ? new TextEncoder().encode(data).length : 0,
            mimeType,
            lastModified: new Date()
        };
    }
    
    throw new Error(`Storage provider ${targetProvider} not implemented`);
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
export async function isCloudStorageReady(provider?: StorageProvider): Promise<boolean> {
    if (!isInitialized) {
        await initCloudStorage();
    }
    const targetProvider = provider || currentProvider;
    return !!targetProvider;
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
