import { parse } from 'svelte/compiler';
import { callOpenRouterChat, callOpenRouterStreaming, fetchGenerationData } from './models';
import { resourceInstructions, parseResourcesFromContent } from './resources';
import type { ApiCallMessage, StreamingResult, MessageData, Config, GenerationData, ResearchResult, Resource, SystemPrompt, ParallelResearchModel } from './types';

export function convertMessageToApiCallMessage(message: MessageData): ApiCallMessage {
    const contentParts: ApiCallMessage['content'] = [];
    
    // Add text content if present
    if (message.content) {
        contentParts.push({ type: 'text', text: message.content });
    }
    
    // Add attachments
    if (message.attachments) {
        for (const attachment of message.attachments) {
            if (attachment.filename.endsWith('.pdf')) {
                contentParts.push({
                    type: 'file',
                    file: {
                        filename: attachment.filename,
                        file_data: attachment.content
                    }
                });
            } else {
                // For text files, just include as text
                contentParts.push({
                    type: 'text',
                    text: `[File: ${attachment.filename}]\n${attachment.content}`
                });
            }
        }
    }
    
    return {
        role: message.role,
        content: contentParts
    };
}

export async function doStandardResearch(
    maxTokens: number,
    config: Config,
    userMessage: MessageData,
    history: MessageData[],
    callback: (chunk: string) => void,
    updateStatus: (status: string) => void,
    abortController?: AbortController
): Promise<ResearchResult> {
    updateStatus('Starting research...');
    const resources: Resource[] = [];
    const systemPromptUsed = config.systemPrompt || undefined;
    
    // Prepare messages for API
    const messagesForAPI: ApiCallMessage[] = [];
    
    // Add system prompt with resource instructions
    if (config.systemPrompt) {
        messagesForAPI.push({ 
            role: 'system', 
            content: [{ type: 'text', text: config.systemPrompt + '\n\n' + resourceInstructions }] 
        });
    }
    
    // Add history if enabled
    if (config.includePreviousMessagesAsContext) {
        for (const m of history) {
            if (!m.hidden) {
                messagesForAPI.push(convertMessageToApiCallMessage(m));
            }
        }
    } 
    // Always include the current user message
    messagesForAPI.push(convertMessageToApiCallMessage(userMessage));
    
    
    const maxWebRequests = config.allowWebSearch ? config.webSearchMaxResults : 0;
    
    console.log('Messages for API:', messagesForAPI);

    try {
        let content = '';
        const streamingResult = await callOpenRouterStreaming(
            config.apiKey,
            config.defaultModel,
            maxTokens,
            maxWebRequests,
            messagesForAPI,
            (chunk) => {
                content += chunk;
                callback(chunk);
            },
            abortController
        );
        let generationData: GenerationData | undefined = undefined;
        if (streamingResult.requestID) {
            generationData = await fetchGenerationData(config.apiKey, streamingResult.requestID);
            if(generationData) streamingResult.generationData = generationData;
        }
        // Parse any resources from the response, using our tracked content
        if (content) {
            console.log("parsed resources: ", parseResourcesFromContent(content));
            resources.push(...parseResourcesFromContent(content));
        }
        updateStatus('Research completed');
        return { 
            systemPrompt: systemPromptUsed,
            content,
            streamingResult, 
            generationData, 
            annotations: streamingResult.annotations || [], 
            resources,
            contextWasIncluded: config.includePreviousMessagesAsContext
        };
    } catch (error) {
        updateStatus('Research failed');
        throw error;
    }
}

export async function doParallelResearch(
    maxTokens: number,
    config: Config,
    userMessage: ApiCallMessage,
    history: MessageData[],
    systemPrompts: SystemPrompt[],
    models: ParallelResearchModel[],
    abortController?: AbortController
): Promise<ResearchResult[]> {
    const resources: Resource[] = [];
    const maxWebRequests = config.allowWebSearch ? config.webSearchMaxResults : 0;
    console.log('Starting parallel research', systemPrompts, models);

    // Prepare base messages (history) that are common to all requests
    const baseMessages: ApiCallMessage[] = [];
    if (config.includePreviousMessagesAsContext) {
        for (const m of history) {
            if (!m.hidden) {
                baseMessages.push(convertMessageToApiCallMessage(m));
            }
        }
    }

    // Create all combinations of models and prompts to be processed in parallel
    const combinations = systemPrompts.flatMap(prompt => 
        models.map(model => ({ prompt, model }))
    );
    console.log("Combinations:", combinations);

    const results = await Promise.all(combinations.map(async ({ prompt, model }) => {
        console.log(`Processing combination: model=${model.modelId} prompt=${prompt.name}`);
        // Create full message list for this request
        const messagesForAPI : ApiCallMessage[]= [
            { 
                role: 'system', 
                content: [{ type: 'text', text: prompt.prompt }] 
            },
            ...baseMessages, 
            userMessage
        ];
        
        try {
            const chatResult = await callOpenRouterChat(
                config.apiKey,
                model.modelId,
                maxTokens,
                maxWebRequests,
                messagesForAPI,
                abortController
            );
            
            let generationData: GenerationData | undefined = undefined;
            if (chatResult.requestID) {
                generationData = await fetchGenerationData(config.apiKey, chatResult.requestID);
            }
            
            return { 
                systemPrompt: prompt.prompt,
                systemPromptName: prompt.name,
                modelId: model.modelId,
                modelName: model.modelName,
                streamingResult: chatResult,
                chatResult: chatResult, 
                generationData, 
                annotations: chatResult.annotations || [], 
                resources: [...resources],
                contextWasIncluded: config.includePreviousMessagesAsContext
            };
        } catch (error) {
            console.error('Error in parallel research:', error);
            throw error;
        }
    }));

    return results;
}
