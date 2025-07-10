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
function initializeGapiClient(): Promise<void> {
    return new Promise((resolve, reject) => {
        if (gapiInitialized) {
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://apis.google.com/js/api.js';
        script.onload = () => {
            gapi.load('client', () => {
                gapi.client.init({
                    apiKey: API_KEY,
                    discoveryDocs: [GAPI_DISCOVERY_DOC],
                }).then(() => {
                    gapiInitialized = true;
                    resolve();
                }).catch(reject);
            });
        };
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

/**
 * Initialize the Google Identity Services client
 */
function initializeGisClient(): Promise<void> {
    return new Promise((resolve, reject) => {
        if (gisInitialized) {
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.onload = () => {
            tokenClient = window.google.accounts.oauth2.initTokenClient({
                client_id: CLIENT_ID,
                scope: GOOGLE_DRIVE_SCOPE,
                callback: '', // Defined later
                error_callback: (err: any) => {
                    console.error('GIS error:', err);
                    throw err;
                }
            });
            gisInitialized = true;
            resolve();
        };
        script.onerror = reject;
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

    return new Promise((resolve, reject) => {
        const savedToken = getLocalPreference<GoogleTokenResponse|null>(STORAGE_KEY, null);
        if (savedToken?.access_token) {
            if (Date.now() < (Date.now() + savedToken.expires_in * 1000)) {
                gapi.client.setToken(savedToken);
                resolve();
                return;
            }
        }

        tokenClient.callback = async (response: GoogleTokenResponse) => {
            if (response.access_token) {
                gapi.client.setToken(response);
                setLocalPreference(STORAGE_KEY, response);
                resolve();
            } else {
                reject(new Error('Failed to get access token'));
            }
        };

        try {
            // Request a new token
            if (interactive) {
                tokenClient.requestAccessToken({prompt: 'consent'});
            } else {
                tokenClient.requestAccessToken({prompt: ''});
            }
        } catch (err) {
            console.error('Error requesting access token:', err);
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
