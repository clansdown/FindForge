import type { Config, Model, StreamingResult, GenerationData } from './types';
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
  messages: any[],
  callback: (chunk: string) => void,
  abortController?: AbortController
): Promise<StreamingResult> {
  const url = 'https://openrouter.ai/api/v1/chat/completions';
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };

  const body = {
    model: modelId,
    messages,
    max_tokens: maxTokens,
    stream: true,
    plugins: maxWebRequests > 0 ? [{ type: "web_search", max_requests: maxWebRequests }] : undefined
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: abortController?.signal
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }

  const requestID = response.headers.get('X-Request-ID') || '';
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let result: StreamingResult = {
    requestID,
    model: modelId,
    created: Date.now(),
    done: false
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
            if (json.choices?.[0]?.delta?.content) {
              callback(json.choices[0].delta.content);
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

// Fetch generation data from OpenRouter Generation API
export async function fetchGenerationData(apiKey : string, requestId : string): Promise<GenerationData | null> {
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
        return null;
    }
}
