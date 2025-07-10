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
const API_KEY = "AIzaSyBQmJz9XftURWvLQ9I8Nb9A9NRlA8B0Yz0";
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const STORAGE_KEY = "googleDriveCredentials";
const GAPI_DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest";

let tokenClient: any;
let gapiInitialized = false;
let gisInitialized = false;

/**
 * Load and initialize the Google API client library
 */
async function initializeGapiClient(retries = 3, delayMs = 1000): Promise<void> {
    if (gapiInitialized) {
        return;
    }

    console.log('Loading Google API client library...');
    
    // Load the script first.
    try {
        await new Promise<void>((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://apis.google.com/js/api.js';
            script.async = true;
            script.defer = true;
            script.onload = () => {
                // gapi is loaded, now load the 'client' module.
                gapi.load('client', {
                    callback: resolve,
                    onerror: reject,
                    timeout: 5000, // 5 seconds
                    ontimeout: () => reject(new Error('gapi.load timeout'))
                });
            };
            script.onerror = (err) => reject(new Error(`Failed to load Google API script (api.js): ${err}`));
            document.head.appendChild(script);
        });
    } catch (error) {
        console.error("Fatal: Could not load Google API script.", error);
        throw error; // Can't proceed.
    }

    console.log('Google API script loaded. Initializing client...');
    let lastError: unknown;
    
    for (let i = 0; i < retries; i++) {
        try {
            await gapi.client.init({
                apiKey: API_KEY,
                discoveryDocs: [GAPI_DISCOVERY_DOC],
            });
            gapiInitialized = true;
            console.log('Google API client initialized successfully');
            return; // Success, exit function
        } catch (error) {
            lastError = error;
            console.warn(`Attempt ${i + 1}/${retries} to initialize GAPI client failed.`, error);
            if (i < retries - 1) {
                const delay = delayMs * Math.pow(2, i);
                console.log(`Retrying in ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }

    console.error('Failed to initialize Google API client after retries.', { lastError });
    throw new Error('Failed to initialize Google API client after retries');
}

/**
 * Initialize the Google Identity Services client
 */
function initializeGisClient(): Promise<void> {
    if (gisInitialized) {
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        console.log('Loading Google Identity Services client...');
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = () => {
            console.log('Google Identity Services client loaded.');
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
                resolve();
            } catch (error) {
                console.error('Failed to initialize GIS token client.', error);
                reject(error);
            }
        };
        script.onerror = (e) => {
            console.error('Failed to load Google Identity Services script.', e);
            reject(new Error('Failed to load Google Identity Services script.'));
        };
        document.head.appendChild(script);
    });
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
