import { getLocalPreference, setLocalPreference } from './storage';

interface GoogleAuth {
    init(params: {
        apiKey: string;
        clientId: string;
        scope: string;
        discoveryDocs?: string[];
    }): Promise<void>;
    setToken(token: GoogleToken): void;
    getAuthInstance(): GoogleAuthInstance;
}

interface GoogleAuthInstance {
    isSignedIn: {
        get(): boolean;
    };
    currentUser: {
        get(): GoogleUser;
    };
    signIn(): Promise<GoogleUser>;
}

interface GoogleUser {
    getAuthResponse(): GoogleAuthResponse;
}

interface GoogleAuthResponse {
    access_token: string;
    expires_in: number;
    token_type: string;
}

interface GoogleToken {
    access_token: string;
    expires_in?: number;
    token_type?: string;
}

interface GoogleDriveApi {
    files: {
        list(params: { 
            q?: string;
            fields?: string;
            spaces?: string;
        }): Promise<{result: {files: GoogleDriveFile[]}}>;
        get(params: { 
            fileId: string;
            alt: string;
        }): Promise<{body: string}>;
        create(params: {
            resource: GoogleDriveFileMetadata;
            media?: {
                mimeType: string;
                body: string;
            };
            fields?: string;
        }): Promise<{result: {id: string}}>;
    };
}

interface GoogleDriveFileMetadata {
    name: string;
    mimeType: string;
    parents?: string[];
}

declare const gapi: {
    load: (api: string, callback: () => void) => void;
    client: {
        init(params: {
            apiKey: string;
            clientId: string;
            scope: string;
            discoveryDocs?: string[];
        }): Promise<void>;
        drive: GoogleDriveApi;
    };
    auth: GoogleAuth;
};

const CLIENT_ID = "522388443811-epg88tkfdr55g5195j0oqdmoafnt2cmf.apps.googleusercontent.com";
const API_KEY = "AIzaSyBQmJz9XftURWvLQ9I8Nb9A9NRlA8B0Yz0";
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appfolder";
const STORAGE_KEY = "googleDriveCredentials";

// Track initialization state to prevent multiple initializations
let isInitialized = false;
let initPromise: Promise<void> | null = null;

/**
 * Loads the Google API client library if not already loaded
 * @returns Promise that resolves when the library is loaded
 */
function loadGoogleApi(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        if (typeof gapi !== 'undefined') {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://apis.google.com/js/api.js';
        script.onload = () => {
            resolve();
        };
        script.onerror = (error) => {
            reject(new Error('Failed to load Google API client library'));
            console.error('Error loading Google API:', error);
        };
        document.head.appendChild(script);
    });
}

interface GoogleDriveFile {
    id: string;
    name: string;
    mimeType: string;
    modifiedTime: string;
}

/**
 * Initializes Google Drive API client with stored credentials if available
 * @returns Promise that resolves when initialization is complete
 */
export async function initGoogleDrive(): Promise<void> {
    if (isInitialized) {
        return initPromise || Promise.resolve();
    }
    
    isInitialized = true;
    initPromise = new Promise<void>(async (resolve, reject) => {
        try {
            await loadGoogleApi();
            gapi.load('client:auth2', async () => {
                try {
                    await gapi.client.init({
                        apiKey: API_KEY,
                        clientId: CLIENT_ID,
                        scope: GOOGLE_DRIVE_SCOPE,
                        discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"]
                    });
                    
                    const saved = getLocalPreference<GoogleAuthResponse>(STORAGE_KEY, null);
                    if (saved && saved.access_token) {
                        // Set the access token if available
                        gapi.auth.setToken({
                            access_token: saved.access_token
                        });
                    }
                    
                    resolve();
                } catch (error) {
                    console.error('Error initializing Google Drive API:', error);
                    reject(error);
                }
            });
        } catch (error) {
            console.error('Error loading Google API:', error);
            reject(error);
        }
    });
    
    return initPromise;
}

/**
 * Sets up authentication for Google Drive access
 * @returns Promise that resolves when authentication is successful
 */
export async function setupGoogleDriveAuthentication(): Promise<void> {
    await initGoogleDrive();
    if (!gapi.auth2.getAuthInstance().isSignedIn.get()) {
        try {
            await gapi.auth2.getAuthInstance().signIn();
            const user = gapi.auth2.getAuthInstance().currentUser.get();
            const authResponse = user.getAuthResponse();
            if (authResponse?.access_token) {
                setLocalPreference<GoogleAuthResponse>(STORAGE_KEY, { 
                    access_token: authResponse.access_token,
                    expires_in: authResponse.expires_in,
                    token_type: authResponse.token_type
                });
            }
        } catch (error) {
            console.error('Error during Google Drive authentication:', error);
            throw error;
        }
    }
}

/**
 * Ensures the user is authenticated with Google Drive
 * @returns Promise that resolves when user is authenticated
 */
async function ensureAuthenticated(): Promise<void> {
    await initGoogleDrive();
    if (!gapi.auth2.getAuthInstance().isSignedIn.get()) {
        await setupGoogleDriveAuthentication();
    }
}

/**
 * Lists files and folders in Google Drive AppData folder or a specific directory
 * @param path Optional path to the directory to list files from
 * @returns Promise with array of files and folders
 */
export async function listDriveFiles(path?: string): Promise<GoogleDriveFile[]> {
    await ensureAuthenticated();
    const query = path 
        ? { q: `'${path}' in parents`, fields: 'files(id,name,mimeType,modifiedTime)', spaces: 'appDataFolder' }
        : { spaces: 'appDataFolder', fields: 'files(id,name,mimeType,modifiedTime)' };
    
    try {
        const response = await gapi.client.drive.files.list(query);
        return response.result.files || [];
    } catch (error) {
        console.error('Error listing Google Drive files:', error);
        throw error;
    }
}

/**
 * Reads file contents from Google Drive
 * @param fileId File ID to read
 * @returns Promise with file contents as string
 */
export async function readDriveFile(fileId: string): Promise<string> {
    await ensureAuthenticated();
    try {
        const response = await gapi.client.drive.files.get({
            fileId: fileId,
            alt: 'media'
        });
        return response.body;
    } catch (error) {
        console.error('Error reading Google Drive file:', error);
        throw error;
    }
}

/**
 * Creates a folder in Google Drive AppData folder
 * @param name Folder name
 * @param parentId Optional parent folder ID
 * @returns Promise with created folder ID
 */
export async function createGoogleDriveFolder(name: string, parentId?: string): Promise<string> {
    await ensureAuthenticated();
    const folderMetadata = {
        name: name,
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
        console.error('Error creating Google Drive folder:', error);
        throw error;
    }
}

/**
 * Writes file to Google Drive AppData folder or a specific folder
 * @param name File name
 * @param contents File contents
 * @param parentId Optional parent folder ID
 * @returns Promise with created file ID
 */
export async function writeDriveFile(name: string, contents: string, parentId?: string): Promise<string> {
    await ensureAuthenticated();
    const fileMetadata = {
        name: name,
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
        console.error('Error writing Google Drive file:', error);
        throw error;
    }
}
