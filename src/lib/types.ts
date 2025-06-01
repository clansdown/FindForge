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
    total_cost: number;
    model: string;
    created: number;
    usage?: number;
    cache_discount? : boolean;
    streamed : boolean;
    canceled : boolean;
    finish_reason : string;
    num_search_results? : number;
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
    id: string; // Add ID for message tracking
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: number;
    totalCost?: number;
    model?: string;
    generationData?: GenerationData;
    webSearchResults?: string[];
    requestID?: string;
}

export interface ConversationData {
    id: string;
    messages: MessageData[];
    created: number;
    updated: number;
}
