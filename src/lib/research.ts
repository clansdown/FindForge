import { parse } from 'svelte/compiler';
import { callOpenRouterChat, callOpenRouterWithTools } from './models';
import { resourceInstructions, parseResourcesFromContent } from './resources';
import type { ApiCallMessage, MessageData, Config, GenerationData, ResearchResult, Resource, SystemPrompt, ParallelResearchModel, ToolCallRecord, ToolCallProgress, CompletionResult, Annotation, ToolExecutionContext, ToolRoundInfo } from './types';
import { ToolRegistry } from './tools';
import { TOOL_LIMIT_INSTRUCTION } from './prompts';

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
    
    const result: ApiCallMessage = {
        role: message.role,
        content: contentParts
    };

    if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
        result.tool_calls = message.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments),
            },
        }));
    }

    return result;
}

export function convertToolCallsToToolMessages(toolCalls: ToolCallRecord[]): ApiCallMessage[] {
    return toolCalls.map(tc => ({
        role: 'tool',
        tool_call_id: tc.id,
        content: [{ type: 'text', text: tc.result }],
    }));
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
    onToolCallProgress?: (update: ToolCallProgress) => void,
    previousToolCalls?: ToolCallRecord[],
): Promise<ResearchResult> {
    return doStandardResearchWithTools(maxTokens, config, userMessage, history, callback, updateStatus, abortController, toolRegistry ?? new ToolRegistry(), onThinking, onToolCallProgress, previousToolCalls);
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
    onToolCallProgress?: (update: ToolCallProgress) => void,
    previousToolCalls?: ToolCallRecord[],
): Promise<ResearchResult> {
    onStatus('Starting research with tools...');
    const resources: Resource[] = [];
    const systemPromptUsed = config.systemPrompt || undefined;
    const toolCallRecords: ToolCallRecord[] = [];
    const toolRounds: ToolRoundInfo[] = [];
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
                if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
                    messagesForAPI.push(...convertToolCallsToToolMessages(m.toolCalls));
                }
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
    console.log(`[Tools] Starting tool-calling loop: maxIterations=${maxIterations}, tools=[${tools.map(t => t.function.name).join(', ')}]`);

    try {
        while (iteration < maxIterations) {
            const isLastAttempt = iteration >= maxIterations - 1;
            const availableTools = isLastAttempt ? undefined : tools;
            console.log(`[Tools] [${iteration + 1}/${maxIterations}]${isLastAttempt ? ' <<< FINAL (tools disabled)' : ''} calling LLM with ${availableTools?.length ?? 0} tools`);

            if (isLastAttempt && toolCallRecords.length > 0) {
                messagesForAPI.push({
                    role: 'user',
                    content: [{ type: 'text', text: TOOL_LIMIT_INSTRUCTION }],
                });
                console.log(`[Tools] [${iteration + 1}/${maxIterations}] injected STOP instruction (${toolCallRecords.length} prior tool calls exhausted limit)`);
            }

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
            const costStr = result.cost != null ? `$${result.cost.toFixed(6)}` : 'N/A';
            const tokStr = result.totalTokens != null ? `${result.totalTokens} (p${result.promptTokens ?? 0}+c${result.completionTokens ?? 0})` : 'N/A';
            console.log(`[Tools] [${iteration + 1}/${maxIterations}] response: finish=${result.finishReason}, model=${result.model}, cost=${costStr}, tokens=${tokStr}`);
            toolRounds.push({
                promptTokens: result.promptTokens,
                completionTokens: result.completionTokens,
                cost: result.cost,
                model: result.model,
                finishReason: result.finishReason,
            });
            if (result.annotations) {
                allAnnotations.push(...result.annotations);
            }

            if (result.finishReason !== 'tool_calls' || !result.toolCalls || result.toolCalls.length === 0) {
                finalContent = result.content || finalContent;
                break;
            }

            // Record and execute tool calls
            console.log(`[Tools] [${iteration + 1}/${maxIterations}] LLM requested ${result.toolCalls.length} tools: ${result.toolCalls.map(t => t.function.name).join(', ')}`, result.toolCalls);
            if (onThinking) onThinking('\n\n---\n');

            const assistantMsg: ApiCallMessage = {
                role: 'assistant',
                content: [{ type: 'text', text: '' }],
                tool_calls: result.toolCalls,
            };
            messagesForAPI.push(assistantMsg);

            const ctx: ToolExecutionContext = { config, signal: abortController?.signal, onStatus, previousToolCalls: [...(previousToolCalls ?? []), ...toolCallRecords] };
            const startTimeMs = Date.now();

            if (onToolCallProgress) {
                for (const tc of result.toolCalls) {
                    const def = toolRegistry.getDefinition(tc.function.name);
                    const parsedArgs = JSON.parse(tc.function.arguments || '{}');
                    onToolCallProgress({
                        id: tc.id,
                        name: tc.function.name,
                        displayName: def?.displayName || tc.function.name,
                        args: parsedArgs,
                        formattedArgs: def?.formatArgs(parsedArgs),
                        status: 'running',
                    });
                }
            }

            const toolResults = await toolRegistry.executeAll(result.toolCalls, ctx);

            for (let i = 0; i < result.toolCalls.length; i++) {
                const tc = result.toolCalls[i];
                const tr = toolResults[i];
                const durationMs = Date.now() - startTimeMs;
                const def = toolRegistry.getDefinition(tc.function.name);
                const parsedArgs = JSON.parse(tc.function.arguments || '{}');
                const formattedResult = def?.formatResult(tr.content);
                toolCallRecords.push({
                    id: tc.id,
                    name: tc.function.name,
                    arguments: parsedArgs,
                    formattedArgs: def?.formatArgs(parsedArgs),
                    result: tr.content,
                    formattedResult,
                    startTimeMs,
                    durationMs,
                });
                if (onToolCallProgress) {
                    onToolCallProgress({
                        id: tc.id,
                        name: tc.function.name,
                        displayName: def?.displayName || tc.function.name,
                        args: parsedArgs,
                        formattedArgs: def?.formatArgs(parsedArgs),
                        status: tr.content.startsWith('Error:') ? 'error' : 'completed',
                        formattedResult,
                        result: tr.content,
                        durationMs,
                    });
                }
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

            console.log(`[Tools] [${iteration + 1}/${maxIterations}] round complete: ${result.toolCalls.length} tool(s) executed`);
            onStatus('');
            iteration++;

            if (iteration >= maxIterations && !abortController?.signal.aborted) {
                // Force final answer
                onStatus('Returning final answer...');
            }
        }
        console.log(`[Tools] Loop ended: ${toolCallRecords.length} total tool calls across ${iteration} rounds, final finish_reason=${lastResult?.finishReason || 'N/A'}`);

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

        const generationData: GenerationData | undefined = lastResult ? {
            id: lastResult.requestID || '',
            total_cost: lastResult.cost ?? 0,
            model: lastResult.model || config.defaultModel,
            generation_time: 0,
            provider_name: '',
            created: Date.now(),
            streamed: true,
            canceled: abortController?.signal.aborted ?? false,
            finish_reason: lastResult.finishReason || 'stop',
            tokens_prompt: lastResult.promptTokens,
            tokens_completion: lastResult.completionTokens,
        } : undefined;

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
            toolRounds,
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
                if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
                    baseMessages.push(...convertToolCallsToToolMessages(m.toolCalls));
                }
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
                abortController,
                config.defaultReasoningEffort
            );
            
            const generationData: GenerationData | undefined = chatResult.requestID ? {
                id: chatResult.requestID,
                total_cost: chatResult.cost ?? 0,
                model: chatResult.model || config.defaultModel,
                generation_time: 0,
                provider_name: '',
                created: Date.now(),
                streamed: true,
                canceled: false,
                finish_reason: chatResult.finishReason || 'stop',
                tokens_prompt: chatResult.promptTokens,
                tokens_completion: chatResult.completionTokens,
            } : undefined;

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
