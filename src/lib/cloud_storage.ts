import { authorizeDrive, createDriveFolder, deleteDriveFileByName, doesGoogleDriveTokenNeedRefresh, isGoogleDriveSetUp, listDriveFiles, writeDriveFile } from './google_drive';
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

/**
 * Checks if any cloud storage provider is configured for use
 * (Does not check if authentication is still valid)
 * @returns true if a cloud provider is set up, false otherwise
 */
export function isCloudStorageConfigured(): boolean {
    // Check for Google Drive first
    if (isGoogleDriveSetUp()) {
        return true;
    }
    // Future: Add checks for other providers here
    return false;
}

/**
 * Checks if cloud storage is configured but requires authentication
 * (e.g. token has expired)
 * @returns true if authentication is required, false otherwise
 */
export function doesCloudStorageRequireAuthentication(): boolean {
    if (!isCloudStorageConfigured()) {
        return false;
    }

    if (currentProvider === StorageProvider.GoogleDrive) {
        return doesGoogleDriveTokenNeedRefresh();
    }
    
    // Future: Add checks for other providers here
    
    // If no provider-specific check exists, default to false
    return false;
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

/**
 * Deletes a file by its path/name from cloud storage
 * @param path Full path to file including name (e.g. 'folder/file.txt')
 * @param provider Storage provider to use (defaults to current provider)
 * @throws Error if file is not found, path is invalid, or provider not configured
 */
export async function deleteFileByName(path: string): Promise<void> {
    await ensureInitialized();
    
    if (!currentProvider) {
        throw new Error('No cloud storage provider configured');
    }

    if (currentProvider === StorageProvider.GoogleDrive) {
        return deleteDriveFileByName(path);
    }
    
    throw new Error(`Storage provider ${currentProvider} not implemented`);
}

export async function calculateStorageUsed(): Promise<number> {
    await ensureInitialized();
    
    if (!currentProvider) {
        throw new Error('No cloud storage provider configured');
    }

    if (currentProvider === StorageProvider.GoogleDrive) {
        const files = await listDriveFiles();
        return files.files?.reduce((sum, file) => sum + (parseInt(file.size || '0') || 0), 0) || 0;
    }
    
    throw new Error(`Storage provider ${currentProvider} not implemented`);
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
export async function getCloudStorageQuota(provider: StorageProvider): Promise<StorageQuota> {
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
export async function getCloudDirectoryHandle(
    path: string, 
    createIfMissing = false
): Promise<StorageDirectory> {
    await ensureInitialized();
    
    if (!currentProvider) {
        throw new Error('No cloud storage provider configured');
    }

    if (currentProvider === StorageProvider.GoogleDrive) {
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
    
    throw new Error(`Storage provider ${currentProvider} not implemented`);
}

/**
 * Creates a new directory in cloud storage
 * @param name Name of new directory
 * @param parentId Optional parent directory ID
 * @param provider Storage provider to use
 * @returns Promise resolving to created directory handle
 */
export async function createCloudDirectory(
    name: string,
    parentId?: string
): Promise<StorageDirectory> {
    await ensureInitialized();
    
    if (!currentProvider) {
        throw new Error('No cloud storage provider configured');
    }

    if (currentProvider === StorageProvider.GoogleDrive) {
        const folderId = await createDriveFolder(name, parentId);
        return {
            id: folderId,
            name,
            path: name, // Simple path for single directory creation
            lastModified: new Date()
        };
    }
    
    throw new Error(`Storage provider ${currentProvider} not implemented`);
}

/**
 * Writes data to a file in cloud storage
 * @param path Full path to file including name
 * @param data File contents
 * @param mimeType MIME type of file
 * @param provider Storage provider to use
 * @returns Promise resolving when write is complete
 */
export async function writeCloudFile(
    path: string,
    data: string | ArrayBuffer | Blob, 
    mimeType: string
): Promise<StorageFile> {
    await ensureInitialized();
    
    if (!currentProvider) {
        throw new Error('No cloud storage provider configured');
    }

    if (currentProvider === StorageProvider.GoogleDrive) {
        let parentPath = path.split('/').slice(0, -1).join('/');
        parentPath = parentPath || '.';
        const fileName = path.split('/').slice(-1)[0];
        
        const dirHandle = await getCloudDirectoryHandle(parentPath, true);
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
    
    throw new Error(`Storage provider ${currentProvider} not implemented`);
}

/**
 * Reads a file from cloud storage
 * @param fileId ID or path of file to read
 * @param provider Storage provider to use
 * @returns Promise resolving to file contents as string
 */
export async function readCloudFile(fileId: string): Promise<string> {
    await ensureInitialized();
    
    if (!currentProvider) {
        throw new Error('No cloud storage provider configured');
    }

    if (currentProvider === StorageProvider.GoogleDrive) {
        const response = await gapi.client.drive.files.get({
            fileId: fileId,
            alt: 'media'
        });
        return response.body;
    }
    
    throw new Error(`Storage provider ${currentProvider} not implemented`);
}

/**
 * Lists contents of a directory
 * @param directoryId ID or path of directory to list
 * @param provider Storage provider to use
 * @returns Promise resolving to array of files and directories
 */
export async function getCloudDirectoryList(
    directoryId: string
): Promise<{ files: StorageFile[]; directories: StorageDirectory[] }> {
    await ensureInitialized();
    
    if (!currentProvider) {
        throw new Error('No cloud storage provider configured');
    }

    if (currentProvider === StorageProvider.GoogleDrive) {
        const response = await gapi.client.drive.files.list({
            q: `'${directoryId}' in parents and trashed = false`,
            fields: 'files(id,name,mimeType,modifiedTime,size)'
        });
        
        const files: StorageFile[] = [];
        const directories: StorageDirectory[] = [];
        
        response.result.files?.forEach(file => {
            const entry = {
                id: file.id || '',
                name: file.name || '',
                path: file.name || '',
                size: parseInt(file.size || '0'),
                mimeType: file.mimeType || '',
                lastModified: new Date(file.modifiedTime || ''),
                parentId: directoryId
            };
            
            if (file.mimeType === 'application/vnd.google-apps.folder') {
                directories.push(entry);
            } else {
                files.push(entry);
            }
        });
        
        return { files, directories };
    }
    
    throw new Error(`Storage provider ${currentProvider} not implemented`);
}

/**
 * Checks if cloud storage is available and initialized
 * @param provider Storage provider to check
 * @returns Promise resolving to boolean indicating if storage is ready
 * Logs any errors that occur rather than throwing them
 */
export async function isCloudStorageReady(): Promise<boolean> {
    try {
        if (!isInitialized) {
            await initCloudStorage().catch(e => {
                console.error('Error initializing cloud storage:', e);
                return false;
            });
        }
        return !!currentProvider;
    } catch (e) {
        console.error('Unexpected error in isCloudStorageReady:', e);
        return false;
    }
}

/**
 * Migrates local data to cloud storage
 * @param provider Storage provider to migrate to
 * @param progressCallback Optional progress callback
 * @returns Promise resolving when migration is complete
 */
export async function migrateToCloudStorage(progressCallback?: (progress: number) => void): Promise<void> {
    await ensureInitialized();
    
    if (!currentProvider) {
        throw new Error('No cloud storage provider configured');
    }

    // Make sure OPFS is available
    const { isOpfsReady, listOpfsDirectory, readOpfsFile } = await import('./opfs_storage');
    if (!await isOpfsReady()) {
        throw new Error('OPFS storage is not available');
    }

    // First count total items for progress tracking
    let totalItems = 0;
    async function countItems(path: string): Promise<number> {
        const { files, directories } = await listOpfsDirectory(path);
        let count = files.length;
        for (const dir of directories) {
            count += await countItems(dir.path);
        }
        return count;
    }
    totalItems = await countItems('.');

    if (totalItems === 0) {
        progressCallback?.(100);
        return; // Nothing to migrate
    }

    let processedItems = 0;
    
    async function migrateDirectory(path: string, parentId?: string): Promise<void> {
        const { files, directories } = await listOpfsDirectory(path);
        
        // Create directory structure first
        let cloudDirId = parentId;
        if (path !== '.') {
            const dirName = path.split('/').slice(-1)[0];
            cloudDirId = await createDriveFolder(dirName, parentId);
            processedItems++;
            progressCallback?.(Math.floor(processedItems / totalItems * 100));
        }

        // Migrate files
        for (const file of files) {
            const content = await readOpfsFile(file.path);
            await writeDriveFile(file.name, content, cloudDirId);
            processedItems++;
            progressCallback?.(Math.floor(processedItems / totalItems * 100));
        }

        // Recursively migrate subdirectories
        for (const dir of directories) {
            await migrateDirectory(dir.path, cloudDirId);
        }
    }

    await migrateDirectory('.');
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
