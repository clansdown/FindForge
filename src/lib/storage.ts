import { type Writable, writable } from 'svelte/store';
import { Config, type ConversationData } from './types';

let conversationsDirHandle: FileSystemDirectoryHandle | null = null;

// NOTE: brave doesn't allow filesystem API other than OPFS by default, so if we ever offer it we'll need to give the user a message if window.showDirectoryPicker doesn't exist
declare global {
    interface Window {
        showDirectoryPicker?: (options?: { mode?: string }) => Promise<FileSystemDirectoryHandle>;
    }
}

const STORAGE_KEY = 'appConfig';
const CONVERSATION_IDS_KEY = 'conversationIDs';
const STORAGE_LOCK_KEY = 'storageLock';
const LOCK_TIMEOUT_MS = 5000; // 5 second lock timeout
let conversationsCache: ConversationData[] | null = null;

/**
 * Attempts to acquire a storage lock
 * @returns true if lock was acquired, false if already locked
 */
export function acquireStorageLock(): boolean {
    const lock = localStorage.getItem(STORAGE_LOCK_KEY);
    if (lock) {
        const lockTime = parseInt(lock);
        if (Date.now() - lockTime < LOCK_TIMEOUT_MS) {
            return false; // Lock is still valid
        }
        // Lock expired - we can take it
    }
    localStorage.setItem(STORAGE_LOCK_KEY, Date.now().toString());
    return true;
}

/**
 * Releases the storage lock
 */
export function releaseStorageLock(): void {
    localStorage.removeItem(STORAGE_LOCK_KEY);
}

/**
 * Creates a Svelte store backed by localStorage
 * @param key Storage key
 * @param defaultValue Default value if not set in storage
 * @returns A writable Svelte store synchronized with localStorage
 */
export function getLocalPreferenceStore<T>(key: string, defaultValue: T): Writable<T> {
    const { subscribe, set } = writable<T>(getLocalPreference(key, defaultValue));
    
    return {
        subscribe,
        set(value: T) {
            setLocalPreference(key, value);
            set(value);
        },
        update(updater: (value: T) => T) {
            const newValue = updater(getLocalPreference(key, defaultValue));
            setLocalPreference(key, newValue);
            set(newValue);
        }
    };
}

/**
 * Gets a preference value from localStorage, returning the default if not set
 * @param key Preference key
 * @param defaultValue Default value to return if preference not set
 * @returns The stored preference value or defaultValue if not set
 */
export function getLocalPreference<T>(key: string, defaultValue: T): T {
    const value = localStorage.getItem(key);
    if (value === null) {
        return defaultValue;
    }
    try {
        return JSON.parse(value) as T;
    } catch {
        return defaultValue;
    }
}

/**
 * Sets a preference value in localStorage
 * @param key Preference key
 * @param value Value to store
 */
export function setLocalPreference(key: string, value: unknown): void {
    localStorage.setItem(key, JSON.stringify(value));
}

/**
 * Waits to acquire a storage lock with retries
 * @param maxRetries Maximum number of retry attempts
 * @param retryDelayMs Delay between retries in milliseconds
 * @returns Promise that resolves when lock is acquired or rejects if max retries reached
 */
export function waitForStorageLock(maxRetries = 10, retryDelayMs = 200): Promise<void> {
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const tryAcquire = () => {
            if (acquireStorageLock()) {
                resolve();
            } else if (attempts >= maxRetries) {
                reject(new Error('Failed to acquire storage lock after maximum retries'));
            } else {
                attempts++;
                setTimeout(tryAcquire, retryDelayMs);
            }
        };
        tryAcquire();
    });
}

export function saveConfig(config: Config): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function loadConfig(): Config {
  const saved = localStorage.getItem(STORAGE_KEY);
  const config = new Config();
  
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      Object.assign(config, parsed);
      config.ensureDefaults(); // Ensure defaults are set
    } catch (e) {
      console.error('Failed to parse saved config', e);
    }
  }
  
  return config;
}

export async function storeConversation(conversation: ConversationData): Promise<void> {
    // Reload IDs fresh from storage to avoid race conditions
    const ids = await loadConversationIDs();
    const dirHandle = getConversationsDirHandle();
    
    try {
        if (!ids.includes(conversation.id)) {
            ids.push(conversation.id);
            if (dirHandle) {
                // Update the conversation list in OPFS
                const fileHandle = await dirHandle.getFileHandle('conversation_list.json', { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(JSON.stringify(ids));
                await writable.close();
            } else {
                // Fall back to localStorage
                localStorage.setItem(CONVERSATION_IDS_KEY, JSON.stringify(ids));
            }
        }

        // Store the conversation
        if (dirHandle) {
            const fileHandle = await dirHandle.getFileHandle(`conversation_${conversation.id}.json`, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(JSON.stringify(conversation));
            await writable.close();
        } else {
            localStorage.setItem(`conversation_${conversation.id}`, JSON.stringify(conversation));
        }

        // Invalidate cache and reload it
        conversationsCache = null;
        loadConversations();
    } catch (e) {
        console.error('Failed to store conversation', e);
        throw e;
    }
}

export async function loadConversations(): Promise<ConversationData[]> {
    if (conversationsCache) {
        return conversationsCache;
    }

    const ids = await loadConversationIDs();
    const conversations: ConversationData[] = [];
    const dirHandle = getConversationsDirHandle();

    for (const id of ids) {
        try {
            // Try directory storage first
            if (dirHandle) {
                try {
                    const fileHandle = await dirHandle.getFileHandle(`conversation_${id}.json`, { create: false });
                    const file = await fileHandle.getFile();
                    const content = await file.text();
                    const conv = JSON.parse(content) as ConversationData;
                    conversations.push(conv);
                    continue; // Skip localStorage if we found it in dir storage
                } catch (e: any) {
                    if (e.name !== 'NotFoundError') {
                        console.error(`Failed to read conversation ${id} from directory storage`, e);
                    }
                }
            }

            // Fall back to localStorage
            const item = localStorage.getItem(`conversation_${id}`);
            if (item) {
                try {
                    const conv = JSON.parse(item) as ConversationData;
                    conversations.push(conv);
                } catch (e) {
                    console.error(`Failed to parse conversation ${id} from localStorage`, e);
                }
            }
        } catch (e) {
            console.error(`Error loading conversation ${id}`, e);
        }
    }
    
    conversationsCache = conversations;
    return conversations;
}

export async function deleteConversation(id: string): Promise<void> {
    // Remove from IDs list
    const ids = await loadConversationIDs();
    const index = ids.indexOf(id);
    if (index >= 0) {
        ids.splice(index, 1);
        localStorage.setItem(CONVERSATION_IDS_KEY, JSON.stringify(ids));
    }
    
    // Remove the conversation data from both storage locations
    try {
        localStorage.removeItem(`conversation_${id}`);
        
        // Try directory storage if available
        const dirHandle = getConversationsDirHandle();
        if (dirHandle) {
            try {
                await dirHandle.removeEntry(`conversation_${id}.json`);
            } catch (e: any) {
                if (e.name !== 'NotFoundError') {
                    console.error(`Failed to delete conversation ${id} from directory storage`, e);
                }
            }
        }
    } catch (e) {
        console.error(`Error deleting conversation ${id}`, e);
    }
    
    // Update cache if exists
    if (conversationsCache) {
        const cacheIndex = conversationsCache.findIndex(c => c.id === id);
        if (cacheIndex >= 0) {
            conversationsCache.splice(cacheIndex, 1);
        }
    }
}

/**
 * Initializes the Origin Private File System storage and gets a directory handle
 * for the 'conversations' directory.
 * @returns Promise that resolves with the directory handle
 */
export async function initializeConversationStorage(): Promise<FileSystemDirectoryHandle> {
    if (conversationsDirHandle) {
        return conversationsDirHandle;
    }

    if (!('storage' in navigator && 'getDirectory' in navigator.storage)) {
        throw new Error('OPFS is not supported in this browser');
    }
    
    try {
        const root = await navigator.storage.getDirectory();
        console.log('OPFS root directory:', root);
        conversationsDirHandle = await root.getDirectoryHandle('conversations', { create: true });
        return conversationsDirHandle;
    } catch (e) {
        console.error('Failed to initialize conversation storage', e);
        throw e;
    }
}

export function getConversationsDirHandle(): FileSystemDirectoryHandle | null {
    return conversationsDirHandle;
}

/**
 * Checks if there are any local files stored in either localStorage or OPFS
 * (excluding cloud tokens). Used to determine if there's local data to migrate.
 * @returns Promise that resolves to true if local files exist, false otherwise
 */
export async function localStorageInUse(): Promise<boolean> {
    // Check localStorage for conversations or config
    if (localStorage.getItem(STORAGE_KEY) !== null) {
        return true;
    }
    if (localStorage.getItem(CONVERSATION_IDS_KEY) !== null) {
        return true;
    }
    
    // Check for localStorage conversations (by checking for any conversation_* keys)
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('conversation_') && !key.includes('google_drive_token')) {
            return true;
        }
    }

    // Check OPFS storage if available
    const dirHandle = getConversationsDirHandle();
    if (dirHandle) {
        try {
            for await (const [name] of dirHandle) {
                if (name !== 'conversation_list.json' && name.startsWith('conversation_')) {
                    return true;
                }
            }
        } catch (e) {
            console.error('Error checking OPFS for files', e);
        }
    }

    return false;
}

async function loadConversationIDs(): Promise<string[]> {
    let ids: string[] = [];
    
    // Try OPFS directory first if available
    try {
        const dirHandle = getConversationsDirHandle();
        if (dirHandle) {
            console.log('Loading conversation IDs from OPFS');
            try {
                const fileHandle = await dirHandle.getFileHandle('conversation_list.json', { create: false });
                const file = await fileHandle.getFile();
                const content = await file.text();
                ids = JSON.parse(content) as string[];
                console.log('Loaded conversation IDs from OPFS:', ids);
                return ids;
            } catch (e: any) {
                if (e.name !== 'NotFoundError') {
                    console.error('Failed to read conversation_list.json from OPFS', e);
                }
            }
        }
    } catch (e) {
        console.error('Error accessing OPFS for conversation IDs', e);
    }

    // Fall back to localStorage if OPFS failed or isn't available
    const item = localStorage.getItem(CONVERSATION_IDS_KEY);
    if (item) {
        try {
            ids = JSON.parse(item) as string[];
        } catch (e) {
            console.error('Failed to parse conversation IDs from localStorage', e);
        }
    }
    console.log('Loaded conversation IDs from localStorage:', ids);

    return ids;
}
