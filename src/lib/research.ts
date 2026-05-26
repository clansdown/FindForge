import { parse } from 'svelte/compiler';
import { callOpenRouterChat, callOpenRouterWithTools, fetchGenerationData } from './models';
import { resourceInstructions, parseResourcesFromContent } from './resources';
import type { ApiCallMessage, MessageData, Config, GenerationData, ResearchResult, Resource, SystemPrompt, ParallelResearchModel, ToolCallRecord, CompletionResult, Annotation } from './types';
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
    toolRegistry?: ToolRegistry,
    onThinking?: (chunk: string) => void,
): Promise<ResearchResult> {
    return doStandardResearchWithTools(maxTokens, config, userMessage, history, callback, updateStatus, abortController, toolRegistry ?? new ToolRegistry(), onThinking);
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
    onThinking?: (chunk: string) => void,
): Promise<ResearchResult> {
    onStatus('Starting research with tools...');
    const resources: Resource[] = [];
    const systemPromptUsed = config.systemPrompt || undefined;
    const toolCallRecords: ToolCallRecord[] = [];
    console.log('[resources] doStandardResearchWithTools initialized:', {
        hasSystemPrompt: !!config.systemPrompt,
        configPromptSnippet: config.systemPrompt?.slice(0, 100),
        toolsRegistered: toolRegistry.getDefinitions().map(t => t.function.name),
    });

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
            const availableTools = isLastAttempt ? undefined : tools;
            console.log(`[Tools] Offering ${availableTools?.length ?? 0} tools to LLM`);
            const result: CompletionResult = await callOpenRouterWithTools({
                config,
                modelId: config.defaultModel,
                messages: messagesForAPI,
                maxTokens,
                tools: availableTools,
                toolChoice: isLastAttempt ? 'none' : 'auto',
                stream: true,
                onContent: (chunk) => {
                    finalContent += chunk;
                    onContent(chunk);
                },
                onToolCallDelta: () => {},
                onReasoning: onThinking,
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
            onStatus(`Using ${result.toolCalls.map(t => {
                if (t.function.name === 'web_fetch') {
                    try {
                        const args = JSON.parse(t.function.arguments || '{}');
                        return args.url ? `web_fetch:${args.url}` : 'web_fetch';
                    } catch { return 'web_fetch'; }
                }
                return t.function.name;
            }).join(', ')}...`);
            if (onThinking) onThinking('\n\n---\n');

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
                if (tc.function.name === 'web_fetch') {
                    const isError = tr.content.startsWith('Error:');
                    console.log('[resources] web_fetch result:', {
                        arguments: tc.function.arguments,
                        isError,
                        contentSample: tr.content.slice(0, 300),
                        fullContent: tr.content,
                    });
                    if (!isError) {
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
                            console.log('[resources] pushed web_fetch resource:', { url, resourcesSoFar: resources.length, resources: resources.map(r => ({ url: r.url })) });
                        }
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
            console.log('[resources] finalContent before parse:', {
                length: finalContent.length,
                containsResourceTag: finalContent.includes('<RESOURCE>'),
                containsRESOURCESTag: finalContent.includes('<RESOURCES>'),
                finalContent,
            });
            const parsed = parseResourcesFromContent(finalContent);
            console.log('[resources] parsed from finalContent:', { count: parsed.length, parsed });
            resources.push(...parsed);
        }
        onStatus('Research completed');

        const generationData = lastResult?.requestID
            ? await fetchGenerationData(config.apiKey, lastResult.requestID)
            : undefined;

        console.log('[resources] returning ResearchResult:', {
            resourceCount: resources.length,
            resources: resources.map(r => ({ url: r.url, title: r.title })),
            toolCallCount: toolCallRecords.length,
            finalContentLength: finalContent?.length,
        });
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
            toolIterations: iteration,
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
                config,
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
