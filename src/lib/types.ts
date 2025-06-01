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
