export class Config {
  historyWidth!: number;
  apiKey!: string;
  defaultModel!: string;
  availableModels!: string[];
  systemPrompt!: string;
  allowWebSearch!: boolean;
  webSearchMaxResults!: number;
  includePreviousMessagesAsContext!: boolean;
  searchEngine!: string;

  constructor() {
    this.historyWidth = 400;
    this.apiKey = '';
    this.defaultModel = '';
    this.availableModels = [];
    this.systemPrompt = '';
    this.allowWebSearch = false;
    this.webSearchMaxResults = 5;
    this.includePreviousMessagesAsContext = true;
    this.searchEngine = 'duckduckgo';
  }
}

export interface StreamingResult {
  requestID: string;
  model: string;
  created: number;
  done: boolean;
  totalTokens?: number;
}

export interface GenerationData {
    id: string;
    model: string;
    created: number;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
    // Add other fields as needed
}

export interface Model {
    id: string;
    name: string;
    description: string;
    context_length: number;
    pricing: {
        prompt: string;
        completion: string;
    };
    allowed?: boolean;
}

export interface MessageData {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: number;
    totalCost?: number;
    model?: string;
    generationData?: GenerationData;
    webSearchResults?: string[];
}

export interface ConversationData {
    id: string;
    messages: MessageData[];
    created: number;
    updated: number;
}