export class Config {
  historyWidth!: number;
  apiKey!: string;
  defaultModel!: string; // model ID
  availableModels!: string[]; // model IDs
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

export interface ChatResult extends StreamingResult {
    content: string;
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

export interface Attachment {
    filename: string;
    content: string;
}

export interface MessageData {
    id: string; // Add ID for message tracking
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: number;
    totalCost?: number;
    model?: string; // the model ID
    modelName?: string; // the human readable model name
    generationData?: GenerationData;
    webSearchResults?: string[];
    requestID?: string;
    hidden?: boolean; // hides the message in the UI and excludes it from being used as context
    attachments?: Attachment[]; // array of file attachments
}

export interface ConversationData {
    id: string;
    title: string;
    messages: MessageData[];
    created: number;
    updated: number;
}

export interface OpenRouterCredits {
  total_credits: number;
  total_usage: number;
}
