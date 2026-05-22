import { type Config, type Model, type StreamingResult, type GenerationData, type OpenRouterCredits, type ChatResult, type ApiCallMessage, type ToolDefinition, type ToolCall, type CompletionResult, type Annotation, APIError } from './types';
import { sleep } from './util';


let cachedModels: Model[] | null = null;

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
        }
    }));
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
    if (!config.apiKey) {
        throw new Error('API key is required to fetch models');
    }
    
    if (cachedModels) {
        return cachedModels;
    }
    
    cachedModels = await fetchModels(config.apiKey);
    return cachedModels;
}

export async function callOpenRouterStreaming(
  apiKey: string,
  modelId: string,
  maxTokens: number,
  maxWebRequests: number,
  messages: ApiCallMessage[],
  callback: (chunk: string) => void,
  abortController?: AbortController
): Promise<StreamingResult> {
  const url = 'https://openrouter.ai/api/v1/chat/completions';
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'X-Title': 'MachineLearner',
  };

  const body = {
    model: modelId,
    messages : messages,
    max_tokens: maxTokens,
    stream: true,
    plugins: maxWebRequests > 0 ? [{ id: "web", max_results: maxWebRequests }] : [],
  };
  const body_string = JSON.stringify(body);

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: body_string,
    signal: abortController?.signal
  });

  if (!response.ok) {
    throw new APIError(
        `API request failed: ${response.status} ${response.statusText}`,
        url,
        'POST',
        response.status,
        body_string,
        await response.clone().text()
    );
  }

  const requestID = response.headers.get('X-Request-ID') || '';
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let result: StreamingResult = {
    requestID,
    model: modelId,
    created: Date.now(),
    done: false,
    annotations: []
  };

  if (!reader) {
    throw new Error('Failed to get response reader');
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(line => line.trim() !== '');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.replace('data: ', '');
          if (data === '[DONE]') {
            result.done = true;
            return result;
          }

            try {
            const json = JSON.parse(data);
            if(json.id) {
                result.requestID = json.id;
            }
            if (json.model) {
                result.model = json.model;
            }
            if (json.choices?.[0]?.delta?.content) {
              callback(json.choices[0].delta.content);
            }
            if (json.choices?.[0]?.delta?.annotations) {
              result.annotations = [...(result.annotations||[]), ...json.choices[0].delta.annotations];
            }
            if (json.usage) {
              result.totalTokens = json.usage.total_tokens;
              result.promptTokens = json.usage.prompt_tokens;
              result.completionTokens = json.usage.completion_tokens;
              if (json.usage.cost != null) result.cost = json.usage.cost;
            }
          } catch (e) {
            console.error('Error parsing JSON chunk', e);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  result.done = true;
  return result;
}

/**
 * Calls the OpenRouter Chat API to generate a response based on the provided messages.
 * Returns a promise that resolves to a ChatResult object containing the response.
 */
export async function callOpenRouterChat(
  apiKey: string,
  modelId: string,
  maxTokens: number,
  maxWebRequests: number,
  messages: ApiCallMessage[],
  abortController?: AbortController,
  reasoning_effort?: 'low' | 'medium' | 'high'
): Promise<ChatResult> {
  const url = 'https://openrouter.ai/api/v1/chat/completions';
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'X-Title': 'MachineLearner',
  };

  const body: any = {
    model: modelId,
    messages : messages,
    max_tokens: maxTokens,
    stream: false,
    plugins: maxWebRequests > 0 ? [{ id: "web", max_results: maxWebRequests }] : [],
  };
  if (reasoning_effort) {
    body.reasoning_effort = reasoning_effort;
  }
  const body_string = JSON.stringify(body);

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: body_string,
    signal: abortController?.signal
  });
  

  if (!response.ok) {
    throw new APIError(
        `API request failed: ${response.status} ${response.statusText}`,
        url,
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

export async function callOpenRouterWithTools(options: {
    apiKey: string;
    modelId: string;
    messages: ApiCallMessage[];
    maxTokens: number;
    tools?: ToolDefinition[];
    toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
    stream: boolean;
    onContent?: (chunk: string) => void;
    onToolCallDelta?: (delta: Partial<ToolCall>) => void;
    signal?: AbortSignal;
    reasoningEffort?: 'low' | 'medium' | 'high';
}): Promise<CompletionResult> {
    const { apiKey, modelId, messages, maxTokens, tools, toolChoice, stream, onContent, onToolCallDelta, signal, reasoningEffort } = options;

    const url = 'https://openrouter.ai/api/v1/chat/completions';
    const headers: Record<string, string> = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'MachineLearner',
    };

    const body: Record<string, unknown> = {
        model: modelId,
        messages,
        max_tokens: maxTokens,
        stream,
    };

    if (tools && tools.length > 0) {
        body.tools = tools;
        body.tool_choice = toolChoice || 'auto';
    }

    if (reasoningEffort) {
        body.reasoning_effort = reasoningEffort;
    }

    const bodyString = JSON.stringify(body);

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: bodyString,
        signal,
    });

    if (!response.ok) {
        throw new APIError(
            `API request failed: ${response.status} ${response.statusText}`,
            url,
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
        const content = choice?.message?.content || '';
        const toolCalls: ToolCall[] | null = choice?.message?.tool_calls || null;
        const finishReason = choice?.finish_reason || 'stop';
        const totalTokens = data.usage?.total_tokens;
        const promptTokens = data.usage?.prompt_tokens;
        const completionTokens = data.usage?.completion_tokens;
        const cost = data.usage?.cost ?? undefined;
        const annotations = choice?.message?.annotations || [];

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
                    return {
                        requestID,
                        model: modelId,
                        content,
                        toolCalls: finishReason === 'tool_calls'
                            ? [...toolCallAccum.entries()].map(([idx, acc]) => ({
                                id: acc.id,
                                type: 'function' as const,
                                function: {
                                    name: acc.name,
                                    arguments: acc.argumentsChunks.join(''),
                                },
                            }))
                            : null,
                        finishReason,
                        totalTokens,
                        promptTokens,
                        completionTokens,
                        cost,
                        annotations,
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

    return {
        requestID,
        model: modelId,
        content,
        toolCalls: finishReason === 'tool_calls'
            ? [...toolCallAccum.entries()].map(([idx, acc]) => ({
                id: acc.id,
                type: 'function' as const,
                function: {
                    name: acc.name,
                    arguments: acc.argumentsChunks.join(''),
                },
            }))
            : null,
        finishReason,
        totalTokens,
        promptTokens,
        completionTokens,
        cost,
        annotations,
    };
}

// Fetch generation data from OpenRouter Generation API
export async function fetchGenerationData(apiKey : string, requestId : string): Promise<GenerationData | undefined> {
    const delaysMs = [1000, 2000, 4000];
    for (const delay of delaysMs) {
        await sleep(delay);
        try {
            const response = await fetch(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(requestId)}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://openrouter.ai',
                },
            });
            if (response.ok) {
                const data = await response.json();
                return data.data as GenerationData;
            }
        } catch {
            // continue to next retry
        }
    }
    console.warn('[gen] Generation data unavailable for', requestId);
    return undefined;
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
