import { Config, type ConversationData } from './types';

let conversationsDirHandle: FileSystemDirectoryHandle | null = null;

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
    
    // Remove the conversation data
    localStorage.removeItem(`conversation_${id}`);
    
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

    if (!window.showDirectoryPicker) {
        throw new Error('OPFS is not supported in this browser');
    }
    
    try {
        const root = await navigator.storage.getDirectory();
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

async function loadConversationIDs(): Promise<string[]> {
    // Check localStorage first
    const item = localStorage.getItem(CONVERSATION_IDS_KEY);
    let ids: string[] = [];
    if (item) {
        try {
            ids = JSON.parse(item) as string[];
        } catch (e) {
            console.error('Failed to parse conversation IDs from localStorage', e);
        }
    }

    // Check OPFS directory if available
    try {
        const dirHandle = getConversationsDirHandle();
        if (dirHandle) {
            try {
                const fileHandle = await dirHandle.getFileHandle('conversation_list.json', { create: false });
                const file = await fileHandle.getFile();
                const content = await file.text();
                const opfsIds = JSON.parse(content) as string[];
                // Merge with localStorage IDs, removing duplicates
                ids = Array.from(new Set([...ids, ...opfsIds]));
            } catch (e : any) {
                if (e.name !== 'NotFoundError') {
                    console.error('Failed to read conversation_list.json from OPFS', e);
                }
            }
        }
    } catch (e) {
        console.error('Error accessing OPFS for conversation IDs', e);
    }

    return ids;
}
