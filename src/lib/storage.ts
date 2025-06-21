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

export function storeConversation(conversation: ConversationData): void {
    // Reload IDs fresh from storage to avoid race conditions with other tabs
    const ids = loadConversationIDs();
    if (!ids.includes(conversation.id)) {
        ids.push(conversation.id);
        localStorage.setItem(CONVERSATION_IDS_KEY, JSON.stringify(ids));
    }
    localStorage.setItem(`conversation_${conversation.id}`, JSON.stringify(conversation));

    // Invalidate cache and reload it
    conversationsCache = null;
    loadConversations();
}

export function loadConversations(): ConversationData[] {
    if (conversationsCache) {
        return conversationsCache;
    }

    const ids = loadConversationIDs();
    const conversations: ConversationData[] = [];
    for (const id of ids) {
        const item = localStorage.getItem(`conversation_${id}`);
        if (item) {
            try {
                const conv = JSON.parse(item) as ConversationData;
                conversations.push(conv);
            } catch (e) {
                console.error(`Failed to parse conversation ${id}`, e);
            }
        }
    }
    conversationsCache = conversations;
    return conversations;
}

export function deleteConversation(id: string): void {
    // Remove from IDs list
    const ids = loadConversationIDs();
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

function loadConversationIDs(): string[] {
    const item = localStorage.getItem(CONVERSATION_IDS_KEY);
    if (item) {
        try {
            return JSON.parse(item) as string[];
        } catch (e) {
            console.error('Failed to parse conversation IDs', e);
            return [];
        }
    }
    return [];
}
