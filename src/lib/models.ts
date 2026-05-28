import { type Config, type Model, type StreamingResult, type OpenRouterCredits, type ChatResult, type ApiCallMessage, type ToolDefinition, type ToolCall, type CompletionResult, type Annotation, APIError } from './types';
import { getClerkToken } from '../auth';

const OPENROUTER_DIRECT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_PROXY_BASE_URL = import.meta.env.DEV
    ? '/openrouter-proxy'
    : 'https://findforge-openrouter.chris-f57.workers.dev';
const OPENROUTER_PROXY_URL = OPENROUTER_PROXY_BASE_URL + '/chat/completions';
const USERS_WORKER_URL = import.meta.env.DEV
    ? '/users-worker'
    : 'https://findforge-users.chris-f57.workers.dev';

let cachedModels: Model[] | null = null;

const MODEL_BLACKLIST: RegExp[] = [
    /meta-llama\/llama-3\.1-8b-instruct/i,
    /google\/gemma-3-12b-it/i,
];

const RATE_LIMIT_MAX_RETRIES = 10;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchModels(apiKey: string): Promise<Model[]> {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: {
            'Authorization': `Bearer ${apiKey}`
        }
    });
    
    if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.data.map((model: any) => ({
        id: model.id,
        name: model.name,
        description: model.description,
        context_length: model.context_length,
        pricing: {
            prompt: model.pricing.prompt,
            completion: model.pricing.completion
        },
        supported_parameters: model.supported_parameters,
    })).filter((m: { id: string }) => !MODEL_BLACKLIST.some(re => re.test(m.id)));
}

export function createSystemApiCallMessage(text: string): ApiCallMessage {
    return {
        role: 'system',
        content: [{
            type: 'text',
            text: text
        }]
    };
}

export function createUserApiCallMessage(text: string): ApiCallMessage {
    return {
        role: 'user',
        content: [{
            type: 'text',
            text: text
        }]
    };
}

export async function fetchOpenRouterCredits(apiKey: string): Promise<OpenRouterCredits> {
    const response = await fetch('https://openrouter.ai/api/v1/credits', {
        headers: {
            'Authorization': `Bearer ${apiKey}`
        }
    });
    
    if (!response.ok) {
        throw new Error(`Failed to fetch credits: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.data as OpenRouterCredits;
}

export async function getModels(config: Config): Promise<Model[]> {
    if (cachedModels) {
        return cachedModels;
    }

    try {
        if (config.apiKey) {
            cachedModels = await fetchModels(config.apiKey);
        } else {
            cachedModels = await fetchModels('');
        }
    } catch {
        cachedModels = [];
    }

    return cachedModels;
}

// ── OpenRouter routing abstraction ──

async function getOpenRouterEndpoint(config: Config): Promise<{ url: string; headers: Record<string, string> }> {
    if (config.apiKey) {
        return {
            url: OPENROUTER_DIRECT_URL,
            headers: {
                'Authorization': `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
                'X-Title': 'MachineLearner',
            },
        };
    }
    const token = await getClerkToken();
    if (!token) throw new Error('OpenRouter requires an API key or Clerk authentication.');
    return {
        url: OPENROUTER_PROXY_URL,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
    };
}

async function enforceModel(_config: Config, modelId: string): Promise<string> {
    return modelId;
}

async function openRouterFetch(config: Config, body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    const { url, headers } = await getOpenRouterEndpoint(config);
    return fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
    });
}

/**
 * Calls the OpenRouter Chat API to generate a response based on the provided messages.
 * Returns a promise that resolves to a ChatResult object containing the response.
 */
export async function callOpenRouterChat(
  config: Config,
  modelId: string,
  maxTokens: number,
  maxWebRequests: number,
  messages: ApiCallMessage[],
  abortController?: AbortController,
  reasoning_effort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh',
  onStatus?: (status: string) => void,
): Promise<ChatResult> {
  const finalModel = await enforceModel(config, modelId);
  const body: any = {
    model: finalModel,
    messages : messages,
    max_tokens: maxTokens,
    stream: false,
    plugins: maxWebRequests > 0 ? [{ id: "web", max_results: maxWebRequests }] : [],
  };
  if (reasoning_effort && reasoning_effort !== 'none') {
    body.reasoning_effort = reasoning_effort;
  }
  const body_string = JSON.stringify(body);

  let response: Response;
  let attempt = 0;
  while (true) {
      attempt++;
      response = await openRouterFetch(config, body, abortController?.signal);
      if (response.ok) break;

      if ((response.status === 429 || response.status === 503) && attempt <= RATE_LIMIT_MAX_RETRIES) {
          const computed = Math.pow(2, attempt) * 1000;
          const capped = Math.min(computed, 60000);
          const retryAfterMs = parseInt(response.headers.get('Retry-After') || '0', 10) * 1000;
          const delayMs = Math.max(capped, retryAfterMs);
          onStatus?.(`Rate limited — retrying in ${(delayMs / 1000).toFixed(0)}s...`);
          await sleep(delayMs);
          continue;
      }

      const message = response.status === 429
          ? 'The LLM provider is overloaded at this time.'
          : `API request failed: ${response.status} ${response.statusText}`;
      throw new APIError(
          message,
          response.url,
          'POST',
          response.status,
          body_string,
          await response.clone().text()
      );
  }

  const data = await response.json();
  const content = data.choices[0].message.content;
  const annotations = data.choices[0].message.annotations || [];
  const requestID = data.id;
  const model = data.model;
  const totalTokens = data.usage?.total_tokens;
  const promptTokens = data.usage?.prompt_tokens;
  const completionTokens = data.usage?.completion_tokens;
  const cost = data.usage?.cost ?? undefined;

  return {
    requestID,
    model,
    created: Date.now(),
    done: true,
    totalTokens,
    promptTokens,
    completionTokens,
    cost,
    content,
    annotations
  };
}

function extractToolCallsFromText(content: string): { toolCalls: ToolCall[]; preamble: string } | null {
    const stripped = content
        .replace(/<REASONING>[\s\S]*?<\/REASONING>/gi, '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
        .replace(/<ANSWER>[\s\S]*?<\/ANSWER>/gi, '');

    if (!stripped.trim()) return null;

    const trimmed = stripped.trim();
    const lastBracket = trimmed.lastIndexOf(']');
    if (lastBracket === -1) return null;

    let searchFrom = lastBracket;
    while (searchFrom >= 0) {
        const openBracket = trimmed.lastIndexOf('[', searchFrom);
        if (openBracket === -1) break;

        const candidate = trimmed.slice(openBracket, lastBracket + 1);
        try {
            const parsed = JSON.parse(candidate);
            if (Array.isArray(parsed) && parsed.length > 0 &&
                parsed.every(tc => tc.id && tc.type === 'function' && tc.function?.name && tc.function?.arguments != null)) {
                return {
                    toolCalls: parsed.map(tc => ({
                        id: tc.id,
                        type: 'function' as const,
                        function: {
                            name: tc.function.name,
                            arguments: typeof tc.function.arguments === 'string'
                                ? tc.function.arguments
                                : JSON.stringify(tc.function.arguments),
                        },
                    })),
                    preamble: trimmed.slice(0, openBracket).trim(),
                };
            }
        } catch {}

        searchFrom = openBracket - 1;
    }

    return null;
}

export async function callOpenRouterWithTools(options: {
    config: Config;
    modelId: string;
    messages: ApiCallMessage[];
    maxTokens: number;
    tools?: ToolDefinition[];
    toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
    stream: boolean;
    onContent?: (chunk: string) => void;
    onToolCallDelta?: (delta: Partial<ToolCall>) => void;
    onReasoning?: (chunk: string) => void;
    onStatus?: (status: string) => void;
    signal?: AbortSignal;
    reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh';
}): Promise<CompletionResult> {
    const { config, modelId, messages, maxTokens, tools, toolChoice, stream, onContent, onToolCallDelta, onReasoning, onStatus, signal, reasoningEffort } = options;

    const finalModel = await enforceModel(config, modelId);
    const body: Record<string, unknown> = {
        model: finalModel,
        messages,
        max_tokens: maxTokens,
        stream,
    };

    if (tools && tools.length > 0) {
        body.tools = tools.map(t => ({
            type: 'function',
            function: {
                name: t.function.name,
                description: t.function.description,
                parameters: t.function.parameters,
            },
        }));
        body.tool_choice = toolChoice || 'auto';
    }

    if (reasoningEffort && reasoningEffort !== 'none') {
        body.reasoning_effort = reasoningEffort;
    }

    const bodyString = JSON.stringify(body);

    let response: Response;
    let attempt = 0;
    while (true) {
        attempt++;
        response = await openRouterFetch(config, body, signal);
        if (response.ok) break;

        if ((response.status === 429 || response.status === 503) && attempt <= RATE_LIMIT_MAX_RETRIES) {
            const computed = Math.pow(2, attempt) * 1000;
            const capped = Math.min(computed, 60000);
            const retryAfterMs = parseInt(response.headers.get('Retry-After') || '0', 10) * 1000;
            const delayMs = Math.max(capped, retryAfterMs);
            onStatus?.(`Rate limited — retrying in ${(delayMs / 1000).toFixed(0)}s...`);
            await sleep(delayMs);
            continue;
        }

        const message = response.status === 429
            ? 'The LLM provider is overloaded at this time.'
            : `API request failed: ${response.status} ${response.statusText}`;
        throw new APIError(
            message,
            response.url,
            'POST',
            response.status,
            bodyString,
            await response.clone().text(),
        );
    }

    const requestIDHeader = response.headers.get('X-Request-ID') || '';
    let requestID = requestIDHeader;

    if (!stream) {
        const data = await response.json();
        const choice = data.choices?.[0];
        let content = choice?.message?.content || '';
        let toolCalls: ToolCall[] | null = choice?.message?.tool_calls || null;
        let finishReason = choice?.finish_reason || 'stop';
        const totalTokens = data.usage?.total_tokens;
        const promptTokens = data.usage?.prompt_tokens;
        const completionTokens = data.usage?.completion_tokens;
        const cost = data.usage?.cost ?? undefined;
        const annotations = choice?.message?.annotations || [];

        if (!toolCalls) {
            const extracted = extractToolCallsFromText(content);
            if (extracted) {
                content = extracted.preamble;
                toolCalls = extracted.toolCalls;
                finishReason = 'tool_calls';
            }
        }

        return {
            requestID: data.id || requestID,
            model: data.model || modelId,
            content,
            toolCalls,
            finishReason,
            totalTokens,
            promptTokens,
            completionTokens,
            cost,
            annotations,
            requestBody: bodyString,
        };
    }

    // ── Streaming path ──
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Failed to get response reader');

    const decoder = new TextDecoder();
    let content = '';
    let finishReason: 'stop' | 'tool_calls' | 'length' = 'stop';
    let totalTokens: number | undefined;
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;
    let cost: number | undefined;
    const annotations: Annotation[] = [];
    const toolCallAccum: Map<number, { id: string; name: string; argumentsChunks: string[] }> = new Map();

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n').filter(line => line.trim() !== '');

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.replace('data: ', '');
                if (data === '[DONE]') {
                    let resultToolCalls: ToolCall[] | null = finishReason === 'tool_calls'
                        ? [...toolCallAccum.entries()].map(([idx, acc]) => ({
                            id: acc.id,
                            type: 'function' as const,
                            function: {
                                name: acc.name,
                                arguments: acc.argumentsChunks.join(''),
                            },
                        }))
                        : null;

                    if (!resultToolCalls) {
                        const extracted = extractToolCallsFromText(content);
                        if (extracted) {
                            content = extracted.preamble;
                            resultToolCalls = extracted.toolCalls;
                            finishReason = 'tool_calls';
                        }
                    }

                    return {
                        requestID,
                        model: modelId,
                        content,
                        toolCalls: resultToolCalls,
                        finishReason,
                        totalTokens,
                        promptTokens,
                        completionTokens,
                        cost,
                        annotations,
                        requestBody: bodyString,
                    };
                }

                try {
                    const json = JSON.parse(data);
                    if (json.id) requestID = json.id;

                    const choice = json.choices?.[0];
                    const delta = choice?.delta;
                    if (!delta) continue;

                    // Content delta
                    if (delta.content && onContent) {
                        content += delta.content;
                        onContent(delta.content);
                    }

                    // Reasoning delta (e.g. DeepSeek R1 chain-of-thought)
                    if (delta.reasoning && onReasoning) {
                        onReasoning(delta.reasoning);
                    }

                    // Tool call deltas
                    const deltaToolCalls = delta.tool_calls;
                    if (deltaToolCalls) {
                        for (const tc of deltaToolCalls) {
                            const idx: number = tc.index ?? 0;
                            let acc = toolCallAccum.get(idx);
                            if (!acc) {
                                acc = { id: '', name: '', argumentsChunks: [] };
                                toolCallAccum.set(idx, acc);
                            }
                            if (tc.id) acc.id = tc.id;
                            if (tc.function?.name) acc.name = tc.function.name;
                            if (tc.function?.arguments) {
                                acc.argumentsChunks.push(tc.function.arguments);
                            }
                            if (onToolCallDelta) {
                                onToolCallDelta({
                                    id: acc.id || tc.id,
                                    type: 'function',
                                    function: {
                                        name: acc.name || tc.function?.name || '',
                                        arguments: acc.argumentsChunks.join(''),
                                    },
                                });
                            }
                        }
                    }

                    // Finish reason
                    const fr = choice.finish_reason;
                    if (fr) finishReason = fr;

                    // Annotations and usage
                    if (delta.annotations) {
                        annotations.push(...delta.annotations);
                    }
                    if (json.usage) {
                        totalTokens = json.usage.total_tokens;
                        promptTokens = json.usage.prompt_tokens;
                        completionTokens = json.usage.completion_tokens;
                        if (json.usage.cost != null) cost = json.usage.cost;
                    }
                } catch {
                    // Skip malformed SSE lines
                }
            }
        }
    } finally {
        reader.releaseLock();
    }

    let resultToolCalls: ToolCall[] | null = finishReason === 'tool_calls'
        ? [...toolCallAccum.entries()].map(([idx, acc]) => ({
            id: acc.id,
            type: 'function' as const,
            function: {
                name: acc.name,
                arguments: acc.argumentsChunks.join(''),
            },
        }))
        : null;

    if (!resultToolCalls) {
        const extracted = extractToolCallsFromText(content);
        if (extracted) {
            content = extracted.preamble;
            resultToolCalls = extracted.toolCalls;
            finishReason = 'tool_calls';
        }
    }

    return {
        requestID,
        model: modelId,
        content,
        toolCalls: resultToolCalls,
        finishReason,
        totalTokens,
        promptTokens,
        completionTokens,
        cost,
        annotations,
        requestBody: bodyString,
    };
}

export function createAssistantApiCallMessage(text: string): ApiCallMessage {
    return {
        role: 'assistant',
        content: [{
            type: 'text',
            text: text
        }]
    };
}

export function errorCodeToMeaning(code : number): string {
  switch(code) {
    case 400:
      return 'Bad Request (invalid or missing parameters, CORS error)';
    case 401:
      return 'Invalid credentials (OAuth session expired, disabled/invalid API key)';
    case 402:
      return 'Your account or API key has insufficient credits. Add more credits and retry the request.';
    case 403:
      return 'Your chosen model requires moderation and your input was flagged';
    case 408:
      return 'Your request timed out';
    case 429:
      return 'You are being rate limited';
    case 502:
      return 'Your chosen model is down or we received an invalid response from it';
    case 503:
      return 'There is no available model provider that meets your routing requirements';
    default:
      return `Unknown error (code ${code})`;
  }
}
