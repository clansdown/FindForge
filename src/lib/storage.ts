import { Config, type ConversationData } from './types';

const STORAGE_KEY = 'appConfig';
const CONVERSATION_IDS_KEY = 'conversationIDs';
let conversationsCache: ConversationData[] | null = null;

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
    } catch (e) {
      console.error('Failed to parse saved config', e);
    }
  }
  
  return config;
}

export function storeConversation(conversation: ConversationData): void {
    const ids = loadConversationIDs();
    if (!ids.includes(conversation.id)) {
        ids.push(conversation.id);
        localStorage.setItem(CONVERSATION_IDS_KEY, JSON.stringify(ids));
    }
    localStorage.setItem(`conversation_${conversation.id}`, JSON.stringify(conversation));

    if (conversationsCache) {
        const index = conversationsCache.findIndex(c => c.id === conversation.id);
        if (index >= 0) {
            conversationsCache[index] = conversation;
        } else {
            conversationsCache.push(conversation);
        }
    }
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
