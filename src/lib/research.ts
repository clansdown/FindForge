import { parse } from 'svelte/compiler';
import { callOpenRouterChat, callOpenRouterStreaming, callOpenRouterWithTools, fetchGenerationData } from './models';
import { resourceInstructions, parseResourcesFromContent } from './resources';
import type { ApiCallMessage, StreamingResult, MessageData, Config, GenerationData, ResearchResult, Resource, SystemPrompt, ParallelResearchModel, ToolCallRecord, CompletionResult, Annotation } from './types';
import { ToolRegistry } from './tools';

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
    abortController?: AbortController,
    toolRegistry?: ToolRegistry
): Promise<ResearchResult> {
    if (config.toolsEnabled && toolRegistry && toolRegistry.getDefinitions().length > 0) {
        return doStandardResearchWithTools(maxTokens, config, userMessage, history, callback, updateStatus, abortController, toolRegistry);
    }

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

async function doStandardResearchWithTools(
    maxTokens: number,
    config: Config,
    userMessage: MessageData,
    history: MessageData[],
    onContent: (chunk: string) => void,
    onStatus: (status: string) => void,
    abortController: AbortController | undefined,
    toolRegistry: ToolRegistry,
): Promise<ResearchResult> {
    onStatus('Starting research with tools...');
    const resources: Resource[] = [];
    const systemPromptUsed = config.systemPrompt || undefined;
    const toolCallRecords: ToolCallRecord[] = [];

    const messagesForAPI: ApiCallMessage[] = [];

    if (config.systemPrompt) {
        messagesForAPI.push({
            role: 'system',
            content: [{ type: 'text', text: config.systemPrompt + '\n\n' + resourceInstructions }],
        });
    }

    if (config.includePreviousMessagesAsContext) {
        for (const m of history) {
            if (!m.hidden) {
                messagesForAPI.push(convertMessageToApiCallMessage(m));
            }
        }
    }
    messagesForAPI.push(convertMessageToApiCallMessage(userMessage));

    const tools = toolRegistry.getDefinitions();
    let iteration = 0;
    let finalContent = '';
    let lastResult: CompletionResult | null = null;
    const allAnnotations: Annotation[] = [];
    const maxIterations = config.maxToolIterations || 8;

    try {
        while (iteration < maxIterations) {
            const isLastAttempt = iteration >= maxIterations - 1;
            const result: CompletionResult = await callOpenRouterWithTools({
                apiKey: config.apiKey,
                modelId: config.defaultModel,
                messages: messagesForAPI,
                maxTokens,
                tools: isLastAttempt ? undefined : tools,
                toolChoice: isLastAttempt ? 'none' : 'auto',
                stream: iteration === 0 || isLastAttempt,
                onContent: (chunk) => {
                    finalContent += chunk;
                    onContent(chunk);
                },
                onToolCallDelta: () => {},
                signal: abortController?.signal,
                reasoningEffort: config.defaultReasoningEffort,
            });
            lastResult = result;
            if (result.annotations) {
                allAnnotations.push(...result.annotations);
            }

            if (result.finishReason !== 'tool_calls' || !result.toolCalls || result.toolCalls.length === 0) {
                finalContent = result.content || finalContent;
                break;
            }

            // Record and execute tool calls
            console.log(`[Tools] LLM requested: ${result.toolCalls.map(t => t.function.name).join(', ')}`, result.toolCalls);
            onStatus(`Using ${result.toolCalls.map(t => t.function.name).join(', ')}...`);

            const assistantMsg: ApiCallMessage = {
                role: 'assistant',
                content: [{ type: 'text', text: '' }],
                tool_calls: result.toolCalls,
            };
            messagesForAPI.push(assistantMsg);

            const ctx = { config, signal: abortController?.signal };
            const startTimeMs = Date.now();

            const toolResults = await toolRegistry.executeAll(result.toolCalls, ctx);

            for (let i = 0; i < result.toolCalls.length; i++) {
                const tc = result.toolCalls[i];
                const tr = toolResults[i];
                const durationMs = Date.now() - startTimeMs;
                toolCallRecords.push({
                    id: tc.id,
                    name: tc.function.name,
                    arguments: JSON.parse(tc.function.arguments || '{}'),
                    result: tr.content,
                    startTimeMs,
                    durationMs,
                });
                messagesForAPI.push({
                    role: 'tool',
                    tool_call_id: tr.tool_call_id,
                    content: [{ type: 'text', text: tr.content }],
                });

                // Track successful web_fetch calls as resources
                if (tc.function.name === 'web_fetch' && !tr.content.startsWith('Error:')) {
                    let url = '';
                    try {
                        url = JSON.parse(tc.function.arguments || '{}').url;
                    } catch {}
                    if (url) {
                        resources.push({
                            url,
                            type: 'web_fetch',
                            summary: tr.content.slice(0, 200),
                        });
                    }
                }
            }

            onStatus('');
            iteration++;
            if (toolCallRecords.length > 0) {
                console.log(`[Tools] ${toolCallRecords.length} tools executed:`, toolCallRecords);
            }

            if (iteration >= maxIterations && !abortController?.signal.aborted) {
                // Force final answer
                onStatus('Returning final answer...');
            }
        }

        if (finalContent) {
            resources.push(...parseResourcesFromContent(finalContent));
        }
        onStatus('Research completed');

        const generationData = lastResult?.requestID
            ? await fetchGenerationData(config.apiKey, lastResult.requestID)
            : undefined;

        return {
            systemPrompt: systemPromptUsed,
            content: finalContent,
            streamingResult: {
                requestID: lastResult?.requestID || '',
                model: lastResult?.model || config.defaultModel,
                created: Date.now(),
                done: true,
                totalTokens: lastResult?.totalTokens,
                promptTokens: lastResult?.promptTokens,
                completionTokens: lastResult?.completionTokens,
                cost: lastResult?.cost,
                annotations: allAnnotations,
                generationData,
            },
            generationData,
            resources,
            annotations: allAnnotations,
            contextWasIncluded: config.includePreviousMessagesAsContext,
            toolCallRecords,
        };
    } catch (error) {
        onStatus('Research failed');
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
