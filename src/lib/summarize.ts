import { callOpenRouterWithTools, createSystemApiCallMessage } from './models';
import { SUMMARY_PROMPT } from './prompts';
import type { ApiCallMessage, Config, ConversationSummary, MessageData, ToolCallRecord } from './types';
import { estimateTokenCount, generateID } from './util';

const TEXT_OVERHEAD = 1.1;
const TOKEN_BUDGET = 100_000;
const SUMMARY_MAX_TOKENS = 2048;

function estimateMessageTokens(messages: ApiCallMessage[]): number {
    let total = 0;
    for (const msg of messages) {
        let text = '';
        if (msg.role === 'system' || msg.role === 'user' || msg.role === 'assistant') {
            for (const part of msg.content) {
                if ('text' in part && typeof part.text === 'string') {
                    text += part.text + ' ';
                }
            }
        } else if (msg.role === 'tool') {
            for (const part of msg.content) {
                if ('text' in part && typeof part.text === 'string') {
                    text += part.text + ' ';
                }
            }
        }
        if (msg.tool_calls) {
            for (const tc of msg.tool_calls) {
                text += tc.function.name + ' ' + tc.function.arguments + ' ';
            }
        }
        total += estimateTokenCount(text);
    }
    return Math.ceil(total * TEXT_OVERHEAD);
}

function convertToolCallsToToolMessages(toolCalls: ToolCallRecord[]): ApiCallMessage[] {
    return toolCalls.map(tc => ({
        role: 'tool',
        tool_call_id: tc.id,
        content: [{ type: 'text', text: tc.result }],
    }));
}

export async function generateSummary(
    config: Config,
    modelId: string,
    messagesToSummarize: ApiCallMessage[],
    signal?: AbortSignal,
    callbacks?: {
        onContent?: (chunk: string) => void;
        onRetry?: () => void;
    },
): Promise<string> {
    const systemPrompt = createSystemApiCallMessage(SUMMARY_PROMPT);

    for (let attempt = 0; attempt <= 4; attempt++) {
        const result = await callOpenRouterWithTools({
            config,
            modelId,
            messages: [systemPrompt, ...messagesToSummarize],
            maxTokens: SUMMARY_MAX_TOKENS,
            stream: true,
            onContent: callbacks?.onContent,
            signal,
        });

        if (result.content) return result.content;

        if (attempt < 4) {
            console.warn(`[Summary] empty result, retry ${attempt + 1}/4`);
            callbacks?.onRetry?.();
        }
    }

    return '[Summary unavailable]';
}

export async function compactConversationHistory(
    config: Config,
    modelId: string,
    contextLength: number,
    history: MessageData[],
    signal?: AbortSignal,
    callbacks?: {
        onContent?: (chunk: string) => void;
        onRetry?: () => void;
    },
): Promise<{ compactedMessages: MessageData[]; newSummary?: ConversationSummary }> {
    if (history.length === 0) return { compactedMessages: history };

    const threshold = Math.min(TOKEN_BUDGET, Math.floor(contextLength * 0.5));

    const allApiMessages: ApiCallMessage[] = [];
    for (const m of history) {
        if (m.hidden) continue;
        allApiMessages.push({
            role: m.role,
            content: [{ type: 'text', text: m.content }],
        });
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
            allApiMessages.push(...convertToolCallsToToolMessages(m.toolCalls));
        }
    }

    const totalTokens = estimateMessageTokens(allApiMessages);
    if (totalTokens < threshold) return { compactedMessages: history };

    const summaryText = await generateSummary(config, modelId, allApiMessages, signal, callbacks);

    const summaryMsg: MessageData = {
        id: generateID(),
        role: 'user',
        content: summaryText,
        isSummary: true,
        hidden: false,
        timestamp: Date.now(),
    };

    const lastRawMsg = history[history.length - 1];
    const newSummary: ConversationSummary = {
        upToMessageId: lastRawMsg.id,
        content: summaryText,
        tokenEstimate: estimateTokenCount(summaryText),
        created: Date.now(),
    };

    const lastMsgApi: ApiCallMessage[] = [
        { role: lastRawMsg.role, content: [{ type: 'text', text: lastRawMsg.content }] },
    ];
    if (lastRawMsg.role === 'assistant' && lastRawMsg.toolCalls && lastRawMsg.toolCalls.length > 0) {
        lastMsgApi.push(...convertToolCallsToToolMessages(lastRawMsg.toolCalls));
    }
    const lastMsgTokens = estimateMessageTokens(lastMsgApi);
    const summaryTokens = newSummary.tokenEstimate;

    if (summaryTokens + lastMsgTokens < threshold) {
        return { compactedMessages: [summaryMsg, lastRawMsg], newSummary };
    }

    return { compactedMessages: [summaryMsg], newSummary };
}

function estimateHistoryTokens(history: MessageData[]): number {
    let total = 0;
    for (const m of history) {
        if (m.hidden) continue;
        total += estimateTokenCount(m.content);
        if (m.toolCalls) {
            for (const tc of m.toolCalls) {
                total += estimateTokenCount(tc.result);
            }
        }
    }
    return Math.ceil(total * TEXT_OVERHEAD);
}

export interface BuildContextCallbacks {
    onCompactionStart?: () => void;
    onContent?: (chunk: string) => void;
    onRetry?: () => void;
    onCompactionEnd?: () => void;
}

export async function buildConversationContext(
    config: Config,
    modelId: string,
    contextLength: number,
    history: MessageData[],
    signal?: AbortSignal,
    callbacks?: BuildContextCallbacks,
): Promise<{ messages: MessageData[]; newSummary?: ConversationSummary }> {
    if (history.length === 0) return { messages: history };

    const threshold = Math.min(TOKEN_BUDGET, Math.floor(contextLength * 0.5));

    if (estimateHistoryTokens(history) < threshold) {
        return { messages: history };
    }

    callbacks?.onCompactionStart?.();

    const result = await compactConversationHistory(config, modelId, contextLength, history, signal, {
        onContent: callbacks?.onContent,
        onRetry: callbacks?.onRetry,
    });

    callbacks?.onCompactionEnd?.();

    return { messages: result.compactedMessages, newSummary: result.newSummary };
}
