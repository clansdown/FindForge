import { type Writable, writable } from 'svelte/store';
import { Config, type ConversationData } from './types';
import {
    initOpfsStorage,
    writeLocalFile,
    readLocalFile,
    deleteLocalFile,
    listLocalDirectory,
    getOPFSHandle,
    readCredential,
    writeCredential
} from './opfs';
import { recordWrite, recordDelete } from '../syncJournal';
import { queueSync, computeHash } from '../cloudSync';
import { syncCredentialToCloud } from '../cloudSync';

let conversationsDirHandle: FileSystemDirectoryHandle | null = null;
let opfsAvailable = false;

const STORAGE_KEY = 'appConfig';
const CONVERSATION_IDS_KEY = 'conversationIDs';
let conversationsCache: ConversationData[] | null = null;

// ── localStorage helpers (kept for transition fallback) ──

export function getLocalPreference<T>(key: string, defaultValue: T): T {
    const value = localStorage.getItem(key);
    if (value === null) return defaultValue;
    try { return JSON.parse(value) as T; } catch { return defaultValue; }
}

export function setLocalPreference(key: string, value: unknown): void {
    localStorage.setItem(key, JSON.stringify(value));
}

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

// ── Config persistence ──

export async function saveConfig(config: Config): Promise<void> {
    // Save apiKey to shared credentials
    if (config.apiKey) {
        try {
            await writeCredential('openrouter', config.apiKey);
            syncCredentialToCloud('openrouter').catch(err =>
                console.error('Failed to sync credential to cloud:', err)
            );
        } catch (err) {
            console.error('Failed to save API key to credentials:', err);
        }
    }

    // Strip apiKey and save config to OPFS
    const { apiKey, ...configWithoutKey } = config;
    const configJson = JSON.stringify(configWithoutKey);

    try {
        await writeLocalFile('preferences/config.json', configJson);
        const hash = computeHash(configJson);
        recordWrite('preferences/config.json', hash);
        queueSync();
    } catch (err) {
        console.error('Failed to save config to OPFS, falling back to localStorage:', err);
    }

    // Always keep localStorage fallback during transition
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export async function loadConfig(): Promise<Config> {
    const config = new Config();

    // Try OPFS first
    try {
        const configJson = await readLocalFile('preferences/config.json');
        if (configJson) {
            const parsed = JSON.parse(configJson);
            Object.assign(config, parsed);
        }
    } catch {
        // OPFS not available yet, will try localStorage
    }

    // Fall back to localStorage
    if (!config.apiKey) {
        const localConfig = localStorage.getItem(STORAGE_KEY);
        if (localConfig) {
            try {
                const parsed = JSON.parse(localConfig);
                Object.assign(config, parsed);
            } catch (err) {
                console.error('Failed to parse localStorage config:', err);
            }
        }
    }

    // Read API key from shared credentials
    try {
        const credKey = await readCredential('openrouter');
        if (credKey) {
            config.apiKey = credKey;
        }
    } catch {
        // Credentials not available
    }

    config.ensureDefaults();

    // Promote: if we loaded from localStorage but OPFS is empty, save to OPFS now
    try {
        const existing = await readLocalFile('preferences/config.json');
        if (!existing && localStorage.getItem(STORAGE_KEY)) {
            await saveConfig(config);
        }
    } catch {
        // Promotion can fail silently
    }

    return config;
}

// ── Conversation persistence ──

export async function initializeConversationStorage(): Promise<FileSystemDirectoryHandle> {
    if (conversationsDirHandle) return conversationsDirHandle;

    try {
        await initOpfsStorage();
        opfsAvailable = true;
    } catch {
        opfsAvailable = false;
        throw new Error('OPFS storage is not available');
    }

    const appHandle = await getOPFSHandle();
    conversationsDirHandle = await appHandle.getDirectoryHandle('conversations', { create: true });

    return conversationsDirHandle;
}

export async function storeConversation(conversation: ConversationData): Promise<void> {
    const convJson = JSON.stringify(conversation);
    const hash = computeHash(convJson);
    const ids = await loadConversationIDs();

    // Write conversation file
    const convPath = `conversations/conversation_${conversation.id}.json`;
    try {
        await writeLocalFile(convPath, convJson);
        recordWrite(convPath, hash);
    } catch (err) {
        console.error('Failed to write conversation to OPFS:', err);
        localStorage.setItem(`conversation_${conversation.id}`, convJson);
    }

    // Update conversation list
    if (!ids.includes(conversation.id)) {
        ids.push(conversation.id);
        const listJson = JSON.stringify(ids);
        const listHash = computeHash(listJson);
        try {
            await writeLocalFile('conversations/conversation_list.json', listJson);
            recordWrite('conversations/conversation_list.json', listHash);
        } catch {
            localStorage.setItem(CONVERSATION_IDS_KEY, listJson);
        }
    }

    queueSync();

    // Invalidate cache
    conversationsCache = null;
    loadConversations();
}

export async function loadConversations(): Promise<ConversationData[]> {
    if (conversationsCache) return conversationsCache;

    const conversations: ConversationData[] = [];
    const seen = new Set<string>();

    // Try OPFS first
    try {
        const listJson = await readLocalFile('conversations/conversation_list.json');
        if (listJson) {
            const ids = JSON.parse(listJson) as string[];
            for (const id of ids) {
                const content = await readLocalFile(`conversations/conversation_${id}.json`);
                if (content) {
                    try {
                        const conv = JSON.parse(content) as ConversationData;
                        if (!seen.has(conv.id)) {
                            seen.add(conv.id);
                            conversations.push(conv);
                        }
                    } catch {
                        console.error(`Failed to parse conversation ${id} from OPFS`);
                    }
                }
            }
        }
    } catch {
        // OPFS not available
    }

    // Fall back to localStorage
    if (conversations.length === 0) {
        const item = localStorage.getItem(CONVERSATION_IDS_KEY);
        if (item) {
            try {
                const ids = JSON.parse(item) as string[];
                for (const id of ids) {
                    const convData = localStorage.getItem(`conversation_${id}`);
                    if (convData) {
                        try {
                            const conv = JSON.parse(convData) as ConversationData;
                            if (!seen.has(conv.id)) {
                                seen.add(conv.id);
                                conversations.push(conv);
                            }
                        } catch {
                            console.error(`Failed to parse conversation ${id} from localStorage`);
                        }
                    }
                }
            } catch {
                console.error('Failed to parse conversation IDs from localStorage');
            }
        }
    }

    conversations.sort((a, b) => b.updated - a.updated);
    conversationsCache = conversations;
    return conversations;
}

export async function deleteConversation(id: string): Promise<void> {
    // Delete from OPFS
    const convPath = `conversations/conversation_${id}.json`;
    try {
        await deleteLocalFile(convPath);
        recordDelete(convPath);
    } catch (err: unknown) {
        if (!(err instanceof DOMException && err.name === 'NotFoundError')) {
            console.error(`Failed to delete conversation ${id} from OPFS:`, err);
        }
    }

    // Remove from localStorage too
    localStorage.removeItem(`conversation_${id}`);

    // Update conversation list
    const listJson = await readLocalFile('conversations/conversation_list.json');
    if (listJson) {
        try {
            const ids = JSON.parse(listJson) as string[];
            const filtered = ids.filter(i => i !== id);
            const newList = JSON.stringify(filtered);
            const listHash = computeHash(newList);
            await writeLocalFile('conversations/conversation_list.json', newList);
            recordWrite('conversations/conversation_list.json', listHash);
        } catch (err) {
            console.error('Failed to update conversation list:', err);
        }
    }

    // Update localStorage list
    const localIds = localStorage.getItem(CONVERSATION_IDS_KEY);
    if (localIds) {
        try {
            const ids = JSON.parse(localIds) as string[];
            localStorage.setItem(CONVERSATION_IDS_KEY, JSON.stringify(ids.filter(i => i !== id)));
        } catch { /* ignore */ }
    }

    queueSync();

    // Invalidate cache
    if (conversationsCache) {
        conversationsCache = conversationsCache.filter(c => c.id !== id);
    }
}

async function loadConversationIDs(): Promise<string[]> {
    // Try OPFS
    try {
        const listJson = await readLocalFile('conversations/conversation_list.json');
        if (listJson) return JSON.parse(listJson) as string[];
    } catch {
        // Not available
    }

    // Fall back to localStorage
    const item = localStorage.getItem(CONVERSATION_IDS_KEY);
    if (item) {
        try { return JSON.parse(item) as string[]; } catch { /* ignore */ }
    }

    return [];
}

export function getConversationsDirHandle(): FileSystemDirectoryHandle | null {
    return conversationsDirHandle;
}

export async function isLocalStorageInUse(): Promise<boolean> {
    if (localStorage.getItem(STORAGE_KEY) !== null) return true;
    if (localStorage.getItem(CONVERSATION_IDS_KEY) !== null) return true;

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('conversation_')) return true;
    }

    try {
        const { files } = await listLocalDirectory('conversations');
        return files.length > 0;
    } catch {
        return false;
    }
}
