import { type Config, type Model, type StreamingResult, type GenerationData, type OpenRouterCredits, type ChatResult, type ApiCallMessage, APIError } from './types';
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
    let responseBody;
    try {
        responseBody = await response.clone().json();
    } catch {
        try {
            responseBody = await response.clone().text();
        } catch {
            responseBody = null;
        }
    }
    throw new APIError(
        `API request failed: ${response.status} ${response.statusText}`,
        url,
        'POST',
        response.status,
        body_string,
        responseBody
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
            if (json.choices?.[0]?.delta?.content) {
              callback(json.choices[0].delta.content);
            }
            if (json.choices?.[0]?.delta?.annotations) {
              result.annotations = [...(result.annotations||[]), ...json.choices[0].delta.annotations];
            }
            if (json.usage) {
              result.totalTokens = json.usage.total_tokens;
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

  return {
    requestID,
    model,
    created: Date.now(),
    done: true,
    totalTokens,
    content,
    annotations
  };
}

// Fetch generation data from OpenRouter Generation API
export async function fetchGenerationData(apiKey : string, requestId : string): Promise<GenerationData> {
    try {
        // We can't request this immediately as the generation object won't instantly exist, we have to wait a short time
        await sleep(1000);
        const response = await fetch(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(requestId)}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://openrouter.ai',
            },
        });
        
        if (!response.ok) throw new Error('Failed to fetch generation data');
        const data = await response.json();
        return data.data as GenerationData;
    } catch (error) {
        console.error('Error fetching generation data:', error);
        return {
            id: requestId,
            total_cost: 0,
            model: '',
            generation_time: 0,
            provider_name: '',
            created: 0,
            streamed: false,
            canceled: false,
            finish_reason: 'error'
        };
    }
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
