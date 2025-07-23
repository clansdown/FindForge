import type { StorageProvider } from './cloud_storage';
import type { OPFSFileWithContent } from './opfs_storage';
import { getLocalPreference, setLocalPreference } from './storage';

interface GoogleDriveFile {
    id: string;
    name: string;
    mimeType: string;
    modifiedTime: string;
    parents?: string[];
    kind: string;
    size?: string;
    webViewLink?: string;
    capabilities?: {
        canDownload?: boolean;
        canEdit?: boolean;
    };
}

type GoogleFileList = gapi.client.drive.FileList;

interface GoogleTokenResponse {
    access_token: string;
    expires_in: number;
    token_type: string;
    scope: string;
}

interface StoredGoogleTokenResponse extends GoogleTokenResponse {
    expires_at: number;
}

declare global {
    interface Window { 
        google: any;
        googleAccountsId: any;
    }
}

interface GoogleApiConfig {
    CLIENT_ID: string;
    API_KEY: string;
}

let googleApiConfig: GoogleApiConfig | null = null;
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const STORAGE_KEY = "googleDriveCredentials";
const GAPI_DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest";

/**
 * Checks if Google Drive is set up and has a valid auth token ready to use
 * @returns true if configured with valid token, false otherwise
 */
export function isGoogleDriveSetUp(): boolean {
    const savedToken = getLocalPreference<StoredGoogleTokenResponse | null>(STORAGE_KEY, null);
    return !!savedToken?.access_token && Date.now() < savedToken.expires_at;
}


let tokenClient: any;
let gapiInitialized = false;
let gisInitialized = false;
let pendingGapiInitialize: (() => void) | null = null;
let pendingGisInitialize: (() => void) | null = null;

// Expose ready handlers to window for script onload
declare global {
  interface Window {
    gapiReady?: () => void;
    gsiReady?: () => void;
  }
}

// Set up ready handlers to trigger any pending initializations
window.gapiReady = () => {
  if (pendingGapiInitialize) {
    pendingGapiInitialize();
    pendingGapiInitialize = null;
  }
};

window.gsiReady = () => {
  if (pendingGisInitialize) {
    pendingGisInitialize();
    pendingGisInitialize = null;
  }
};

/**
 * Load and initialize the Google API client library
 */
async function loadGoogleApiConfig(): Promise<void> {
    if (!googleApiConfig) {
        const response = await fetch('/google_api_config.json');
        googleApiConfig = await response.json();
        if (!googleApiConfig?.CLIENT_ID || !googleApiConfig?.API_KEY) {
            throw new Error('Invalid Google API config format');
        }
    }
}

async function initializeGapiClient(): Promise<void> {
    if (gapiInitialized) {
        return Promise.resolve();
    }

    await loadGoogleApiConfig();

    if (!window.gapi) {
        return new Promise((resolve, reject) => {
            pendingGapiInitialize = async () => {
                try {
                    await doGapiInitialize();
                    resolve();
                } catch (err) {
                    reject(err);
                }
            };
        });
    }

    return doGapiInitialize();
}

function doGapiInitialize(): Promise<void> {
    if (gapiInitialized) {
        return Promise.resolve();
    }

    console.log('Loading Google API client library...');
    
    return new Promise((resolve, reject) => {
        gapi.load('client', async () => {
                try {
                    await gapi.client.init({
                        apiKey: googleApiConfig!.API_KEY,
                        discoveryDocs: [GAPI_DISCOVERY_DOC],
                    });
                    gapiInitialized = true;
                    console.log('Google API client initialized successfully');
                    resolve();
                } catch (error) {
                    console.error('Failed to initialize Google API client:', error);
                    reject(new Error('Failed to initialize Google API client'));
                }
            }
        );
    });
}



/**
 * Initialize the Google Identity Services client
 */
function initializeGisClient(): Promise<void> {
    if (gisInitialized) {
        return Promise.resolve();
    }

    if (!window.google?.accounts?.oauth2) {
        return new Promise((resolve, reject) => {
            pendingGisInitialize = () => {
                try {
                    doGisInitialize();
                    resolve();
                } catch (err) {
                    reject(err);
                }
            };
        });
    }

    return Promise.resolve().then(() => doGisInitialize());
}

function doGisInitialize(): void {
    try {
        tokenClient = window.google.accounts.oauth2.initTokenClient({
            client_id: googleApiConfig!.CLIENT_ID,
            scope: GOOGLE_DRIVE_SCOPE,
            callback: '', // Defined later
            error_callback: (err: any) => {
                console.error('GIS error callback triggered:', err);
            }
        });
        gisInitialized = true;
    } catch (error) {
        console.error('Failed to initialize GIS token client.', error);
    }
}

/**
 * Initializes both GIS and GAPI clients
 */
async function initializeGoogleClients(): Promise<void> {
    await Promise.all([
        initializeGapiClient(),
        initializeGisClient()
    ]);
}

/**
 * Shows Google One Tap sign-in UI
 */
export function showGoogleOneTap(
    callback: (credential: string) => void,
    cancelCallback?: () => void
) {
    window.google?.accounts.id.initialize({
        client_id: googleApiConfig!.CLIENT_ID,
        callback: (response: {credential: string}) => {
            callback(response.credential);
        },
        cancel_callback: cancelCallback,
    });
    window.google?.accounts.id.prompt();
}

/**
 * Internal helper to handle the actual authorization flow after clients are initialized
 */
async function _authorizeDriveInner(interactive: boolean = true): Promise<void> {
    const savedToken = getLocalPreference<StoredGoogleTokenResponse | null>(STORAGE_KEY, null);
    // Subtract a minute (60000ms) to be safe and refresh token before it expires.
    if (savedToken?.access_token && Date.now() < savedToken.expires_at - 60000) {
        gapi.client.setToken(savedToken);
        return;
    }

    if (savedToken) {
        console.log('Google Drive token is invalid or expired, requesting new token...', savedToken);
    } else {
        console.log('No Google Drive token found, requesting new token...');
    }

    return new Promise((resolve, reject) => {
        tokenClient.callback = (response: GoogleTokenResponse & { error?: any }) => {
            if (response.error) {
                console.error('Error getting access token from Google:', response.error);
                return reject(new Error(`Failed to get access token: ${response.error}`));
            }

            if (response.access_token) {
                console.log('Successfully obtained new access token.');
                const storedToken: StoredGoogleTokenResponse = {
                    ...response,
                    expires_at: Date.now() + response.expires_in * 1000,
                };
                gapi.client.setToken(storedToken);
                setLocalPreference(STORAGE_KEY, storedToken);
                resolve();
            } else {
                console.error('Failed to get access token: response did not contain access_token.');
                reject(new Error('Failed to get access token: response did not contain access_token.'));
            }
        };

        try {
            // Request a new token
            console.log(`Requesting access token (interactive: ${interactive})...`);
            if (interactive) {
                tokenClient.requestAccessToken({ prompt: 'consent' });
            } else {
                tokenClient.requestAccessToken({ prompt: '' });
            }
        } catch (err) {
            console.error('Error calling requestAccessToken:', err);
            reject(err);
        }
    });
}

/**
 * Requests authorization token and initializes the Drive client
 */
export async function authorizeDrive(interactive: boolean = true): Promise<void> {
    await initializeGapiClient();
    await initializeGisClient();
    
    if (!gisInitialized) {
        throw new Error('Google Identity Services client not initialized');
    }

    return _authorizeDriveInner(interactive);
}

/**
 * Lists files and folders in Google Drive AppData folder
 */
export async function listDriveFiles(path?: string): Promise<GoogleFileList> {
    await authorizeDrive();

    const query = path 
        ? `'${path}' in parents and trashed = false` 
        : "'appDataFolder' in parents and trashed = false";
    
    try {
        const response = await gapi.client.drive.files.list({
            q: query,
            spaces: 'appDataFolder',
            fields: 'nextPageToken, incompleteSearch, files(id, name, mimeType, modifiedTime, parents, kind, size, webViewLink, capabilities)'
        });
        return response.result as GoogleFileList;
    } catch (error) {
        console.error('Error listing Drive files:', error);
        throw error;
    }
}

/**
 * Reads file contents from Google Drive
 */
export async function readDriveFile(fileId: string): Promise<string> {
    await authorizeDrive();
    try {
        const response = await gapi.client.drive.files.get({
            fileId: fileId,
            alt: 'media'
        });
        return response.body;
    } catch (error) {
        console.error('Error reading Drive file:', error);
        throw error;
    }
}

/**
 * Creates a folder in Google Drive AppData
 */
export async function createDriveFolder(name: string, parentId?: string): Promise<string> {
    await authorizeDrive();
    const folderMetadata = {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: parentId ? [parentId] : ['appDataFolder']
    };

    try {
        const response = await gapi.client.drive.files.create({
            resource: folderMetadata,
            fields: 'id'
        });
        
        if (!response.result?.id) {
            throw new Error('Failed to create folder - no ID returned from Google Drive API');
        }
        return response.result.id;
    } catch (error) {
        console.error('Error creating Drive folder:', error);
        throw error;
    }
}

/**
 * Writes file to Google Drive AppData folder using multipart upload
 */
/**
 * Deletes a file from Google Drive
 * @param fileId The ID of the file to delete
 */
export async function deleteDriveFile(fileId: string): Promise<void> {
    await authorizeDrive();
    try {
        await gapi.client.drive.files.delete({
            fileId: fileId
        });
    } catch (error) {
        console.error('Error deleting Drive file:', error);
        throw error;
    }
}

/**
 * Deletes a file in Google Drive by its path/name
 * @param filePath Path to the file including name (e.g. 'folder/file.txt')
 * @throws Error if file is not found or path is invalid
 */
export async function deleteDriveFileByName(filePath: string): Promise<void> {
    const parts = filePath.split('/');
    let parentId = 'appDataFolder';
    
    // Traverse path components (if any)
    for (let i = 0; i < parts.length - 1; i++) {
        const folderName = parts[i];
        const query = `name = '${folderName}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        const response = await gapi.client.drive.files.list({
            q: query,
            fields: 'files(id)',
            spaces: 'appDataFolder'
        });
        
        if (!response.result.files?.length) {
            throw new Error(`Folder not found: ${parts.slice(0, i+1).join('/')}`);
        }
        parentId = response.result.files[0].id!;
    }

    // Find the actual file
    const fileName = parts[parts.length - 1];
    const query = `name = '${fileName}' and '${parentId}' in parents and trashed = false`;
    const response = await gapi.client.drive.files.list({
        q: query,
        fields: 'files(id)',
        spaces: 'appDataFolder'
    });

    if (!response.result.files?.length) {
        throw new Error(`File not found: ${filePath}`);
    }

    // Delete the file by ID
    await deleteDriveFile(response.result.files[0].id!);
}

/**
 * Migrates files from OPFS to Google Drive, preserving directory structure and metadata
 * @param files Async iterator of OPFS files to migrate
 * @param progressCallback Optional callback to report progress
 */
export async function migrateToGoogleDrive(
    files: AsyncGenerator<OPFSFileWithContent>,
    progressCallback?: (progress: number) => void
): Promise<void> {
    await authorizeDrive();
    
    // Create a map to track created directories and their IDs
    const dirIdMap: Map<string, string> = new Map();
    dirIdMap.set('', 'appDataFolder'); // Root directory
    
    // First count total files for progress reporting
    let totalFiles = 0;
    const fileList: OPFSFileWithContent[] = [];
    for await (const file of files) {
        fileList.push(file);
        totalFiles++;
    }

    let processedFiles = 0;
    
    for (const file of fileList) {
        // Ensure all parent directories exist
        const pathParts = file.path.split('/').slice(0, -1);
        let parentId = 'appDataFolder';
        
        // Build the directory path incrementally
        let currentPath = '';
        for (const part of pathParts) {
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            
            if (!dirIdMap.has(currentPath)) {
                // Directory doesn't exist yet - create it
                const dirId = await createDriveFolder(part, parentId);
                dirIdMap.set(currentPath, dirId);
            }
            parentId = dirIdMap.get(currentPath)!;
        }

        // Read file content and write to Drive
        const content = await file.getContent();
        await writeDriveFile(
            file.name,
            content,
            parentId
        );

        processedFiles++;
        if (progressCallback) {
            progressCallback(processedFiles / totalFiles);
        }
    }
}

export async function writeDriveFile(
    name: string, 
    contents: string, 
    parentId?: string
): Promise<string> {
    await authorizeDrive();
    
    const formData = new FormData();
    const metadata = {
        name,
        mimeType: 'text/plain',
        parents: parentId ? [parentId] : ['appDataFolder']
    };
    
    // Add metadata as JSON blob
    formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    
    // Add file contents as text blob
    formData.append('file', new Blob([contents], { type: 'text/plain' }));

    try {
        const response = await gapi.client.request({
            path: '/upload/drive/v3/files',
            method: 'POST',
            params: {
                uploadType: 'multipart'
            },
            headers: {
                'Content-Type': null // Let browser set the boundary
            },
            body: formData
        });

        if (!response.result?.id) {
            throw new Error('Failed to create file - no ID returned from Google Drive API');
        }
        return response.result.id;
    } catch (error) {
        console.error('Error writing Drive file:', error);
        throw error;
    }
}
