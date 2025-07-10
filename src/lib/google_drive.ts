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

const CLIENT_ID = "522388443811-epg88tkfdr55g5195j0oqdmoafnt2cmf.apps.googleusercontent.com";
const API_KEY = "AIzaSyBgp-mT0AUYfuPCvW92wtnBWIqCnFXbL4w";
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const STORAGE_KEY = "googleDriveCredentials";
const GAPI_DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest";

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
function initializeGapiClient(): Promise<void> {
    if (gapiInitialized) {
        return Promise.resolve();
    }

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
                        apiKey: API_KEY,
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
            client_id: CLIENT_ID,
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
        // initializeGisClient()
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
        client_id: CLIENT_ID,
        callback: (response: {credential: string}) => {
            callback(response.credential);
        },
        cancel_callback: cancelCallback,
    });
    window.google?.accounts.id.prompt();
}

/**
 * Requests authorization token and initializes the Drive client
 */
export async function authorizeDrive(interactive: boolean = true): Promise<void> {
    await initializeGoogleClients();

    const savedToken = getLocalPreference<StoredGoogleTokenResponse | null>(STORAGE_KEY, null);
    // Subtract a minute (60000ms) to be safe and refresh token before it expires.
    if (savedToken?.access_token && Date.now() < savedToken.expires_at - 60000) {
        gapi.client.setToken(savedToken);
        return;
    }

    if (savedToken) {
        console.log('Google Drive token is invalid or expired, requesting new token...');
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
        return response.result.id;
    } catch (error) {
        console.error('Error creating Drive folder:', error);
        throw error;
    }
}

/**
 * Writes file to Google Drive AppData folder
 */
export async function writeDriveFile(
    name: string, 
    contents: string, 
    parentId?: string
): Promise<string> {
    await authorizeDrive();
    const fileMetadata = {
        name,
        mimeType: 'text/plain',
        parents: parentId ? [parentId] : ['appDataFolder']
    };

    const media = {
        mimeType: 'text/plain',
        body: contents
    };

    try {
        const response = await gapi.client.drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id'
        });
        return response.result.id;
    } catch (error) {
        console.error('Error writing Drive file:', error);
        throw error;
    }
}
