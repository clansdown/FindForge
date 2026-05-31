<script lang="ts">
    import { onMount, tick } from "svelte";
    import ModalDialog from "./ModalDialog.svelte";
    import ThinkingBox from "./ThinkingBox.svelte";
    import ToolCallDisplay from "./ToolCallDisplay.svelte";
    import { callOpenRouterWithTools } from "./models";
    import { createToolRegistry } from "./tools";
    import { buildToolAddendum, QUICK_QUESTION_PROMPT } from "./prompts";
    import { resolveQuickQuestionModel } from "./util";
    import { parseStructuredContent } from "./research";
    import MarkdownIt from "markdown-it";
    import markdownItLinkAttributes from "markdown-it-link-attributes";
    import type { Config, Model, ApiCallMessage, ToolCallProgress, ToolExecutionContext } from "./types";

    export let models: Model[] = [];
    export let show: boolean;
    export let initialText: string = '';
    export let context: string = '';
    export let allowTools: boolean = true;
    export let config: Config;
    export let onClose: () => void;

    const md = new MarkdownIt({
        html: false,
        breaks: true,
        linkify: true,
    });
    md.use(markdownItLinkAttributes, { attrs: { target: '_blank', rel: 'noopener noreferrer' } });

    function formatAnswer(text: string): string {
        return md.render(text);
    }

    let textareaValue = initialText;
    let toolOverride = allowTools;
    let loading = false;
    let totalCost = 0;

    interface QAPair {
        question: string;
        answer: string;
        thinking: string;
        toolCallProgress: ToolCallProgress[];
        complete: boolean;
    }
    let qaPairs: QAPair[] = [];

    let qaContainer: HTMLDivElement;
    let qaTextarea: HTMLTextAreaElement;

    onMount(() => {
        qaTextarea?.focus();
    });

    function scrollToBottom() {
        if (qaContainer) {
            qaContainer.scrollTop = qaContainer.scrollHeight;
        }
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            ask();
        }
    }

    function buildApiMessages(question: string): ApiCallMessage[] {
        const toolsAvailable = toolOverride && config.enabledTools.length > 0;
        const addendum = toolsAvailable ? buildToolAddendum(createToolRegistry(config.enabledTools).getDefinitions()) : '';
        const systemText = (context
            ? QUICK_QUESTION_PROMPT + '\n\nContext:\n' + context
            : QUICK_QUESTION_PROMPT)
            + (addendum ? '\n\n' + addendum : '');

        const msgs: ApiCallMessage[] = [
            { role: 'system', content: [{ type: 'text', text: systemText }] },
        ];

        for (const qa of qaPairs.slice(0, -1)) {
            msgs.push({ role: 'user', content: [{ type: 'text', text: qa.question }] });
            if (qa.answer) {
                msgs.push({ role: 'assistant', content: [{ type: 'text', text: qa.answer }] });
            }
        }

        msgs.push({ role: 'user', content: [{ type: 'text', text: question }] });
        return msgs;
    }

    async function ask() {
        const question = textareaValue.trim();
        if (!question || loading) return;

        const qa: QAPair = { question, answer: '', thinking: '', toolCallProgress: [], complete: false };
        qaPairs = [...qaPairs, qa];
        textareaValue = '';
        loading = true;

        await tick();
        scrollToBottom();

        const toolsAvailable = toolOverride && config.enabledTools.length > 0;
        const tools = toolsAvailable ? createToolRegistry(config.enabledTools) : undefined;
        const modelId = resolveQuickQuestionModel(config, models);
        const effort = config.quickQuestionReasoningEffort || config.defaultReasoningEffort;

        try {
            const apiMessages = buildApiMessages(question);
            const currentIndex = qaPairs.length - 1;
            let iteration = 0;
            const maxIterations = 8;
            let contentBuffer = '';
            let lastAnswerLen = 0;
            let lastThinkLen = 0;

            while (iteration < maxIterations) {
                const isLastAttempt = iteration >= maxIterations - 1;
                const availableTools = isLastAttempt ? undefined : tools?.getDefinitions();

                if (isLastAttempt && iteration > 0) {
                    apiMessages.push({
                        role: 'user',
                        content: [{ type: 'text', text: 'No more tool calls allowed. Provide your final answer.' }],
                    });
                }

                const result = await callOpenRouterWithTools({
                    config,
                    modelId,
                    messages: apiMessages,
                    maxTokens: 4096,
                    tools: availableTools,
                    toolChoice: isLastAttempt ? 'none' : 'auto',
                    stream: true,
                    onContent: (chunk) => {
                        contentBuffer += chunk;
                        const { answer, thinking } = parseStructuredContent(contentBuffer);

                        const newAnswer = answer.slice(lastAnswerLen);
                        if (newAnswer) {
                            qaPairs[currentIndex].answer += newAnswer;
                            qaPairs = qaPairs;
                            scrollToBottom();
                            lastAnswerLen = answer.length;
                        }

                        const newThinking = thinking.slice(lastThinkLen);
                        if (newThinking) {
                            qaPairs[currentIndex].thinking += newThinking;
                            qaPairs = qaPairs;
                            scrollToBottom();
                            lastThinkLen = thinking.length;
                        }
                    },
                    onReasoning: (chunk) => {
                        qaPairs[currentIndex].thinking += chunk;
                        qaPairs = qaPairs;
                        scrollToBottom();
                    },
                    onToolCallDelta: (_delta) => {},
                    onStatus: () => {},
                    reasoningEffort: effort,
                });

                totalCost += result.cost ?? 0;

                if (result.finishReason !== 'tool_calls' || !result.toolCalls || result.toolCalls.length === 0) {
                    if (result.content) {
                        qaPairs[currentIndex].answer = result.content.replace(/<\/?ANSWER>/gi, '').trim();
                    }
                    qaPairs[currentIndex].complete = true;
                    qaPairs = qaPairs;
                    break;
                }

                apiMessages.push({
                    role: 'assistant',
                    content: [{ type: 'text', text: '' }],
                    tool_calls: result.toolCalls,
                });

                for (const tc of result.toolCalls) {
                    const def = tools?.getDefinition(tc.function.name);
                    let parsedArgs: Record<string, unknown>;
                    try { parsedArgs = JSON.parse(tc.function.arguments || '{}'); } catch { parsedArgs = {}; }
                    qaPairs[currentIndex].toolCallProgress = [
                        ...qaPairs[currentIndex].toolCallProgress,
                        {
                            id: tc.id,
                            name: tc.function.name,
                            displayName: def?.displayName || tc.function.name,
                            args: parsedArgs,
                            formattedArgs: def?.formatArgs(parsedArgs),
                            status: 'running',
                        },
                    ];
                    qaPairs = qaPairs;
                    scrollToBottom();
                }

                const ctx: ToolExecutionContext = { config };
                const toolResults = await tools!.executeAll(result.toolCalls, ctx);

                for (let i = 0; i < result.toolCalls.length; i++) {
                    const tc = result.toolCalls[i];
                    const tr = toolResults[i];
                    const def = tools?.getDefinition(tc.function.name);
                    let parsedArgs: Record<string, unknown>;
                    try { parsedArgs = JSON.parse(tc.function.arguments || '{}'); } catch { parsedArgs = {}; }

                    apiMessages.push({
                        role: 'tool',
                        tool_call_id: tr.tool_call_id,
                        content: [{ type: 'text', text: tr.content }],
                    });

                    const formattedResult = def?.formatResult(tr.content);
                    qaPairs[currentIndex].toolCallProgress = qaPairs[currentIndex].toolCallProgress.map(p =>
                        p.id === tc.id
                            ? { ...p, status: tr.content.startsWith('Error:') ? 'error' as const : 'completed' as const, formattedResult, result: tr.content }
                            : p,
                    );
                    qaPairs = qaPairs;
                    scrollToBottom();
                }

                iteration++;
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            qaPairs[qaPairs.length - 1].answer += `\n\n[Error: ${msg}]`;
            qaPairs[qaPairs.length - 1].complete = true;
            qaPairs = qaPairs;
        } finally {
            loading = false;
            await tick();
        }
    }
</script>

<ModalDialog isOpen={show} {onClose} size="lg">
    <div class="quick-question">
        <div class="row header align-items-center">
            <div class="col d-flex align-items-center gap-2">
                <h3 class="mb-0">Quick Question</h3>
                <label class="tool-toggle mb-0" title="Allow the model to use tools to answer">
                    <input type="checkbox" bind:checked={toolOverride} disabled={loading} />
                    Allow tool calls
                </label>
            </div>
            <div class="col-auto">
                <button class="close-button" on:click={onClose} title="Close">✕</button>
            </div>
        </div>

        <div class="qa-container" bind:this={qaContainer}>
            {#each qaPairs as qa, i}
                <div class="qa-entry">
                    <div class="qa-question"><strong>Q:</strong> {qa.question}</div>
                    {#if qa.thinking}
                        {#if !qa.complete}
                            <ThinkingBox thinking={qa.thinking} />
                        {:else}
                            <details>
                                <summary>Show reasoning</summary>
                                <div class="thinking-content">{qa.thinking}</div>
                            </details>
                        {/if}
                    {/if}
                    {#if qa.toolCallProgress.length > 0 && !qa.complete}
                        <ToolCallDisplay progress={qa.toolCallProgress} />
                    {/if}
                    {#if qa.answer}
                        <div class="qa-answer">{@html formatAnswer(qa.answer)}</div>
                    {:else if loading && i === qaPairs.length - 1}
                        <div class="qa-answer loading">Generating…</div>
                    {/if}
                </div>
            {/each}
        </div>

        <div class="input-area">
            <div class="row g-2 align-items-end">
                <div class="col">
                    <textarea
                        bind:this={qaTextarea}
                        bind:value={textareaValue}
                        placeholder="Ask your question"
                        disabled={loading}
                        on:keydown={handleKeydown}
                    ></textarea>
                </div>
                <div class="col-auto">
                    <button class="ask-button" on:click={ask} disabled={loading || !textareaValue.trim()}>
                        {loading ? 'Working…' : 'Ask'}
                    </button>
                </div>
            </div>
        </div>
        <div class="cost-display">Session cost: ${totalCost.toFixed(4)}</div>
    </div>
</ModalDialog>

<style>
    .quick-question {
        display: flex;
        flex-direction: column;
        height: 70vh;
        padding: 0.5rem;
    }
    .header {
        border-bottom: 1px solid #444;
        margin-bottom: 0.5rem;
        padding-bottom: 0.5rem;
    }
    .header h3 {
        margin: 0;
    }
    .close-button {
        background: none;
        border: none;
        color: #aaa;
        cursor: pointer;
        font-size: 1.2rem;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
    }
    .close-button:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
    }
    .qa-container {
        flex: 1;
        overflow-y: auto;
        margin-bottom: 0.5rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }
    .qa-entry {
        padding: 0.5rem;
        background: #1a1a1a;
        border-radius: 6px;
    }
    .qa-question {
        margin-bottom: 0.25rem;
        color: #ddd;
    }
    .qa-answer {
        white-space: pre-wrap;
        word-break: break-word;
        color: #ccc;
        line-height: 1.4;
    }
    .qa-answer :global(p) {
        margin: 0.25rem 0;
    }
    .qa-answer :global(code) {
        background: #2a2a2a;
        padding: 0.1rem 0.3rem;
        border-radius: 3px;
        font-size: 0.85rem;
    }
    .qa-answer :global(pre) {
        background: #2a2a2a;
        padding: 0.5rem;
        border-radius: 4px;
        overflow-x: auto;
    }
    .qa-answer :global(a) {
        color: #4caf50;
    }
    .qa-answer :global(ul),
    .qa-answer :global(ol) {
        margin: 0.25rem 0;
        padding-left: 1.5rem;
    }
    .qa-answer :global(li) {
        margin: 0.1rem 0;
    }
    .qa-answer.loading {
        color: #888;
        font-style: italic;
    }
    .thinking-content {
        white-space: pre-line;
        word-break: break-word;
        font-size: 0.85rem;
        line-height: 1.4;
        background: #1a1a1a;
        padding: 0.5rem;
        border-radius: 4px;
        margin-top: 0.25rem;
    }
    details {
        margin-top: 0.25rem;
    }
    details summary {
        cursor: pointer;
        color: #aaa;
        font-size: 0.85rem;
    }
    .input-area {
        border-top: 1px solid #444;
        padding-top: 0.5rem;
    }
    textarea {
        width: 100%;
        box-sizing: border-box;
        padding: 0.5rem;
        background: #222;
        color: #ddd;
        border: 1px solid #555;
        border-radius: 4px;
        resize: vertical;
        min-height: 60px;
        font-family: inherit;
        font-size: 0.9rem;
    }
    textarea:disabled {
        opacity: 0.5;
    }
    .tool-toggle {
        display: flex;
        align-items: center;
        gap: 0.3rem;
        font-size: 0.85rem;
        color: #aaa;
        cursor: pointer;
    }
    .ask-button {
        padding: 0.4rem 1.2rem;
        background: #4caf50;
        color: #fff;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.9rem;
    }
    .ask-button:disabled {
        opacity: 0.4;
        cursor: default;
    }
    .ask-button:hover:not(:disabled) {
        background: #43a047;
    }
    .cost-display {
        text-align: right;
        font-size: 0.75rem;
        color: #666;
        margin-top: 0.25rem;
    }
</style>
