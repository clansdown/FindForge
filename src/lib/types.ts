

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
    parallelSystemPromptNames: string[] = []; // names of selected system prompts for parallel research
    deepResearchPhases: number = 1; // number of phases in deep research;
    deepResearchPlanningModel: string = 'deepseek/deepseek-chat-v3-0324:free';
    deepResearchResearchModel: string = 'deepseek/deepseek-chat-v3-0324:free';
    deepResearchRefiningModel: string = 'deepseek/deepseek-chat-v3-0324:free';
    deepResearchSynthesisModel: string = 'deepseek/deepseek-chat-v3-0324:free';
    systemPrompts: SystemPrompt[];
    synthesisPrompts : SystemPrompt[];

    static defaultSystemPrompt ='You are a helpful AI assistant. When mentioning research papers provide full citations suitable for searching for the paper on the internet. Omit any disclaimers. Remember that experts can be wrong. Be concise but include detail.';
    static defaultDeepResearchSynthesisPrompt = `Address the user's question or goal directly. The answer should be detailed, accurate, informative, clear, and dense, without omitting key details. The answer should explain any reasoning involved. Cite all sources. The language should be in the style of a helpful but businesslike research assistant. Focus on clear, precise, and factual prose with section headings, but use tables and lists if they aid in clarity or readability.`; // appended to the internal system prompt

    constructor() {
        this.historyWidth = 400;
        this.apiKey = '';
        this.defaultModel = 'deepseek/deepseek-chat-v3-0324:free';
        this.defaultReasoningModel = 'deepseek/deepseek-chat-v3-0324:free';
        this.defaultReasoningEffort = 'medium'; // default thinking effort for reasoning
        this.availableModels = [
            'deepseek/deepseek-chat-v3-0324:free',
            'deepseek/deepseek-chat-v3-0324',
            'deepseek/deepseek-chat-v3-0324:free',
            'deepseek/deepseek-chat-v3-0324',
            'google/gemini-2.5-pro-preview',
            'google/gemini-2.5-flash-preview-05-20',
            'openai/gpt-4.1',
            'openai/o3',
            'anthropic/claude-sonnet-4',
            'anthropic/claude-opus-4'
        ];
        this.systemPrompt = Config.defaultSystemPrompt;
        this.allowWebSearch = true;
        this.webSearchMaxResults = 5;
        this.includePreviousMessagesAsContext = true;
        this.searchEngine = 'duckduckgo';
        this.deepResearchWebSearchMaxPlanningResults = 10;
        this.deepResearchSystemPrompt = Config.defaultDeepResearchSynthesisPrompt; // appended to the internal system prompt
        this.deepResearchMaxSubqrequests = 8;
        this.deepResearchWebRequestsPerSubrequest = 6;
        this.deepResearchMaxPlanningTokens = 16384;
        this.deepResearchMaxSynthesisTokens = 16384;
        this.systemPrompts = [
            {
                name: 'Default',
                prompt: this.systemPrompt
            },
        ];
        this.synthesisPrompts = [
            {
                name: 'Default',
                prompt: this.deepResearchSystemPrompt,
            }
        ];
    }

    ensureDefaults() {
        // Ensure systemPrompts has a Default prompt
        const defaultSystemPrompt = this.systemPrompts.find(p => p.name === 'Default');
        if (defaultSystemPrompt) {
            defaultSystemPrompt.prompt = Config.defaultSystemPrompt;
        } else {
            this.systemPrompts.unshift({
                name: 'Default',
                prompt: Config.defaultSystemPrompt
            });
        }

        // Ensure synthesisPrompts has a Default prompt
        const defaultSynthesisPrompt = this.synthesisPrompts.find(p => p.name === 'Default');
        if (defaultSynthesisPrompt) {
            defaultSynthesisPrompt.prompt = Config.defaultDeepResearchSynthesisPrompt;
        } else {
            this.synthesisPrompts.unshift({
                name: 'Default',
                prompt: Config.defaultDeepResearchSynthesisPrompt
            });
        }
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
    architecture: {
        input_modalities : 'text' | 'image'[];
        output_modalities : 'text' | 'image'[];
        tokenizer: string;
    };
    top_provider? : {
        is_moderated? : boolean;
        context_length?: number;
        max_completion_tokens?: number;
    }
    pricing: {
        prompt: string;
        completion: string;
        image?: string;
        request?: string;
        web_search?: string;
        internal_reasoning? : string;
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
    researchResults?: ResearchResult[]; // results of standard research, if multiple were done
    annotations?: Annotation[];
    resources?: Resource[]; // List of resources used for research
    error?: {
        message: string;
        url?: string;
        method?: string;
        statusCode?: number;
        requestBody?: any;
        responseBody?: any;
    };
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


/** Used in deep research for doing sub-queries */
export interface ResearchThread {
    prompt: string; // the prompt for the sub-query
    firstPass? : ChatResult;
    refiningPrompt? : string; // the prompt for refining the first pass
    refined? : ChatResult;
    generationPromises: Promise<GenerationData>[];   // new field
    handleGenerationData: (data: GenerationData) => void;
    resources?: Resource[];   // resources extracted from first pass
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

export interface SystemPrompt {
    name: string;
    prompt: string;
}

export interface ParallelResearchModel {
    modelId: string;
    modelName?: string;
    providers?: string[]; // Optional list of acceptable providers
}

export interface ResearchResult {
    systemPrompt?: string;
    systemPromptName?: string;
    modelId?: string;
    modelName?: string;
    streamingResult: StreamingResult;
    chatResult?: ChatResult;
    generationData?: GenerationData;
    resources : Resource[];
    annotations: Annotation[];
    contextWasIncluded?: boolean; // true if the previous messages were included in the context
}


export interface DeepResearchResult {
    id: string;
    total_cost: number;
    models: ModelsForResearch;
    planningModel: string;
    researchModel: string;
    refiningModel: string;
    synthesisModel: string;
    content: string;
    contextWasIncluded?: boolean; // true if the previous messages were included in the context
    plan_prompt: string;
    plan_result: ChatResult;
    research_plan: string;
    plan_prompts: string[]; // prompts used for the research plan
    plan_results: ChatResult[]; // results of the research plan
    research_plans: string[]; // research plans for each thread
    research_threads : ResearchThread[];
    synthesis_prompt: string;
    synthesis_result: ChatResult;
    synthesisPromptStrings: string[]; // all synthesis prompts used
    synthesisResults: ChatResult[]; // all synthesis results
    annotations?: Annotation[];
    resources : Resource[];
    elapsed_time: number; // wall-clock time taken for the deep research (in seconds)
    total_generation_time: number; // total time taken for all generations in the deep research (in seconds)
    total_research_threads: number; // total number of research threads executed
    web_queries_per_thread: number; // number of web queries allowed per research thread
    research_threads_per_phase: number[]; // number of research threads in each phase
}

export function sanitizeDeepResearch(result: DeepResearchResult): DeepResearchResult {
    // Ensure array fields are populated with their singleton counterparts if empty
    const sanitized = {
        ...result,
        planningModel: result.planningModel || 'deepseek/deepseek-chat-v3-0324:free',
        researchModel: result.researchModel || 'deepseek/deepseek-chat-v3-0324:free',
        refiningModel: result.refiningModel || 'deepseek/deepseek-chat-v3-0324:free',
        synthesisModel: result.synthesisModel || 'deepseek/deepseek-chat-v3-0324:free'
    };
    
    if ((!sanitized.plan_prompts || sanitized.plan_prompts.length === 0) && sanitized.plan_prompt) {
        sanitized.plan_prompts = [sanitized.plan_prompt];
    }
    
    if ((!sanitized.plan_results || sanitized.plan_results.length === 0) && sanitized.plan_result) {
        sanitized.plan_results = [sanitized.plan_result];
    }
    
    if ((!sanitized.research_plans || sanitized.research_plans.length === 0) && sanitized.research_plan) {
        sanitized.research_plans = [sanitized.research_plan];
    }
    
    if ((!sanitized.synthesisPromptStrings || sanitized.synthesisPromptStrings.length === 0) && sanitized.synthesis_prompt) {
        sanitized.synthesisPromptStrings = [sanitized.synthesis_prompt];
    }
    
    if ((!sanitized.synthesisResults || sanitized.synthesisResults.length === 0) && sanitized.synthesis_result) {
        sanitized.synthesisResults = [sanitized.synthesis_result];
    }
    
    return sanitized;
}

export class APIError extends Error {
    url: string;
    method: string;
    requestBody?: any;
    responseBody?: any;
    statusCode?: number;

    constructor(
        message: string,
        url: string,
        method: string,
        statusCode?: number,
        requestBody?: any,
        responseBody?: any
    ) {
        super(message);
        this.url = url;
        this.method = method;
        this.statusCode = statusCode;
        this.requestBody = requestBody;
        this.responseBody = responseBody;
        this.name = 'APIError';
    }
}

export interface ExperimentationOptions {
    parallelResearch: boolean; // If true, do research in parallel
    standardResearchPrompts: SystemPrompt[];
    standardResearchModels: ParallelResearchModel[];
}

