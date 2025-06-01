import type { Config, Model } from './types';


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
