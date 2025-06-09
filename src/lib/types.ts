import type { Mode } from "highlight.js";

export class Config {
    historyWidth!: number;
    apiKey!: string;
    defaultModel!: string; // model ID
    defaultReasoningModel!: string; // model ID for reasoning
    defaultReasoningEffort: 'low' | 'medium' | 'high' = 'medium'; // default thinking effort for reasoning
    availableModels!: string[]; // model IDs
    systemPrompt!: string;
    allowWebSearch!: boolean;
    webSearchMaxResults!: number;
    includePreviousMessagesAsContext!: boolean;
    searchEngine!: string;
    deepResearchWebSearchMaxPlanningResults!: number;
    deepResearchSystemPrompt!: string;
    deepResearchWebRequestsPerSubrequest!: number;
    deepResearchMaxSubqrequests!: number;
    deepResearchMaxPlanningTokens!: number;
    deepResearchMaxSynthesisTokens!: number;

    constructor() {
        this.historyWidth = 400;
        this.apiKey = '';
        this.defaultModel = 'deepseek/deepseek-chat-v3-0324:free';
        this.defaultReasoningModel = 'deepseek/deepseek-chat-v3-0324:free';
        this.defaultReasoningEffort = 'low'; // default thinking effort for reasoning
        this.availableModels = [
            'deepseek/deepseek-chat-v3-0324:free',
            'deepseek/deepseek-chat-v3-0324',
            'google/gemini-2.5-pro-preview',
            'google/gemini-2.5-flash-preview-05-20',
            'openai/gpt-4.1',
            'openai/o3',
            'anthropic/claude-sonnet-4',
            'anthropic/claude-opus-4'
        ];
        this.systemPrompt = 'You are a helpful AI assistant. When mentioning research papers provide full citations suitable for searching for the paper on the internet. Omit any disclaimers. Remember that experts can be wrong. Be concise but include detail.';
        this.allowWebSearch = true;
        this.webSearchMaxResults = 5;
        this.includePreviousMessagesAsContext = true;
        this.searchEngine = 'duckduckgo';
        this.deepResearchWebSearchMaxPlanningResults = 10;
        this.deepResearchSystemPrompt = `Address the user's question or goal directly. The answer should be detailed, informative, clear, and dense. The answer should explain any reasoning involved. Cite all sources. The language should be in the style of a helpful but businesslike research assistant.`; // appended to the internal system prompt
        this.deepResearchMaxSubqrequests = 8;
        this.deepResearchWebRequestsPerSubrequest = 6;
        this.deepResearchMaxPlanningTokens = 16384;
        this.deepResearchMaxSynthesisTokens = 16384;
    }
}

export interface StreamingResult {
    requestID: string;
    model: string;
    created: number;
    done: boolean;
    totalTokens?: number;
    annotations?: Annotation[];
    generationData?: GenerationData;
}

export interface ChatResult extends StreamingResult {
    content: string;
}

export interface GenerationData {
    id: string;
    total_cost: number;
    model: string;
    generation_time: number;
    provider_name: string;
    created: number;
    usage?: number;
    cache_discount?: boolean;
    streamed: boolean;
    canceled: boolean;
    finish_reason: string;
    num_search_results?: number;
    tokens_prompt?: number;
    tokens_completion?: number;
    native_tokens_prompt?: number;
    native_tokens_completion?: number;
    native_tokens_reasoning?: number;
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

export interface UrlCitation {
    url: string;
    title: string;
    content: string;
    start_index: number;
    end_index: number;
}

export type Annotation =
    | { type: 'url_citation', url_citation: UrlCitation };

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
    isGenerating?: boolean; // true when the message is being generated
    status?: string; // status text for deep research
    deepResearchResult?: DeepResearchResult; // result of deep research, if it was done
    researchResult?: ResearchResult; // result of standard research, if it was done
    annotations?: Annotation[];
    resources?: Resource[]; // List of resources used for research
}

export interface ConversationData {
    id: string;
    title: string;
    messages: MessageData[];
    created: number;
    updated: number;
}

export interface ApiCallMessageContent {
    type: 'text' | 'image' | 'file';
    text?: string; // for type 'text'
    file?: {
        filename: string;
        file_data: string; // base64 encoded file data
    };
}

export interface ApiCallMessage {
    role: 'user' | 'assistant' | 'system';
    content: ApiCallMessageContent[];
}

export interface OpenRouterCredits {
    total_credits: number;
    total_usage: number;
}

export interface ModelsForResearch {
    reasoning: string;
    editor: string;
    researcher: string;
}

export interface ResearchResult {
    streamingResult: StreamingResult;
    generationData?: GenerationData;
    resources : Resource[];
    annotations: Annotation[];
}

/** Used in deep research for doing sub-queries */
export interface ResearchThread {
    prompt: string; // the prompt for the sub-query
    firstPass? : ChatResult;
    refined? : ChatResult;
}

export interface Resource {
    url: string;
    title?: string;
    author?: string;
    date?: string;
    type?: string;
    purpose? : string;
    summary?: string;
}

export interface DeepResearchResult {
    id: string;
    total_cost: number;
    models: ModelsForResearch;
    content: string;
    plan_prompt: string;
    plan_result: ChatResult;
    research_plan: string;
    research_threads : ResearchThread[];
    synthesis_prompt: string;
    synthesis_result: ChatResult;
    annotations?: Annotation[];
    resources : Resource[];
    total_generation_time: number; // total time taken for all generations in the deep research (in seconds)
}
