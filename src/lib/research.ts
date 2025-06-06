import { callOpenRouterStreaming, fetchGenerationData } from './models';
import type { ApiCallMessage, StreamingResult, MessageData, Config, GenerationData, ResearchResult } from './types';

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
    
    // Prepare messages for API
    const messagesForAPI: ApiCallMessage[] = [];
    
    // Add system prompt
    if (config.systemPrompt) {
        messagesForAPI.push({ 
            role: 'system', 
            content: [{ type: 'text', text: config.systemPrompt }] 
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
        const streamingResult = await callOpenRouterStreaming(
            config.apiKey,
            config.defaultModel,
            maxTokens,
            maxWebRequests,
            messagesForAPI,
            callback,
            abortController
        );
        let generationData: GenerationData | undefined = undefined;
        if (streamingResult.requestID) {
            generationData = await fetchGenerationData(config.apiKey, streamingResult.requestID);
        }
        updateStatus('Research completed');
        return { streamingResult, generationData };
    } catch (error) {
        updateStatus('Research failed');
        throw error;
    }
}
