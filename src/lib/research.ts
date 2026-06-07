import { parse } from 'svelte/compiler';
import { callOpenRouterWithTools } from './models';
import { resourceInstructions, parseResourcesFromContent } from './resources';
import type { ApiCallMessage, MessageData, Config, GenerationData, ResearchResult, Resource, SystemPrompt, ParallelResearchModel, ToolCallRecord, ToolCallProgress, CompletionResult, ChatResult, Annotation, ToolExecutionContext, ToolRoundInfo } from './types';
import { ToolRegistry } from './tools';
import { DEFAULT_SYSTEM_PROMPT, TOOL_LIMIT_INSTRUCTION, buildToolAddendum, TRUNCATION_NOTICE } from './prompts';
import { addToCache } from './docCache';
import { extractRatings, lookupRating, stripRatings } from './util';

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

export function convertToolCallsToToolMessages(toolCalls: ToolCallRecord[], filterLowRated = false): ApiCallMessage[] {
    const filtered = filterLowRated
        ? toolCalls.map(tc => ({
              ...tc,
              result: tc.rating != null && tc.rating < 5
                  ? `[RATED ${tc.rating}/10 SO NOT INCLUDED]`
                  : tc.result,
          }))
        : toolCalls;
    return filtered.map(tc => ({
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
    contextWindow?: number,
): Promise<ResearchResult> {
    return doStandardResearchWithTools(maxTokens, config, userMessage, history, callback, updateStatus, abortController, toolRegistry ?? new ToolRegistry(), onThinking, onToolCallProgress, previousToolCalls, contextWindow);
}


export function parseStructuredContent(content: string): { answer: string; thinking: string } {
    let working = content;

    const tagRe = /(think|thinking)/;
    const closedRe = new RegExp(`<${tagRe.source}>([\\s\\S]*?)<\\/${tagRe.source}>`, 'g');
    let reasoningMatch;
    const reasoningChunks: string[] = [];
    while ((reasoningMatch = closedRe.exec(working)) !== null) {
        const text = reasoningMatch[2].trim();
        if (text) reasoningChunks.push(text);
    }
    working = working.replace(closedRe, '').trim();

    const openRe = new RegExp(`<${tagRe.source}>([\\s\\S]*)$`);
    const openReasoningMatch = working.match(openRe);
    if (openReasoningMatch) {
        const text = openReasoningMatch[1].trim();
        if (text) reasoningChunks.push(text);
        working = working.replace(openRe, '').trim();
    }

    // Strip any trailing partial tags that may be split across chunks (e.g. <think, </think, <answer)
    working = working.replace(/(?:<[a-zA-Z\/]+)+$/, '').trim();

    const closedAnswerMatch = working.match(/<ANSWER>([\s\S]*?)<\/ANSWER>/i);
    const openAnswerMatch = !closedAnswerMatch ? working.match(/<ANSWER>([\s\S]*)$/i) : null;
    let answer: string;

    if (closedAnswerMatch) {
        answer = closedAnswerMatch[1].trim();
        const beforeAnswer = working.substring(0, closedAnswerMatch.index).trim();
        if (beforeAnswer) reasoningChunks.push(beforeAnswer);
    } else if (openAnswerMatch) {
        answer = openAnswerMatch[1].trim();
        const beforeAnswer = working.substring(0, openAnswerMatch.index).trim();
        if (beforeAnswer) reasoningChunks.push(beforeAnswer);
    } else {
        const resourcesIdx = working.toLowerCase().indexOf('<resources>');
        answer = resourcesIdx !== -1
            ? working.substring(0, resourcesIdx).trim()
            : working;
    }

    const resourcesIdx = answer.toLowerCase().indexOf('<resources>');
    if (resourcesIdx !== -1) {
        answer = answer.substring(0, resourcesIdx).trim();
    }

    return { answer, thinking: reasoningChunks.join('\n\n') };
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
    contextWindow?: number,
): Promise<ResearchResult> {
    const researchStartTime = Date.now();
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

    const tools = toolRegistry.getDefinitions();

    const systemText = (config.systemPrompt || DEFAULT_SYSTEM_PROMPT) + '\n\n' + resourceInstructions;
    const addendum = config.toolsEnabled && tools.length > 0 ? buildToolAddendum(tools) : '';
    messagesForAPI.push({
        role: 'system',
        content: [{ type: 'text', text: systemText + addendum }],
    });

    if (config.includePreviousMessagesAsContext) {
        for (const m of history) {
            if (!m.hidden) {
                messagesForAPI.push(convertMessageToApiCallMessage(m));
                if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0 && !m.deepResearchResult) {
                    messagesForAPI.push(...convertToolCallsToToolMessages(m.toolCalls, true));
                }
            }
        }
    }
    messagesForAPI.push(convertMessageToApiCallMessage(userMessage));

    let iteration = 0;
    let finalContent = '';
    let lastResult: CompletionResult | null = null;
    const allAnnotations: Annotation[] = [];
    const maxIterations = config.maxToolIterations || 8;
    let lastRoundToolCount = 0;
    const toolCallProgressItems: ToolCallProgress[] = [];
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

            const callStartTime = Date.now();
            const result: CompletionResult = await callOpenRouterWithTools({
                config,
                modelId: config.defaultModel,
                messages: messagesForAPI,
                maxTokens,
                tools: availableTools,
                toolChoice: isLastAttempt ? 'none' : 'auto',
                stream: true,
                onContent: ((buf, lastAns, lastThink) => (chunk: string) => {
                    buf += chunk;
                    finalContent += chunk;

                    const { answer, thinking } = parseStructuredContent(buf);

                    const newAnswer = answer.slice(lastAns);
                    if (newAnswer) {
                        lastAns = answer.length;
                        onContent(newAnswer);
                    }

                    const newThinking = thinking.slice(lastThink);
                    if (newThinking && onThinking) {
                        lastThink = thinking.length;
                        onThinking(newThinking);
                    }
})('', 0, 0),
                onToolCallDelta: () => {},
                onReasoning: onThinking,
                onStatus,
                signal: abortController?.signal,
                reasoningEffort: config.defaultReasoningEffort,
                onAttempt: (info) => {
                    toolRounds.push(info);
                },
            });
            lastResult = result;
            const costStr = result.cost != null ? `$${result.cost.toFixed(6)}` : 'N/A';
            const tokStr = result.totalTokens != null ? `${result.totalTokens} (p${result.promptTokens ?? 0}+c${result.completionTokens ?? 0})` : 'N/A';
            console.log(`[Tools] [${iteration + 1}/${maxIterations}] response: finish=${result.finishReason}, model=${result.model}, cost=${costStr}, tokens=${tokStr}`);
            if (result.error) {
                console.warn(`[Tools] [${iteration + 1}/${maxIterations}] API error: ${result.error}`);
            }
            if (result.annotations) {
                allAnnotations.push(...result.annotations);
            }

            // Parse inline ratings from generation response for all prior tool calls
            const ratings = extractRatings((result.content ?? '') + (result.reasoningContent ?? ''));
            if (ratings.size > 0) {
                console.log(`[ToolRating] Parsed ${ratings.size} ratings`);
                for (const tc of toolCallRecords) {
                    const rating = lookupRating(ratings, tc.id, tc.name);
                    if (rating != null) {
                        tc.rating = rating;
                        console.log(`[ToolRating] ${tc.name} (${tc.id}): ${rating}/10`);
                        const progressItem = toolCallProgressItems.find(p => p.id === tc.id);
                        if (progressItem) {
                            progressItem.rating = rating;
                            onToolCallProgress?.({ ...progressItem });
                        }
                        if (rating < 5) {
                            const toolMsgIdx = messagesForAPI.findIndex(
                                m => m.role === 'tool' && m.tool_call_id === tc.id,
                            );
                            if (toolMsgIdx >= 0) {
                                messagesForAPI[toolMsgIdx] = {
                                    ...messagesForAPI[toolMsgIdx],
                                    content: [{ type: 'text', text: `[RATED ${rating}/10 SO NOT INCLUDED]` }],
                                };
                            }
                        }
                    }
                }
                // Back-fill ratings into toolRounds toolResults
                for (const round of toolRounds) {
                    if (round.toolResults) {
                        for (const tr of round.toolResults) {
                            const rated = toolCallRecords.find(r => r.id === tr.id);
                            if (rated?.rating != null) {
                                tr.rating = rated.rating;
                            }
                        }
                    }
                }
            }

            // Select top 8 tool results to include in context
            const hasRatings = toolCallRecords.some(r => r.rating != null);
            const selected = hasRatings
                ? [...toolCallRecords].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)).slice(0, 8)
                : toolCallRecords.slice(-8);
            const selectedIds = new Set(selected.map(r => r.id));
            for (let i = 0; i < messagesForAPI.length; i++) {
                const msg = messagesForAPI[i];
                if (msg.role === 'tool' && msg.tool_call_id && !selectedIds.has(msg.tool_call_id)) {
                    if (!msg.content?.[0]?.text?.startsWith('[RATED')) {
                        messagesForAPI[i] = { ...msg, content: [{ type: 'text', text: '[NOT INCLUDED — context limit]' }] };
                    }
                }
            }

            if (result.finishReason !== 'tool_calls' || !result.toolCalls || result.toolCalls.length === 0) {
                finalContent = result.content || finalContent;
                break;
            }

            // Record and execute tool calls
            console.log(`[Tools] [${iteration + 1}/${maxIterations}] LLM requested ${result.toolCalls.length} tools: ${result.toolCalls.map(t => t.function.name).join(', ')}`, result.toolCalls);
            if (onThinking) onThinking('\n\n---\n');

            lastRoundToolCount = result.toolCalls.length;

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
                    let parsedArgs: Record<string, unknown>;
                    try { parsedArgs = JSON.parse(tc.function.arguments || '{}'); } catch { parsedArgs = {}; }
                    const progress: ToolCallProgress = {
                        id: tc.id,
                        name: tc.function.name,
                        displayName: def?.displayName || tc.function.name,
                        args: parsedArgs,
                        formattedArgs: def?.formatArgs(parsedArgs),
                        status: 'running',
                    };
                    toolCallProgressItems.push(progress);
                    onToolCallProgress(progress);
                }
            }

            const toolResults = await toolRegistry.executeAll(result.toolCalls, ctx);

            for (let i = 0; i < result.toolCalls.length; i++) {
                const tc = result.toolCalls[i];
                const tr = toolResults[i];
                const durationMs = Date.now() - startTimeMs;
                const def = toolRegistry.getDefinition(tc.function.name);
                let parsedArgs: Record<string, unknown>;
                try { parsedArgs = JSON.parse(tc.function.arguments || '{}'); } catch { parsedArgs = {}; }

                // Truncate large tool results
                const ctxThreshold = Math.floor((contextWindow || 128000) * 0.4);
                const truncateThreshold = Math.min(60000, ctxThreshold);
                if (tr.content.length > truncateThreshold) {
                    const cacheKey = tc.function.name === 'web_fetch'
                        ? (typeof parsedArgs?.url === 'string' ? parsedArgs.url : `tool://${tc.function.name}/${tc.id}`)
                        : `tool://${tc.function.name}/${tc.id}`;
                    addToCache(cacheKey, tr.content, 'text/plain').catch(() => {});
                    tr.content = tr.content.slice(0, truncateThreshold) + '\n\n' + TRUNCATION_NOTICE(cacheKey);
                }

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

                // Track successful page-fetching tool calls as resources
                if (def?.resourceMapper && !tr.content.startsWith('Error:')) {
                    const resource = def.resourceMapper(parsedArgs, tr.content);
                    if (resource) resources.push(resource);
                }
            }

            console.log(`[Tools] [${iteration + 1}/${maxIterations}] call complete: ${result.toolCalls.length} tool(s) executed`);
            // Attach tool results to the last API call round
            if (toolRounds.length > 0 && lastRoundToolCount > 0) {
                toolRounds[toolRounds.length - 1].toolResults = toolCallRecords.slice(-lastRoundToolCount).map(r => ({
                    id: r.id,
                    name: r.name,
                    result: r.result,
                    durationMs: r.durationMs,
                    rating: r.rating,
                }));
            }
            onStatus('');
            iteration++;

            if (iteration >= maxIterations && !abortController?.signal.aborted) {
                // Force final answer
                onStatus('Returning final answer...');
            }
        }
        console.log(`[Tools] Loop ended: ${toolCallRecords.length} total tool calls across ${iteration} calls, final finish_reason=${lastResult?.finishReason || 'N/A'}`);

        if (finalContent) {
            console.log('[resources] finalContent before parse:', {
                length: finalContent.length,
                containsResourceTag: /<RESOURCE>/i.test(finalContent),
                containsRESOURCESTag: /<RESOURCES>/i.test(finalContent),
                finalContent,
            });
            const parsed = parseResourcesFromContent(finalContent);
            console.log('[resources] parsed from finalContent:', { count: parsed.length, parsed });
            resources.push(...parsed);
        }

        if (finalContent) {
            const { answer, thinking: remainingThinking } = parseStructuredContent(finalContent);
            if (remainingThinking && onThinking) onThinking(remainingThinking);
            finalContent = stripRatings(answer);
        }

        onStatus('Research completed');

        const generationData: GenerationData | undefined = lastResult ? {
            id: lastResult.requestID || '',
            total_cost: toolRounds.reduce((sum, r) => sum + (r.cost ?? 0), 0),
            model: lastResult.model || config.defaultModel,
            generation_time: Date.now() - researchStartTime,
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
        const apiError = error as any;
        const errorInfo = {
            message: apiError.message || String(error),
            url: apiError.url,
            method: apiError.method,
            statusCode: apiError.statusCode,
            requestBody: apiError.requestBody,
            responseBody: apiError.responseBody,
        };
        return {
            content: finalContent || '',
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
            },
            resources,
            annotations: allAnnotations,
            contextWasIncluded: config.includePreviousMessagesAsContext,
            toolCallRecords,
            toolIterations: iteration,
            toolRounds,
            error: errorInfo,
        };
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
    console.log('Starting parallel research', systemPrompts, models);

    // Prepare base messages (history) that are common to all requests
    const baseMessages: ApiCallMessage[] = [];
    if (config.includePreviousMessagesAsContext) {
        for (const m of history) {
            if (!m.hidden) {
                baseMessages.push(convertMessageToApiCallMessage(m));
                if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0 && !m.deepResearchResult) {
                    baseMessages.push(...convertToolCallsToToolMessages(m.toolCalls, true));
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
            const cr = await callOpenRouterWithTools({
                config,
                modelId: model.modelId,
                messages: messagesForAPI,
                maxTokens,
                stream: true,
                signal: abortController?.signal,
                reasoningEffort: config.defaultReasoningEffort,
            });
            
            const chatResult: ChatResult = {
                requestID: cr.requestID,
                model: cr.model,
                created: Date.now(),
                done: cr.finishReason !== 'tool_calls',
                content: cr.content,
                totalTokens: cr.totalTokens,
                promptTokens: cr.promptTokens,
                completionTokens: cr.completionTokens,
                cost: cr.cost,
                annotations: cr.annotations,
                finishReason: cr.finishReason,
            };

            const generationData: GenerationData | undefined = cr.requestID ? {
                id: cr.requestID,
                total_cost: cr.cost ?? 0,
                model: cr.model || config.defaultModel,
                generation_time: 0,
                provider_name: '',
                created: Date.now(),
                streamed: true,
                canceled: false,
                finish_reason: cr.finishReason || 'stop',
                tokens_prompt: cr.promptTokens,
                tokens_completion: cr.completionTokens,
            } : undefined;

            return {
                systemPrompt: prompt.prompt,
                systemPromptName: prompt.name,
                modelId: model.modelId,
                modelName: model.modelName,
                streamingResult: chatResult,
                chatResult,
                generationData, 
                annotations: cr.annotations || [], 
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
