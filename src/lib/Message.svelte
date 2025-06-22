<script lang="ts">
    import { formatModelName } from "./util";
    import { errorCodeToMeaning } from './models'
    import MarkdownIt from "markdown-it";
    import markdownItLinkAttributes from "markdown-it-link-attributes";
    import hljs from "highlight.js";
    
    import type {
        MessageData,
        GenerationData,
        Annotation,
        Resource,

        ResearchResult,

        OpenRouterErrorResponse


    } from "./types";
    import Resources from "./Resources.svelte";
    import MessageInfo from "./MessageInfo.svelte";

    export let message: MessageData;
    export let conversationTitle: string;
    export let onEdit: (message: MessageData) => void;
    export let onToggleHidden: (message: MessageData) => void;

    let selectedResearchResult = 0;
    let showResources = false;
    let showInfo = false;
    let currentResources: Resource[] = message.resources||[];
    let currentAnnotations: Annotation[] = message.annotations||[];
    let currentResearchResult: ResearchResult | undefined;
    let currentGenerationData: GenerationData | undefined;
    let currentRequestID: string | undefined;
    let openRouterError: OpenRouterErrorResponse | undefined = undefined;
    
    // Try to parse OpenRouter error response if present
    $: if (message?.error?.responseBody) {
        try {
            openRouterError = JSON.parse(message.error.responseBody) as OpenRouterErrorResponse;
        } catch (e) {
            // Ignore parse errors - responseBody may not be JSON
            openRouterError = undefined;
        }
    }
//console.log(message?.researchResults);
    // Update current variables when selected research result changes
    $: if (message.researchResults && message.researchResults.length > 0) {
        const result = message.researchResults[selectedResearchResult];
        currentAnnotations = result.annotations || [];
        currentResources = result.resources || [];
        currentResearchResult = result;
        currentGenerationData = result.generationData;
        currentRequestID = result.streamingResult.requestID;
    } else {
        currentAnnotations = message.annotations || [];
        currentResources = message.resources || [];
        currentGenerationData = message.generationData;
    }

    const md = new MarkdownIt({
        html: false,
        breaks: true,
        linkify: true,
        highlight: function (str: string, lang: string): string {
            if (lang && hljs.getLanguage(lang)) {
                try {
                    return '<pre class="hljs"><code>' + hljs.highlight(str, { language: lang, ignoreIllegals: true }).value + "</code></pre>";
                } catch (__) {}
            }
            return '<pre class="hljs"><code>' + md.utils.escapeHtml(str) + "</code></pre>";
        },
    });
    md.use(markdownItLinkAttributes, {
        attrs: {
            target: "_blank",
            rel: "noopener",
        },
    });

    function filterContent(content: string): string {
        const resourcesStart = content.indexOf('<RESOURCES>');
        if (resourcesStart === -1) {
            return content;
        }
        const resourcesEnd = content.indexOf('</RESOURCES>', resourcesStart);
        if (resourcesEnd === -1) {
            return content.substring(0, resourcesStart).trim();
        }
        return (content.substring(0, resourcesStart) + content.substring(resourcesEnd + 12)).trim();
    }

    function formatMessage(text: string|null|undefined): string {
        if(!text) return '';
        return md.render(text);
    }

    function copyMessageContent() {
        navigator.clipboard.writeText(message.content);
    }

    function saveMessageToFile() {
        saveToFile(conversationTitle, message.content);
    }

    function saveToFile(defaultFilename: string, content: string) {
        const safeTitle = defaultFilename.replace(/[^a-z0-9]+/gi, '_');
        const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
        const filename = `${safeTitle}_${timestamp}.json`;

        const blob = new Blob([content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();

        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 0);
    }

    function format_research_option(result: ResearchResult, allResults: ResearchResult[]): string {
        // Check if there are variations in prompts and models
        const hasPromptVariations = allResults.some(r => 
            r.systemPromptName !== allResults[0].systemPromptName
        );
        const hasModelVariations = allResults.some(r => 
            r.modelName !== allResults[0].modelName
        );

        // If both vary, show prompt name and model name
        if (hasPromptVariations && hasModelVariations) {
            return `${result.systemPromptName || 'Unknown'} / ${result.modelName || result.modelId || 'Unknown'}`;
        }
        // If only prompts vary, show prompt name
        if (hasPromptVariations) {
            return result.systemPromptName || `Result ${allResults.indexOf(result) + 1}`;
        }
        // If only models vary, show model name
        if (hasModelVariations) {
            return result.modelName || result.modelId || `Result ${allResults.indexOf(result) + 1}`;
        }
        // Default to just numbering if nothing varies
        return `Result ${allResults.indexOf(result) + 1}`;
    }


</script>

<div class="message-container {message.role}">
    {#if message.role === "user"}
        <button class="edit-button" on:click={() => onEdit(message)}>✏️</button>
    {/if}
    <div class="message {message.role}">
        <!-- Toolbar -->
        <div class="message-header">
            {#if message.role === "assistant"}
                <div class="role">
                    <div class="role-name">
                        {#if message.modelName}{formatModelName(message.modelName)}{/if}
                        <button
                            class="copy-button"
                            on:click={copyMessageContent}
                            title="Copy raw markdown to system clipboard">📋</button>
                        <button
                            class="save-button"
                            on:click={saveMessageToFile}
                            title="Save raw markdown to file">💾</button>
                        {#if message.annotations && message.annotations.length > 0}
                            <button
                                class="resources-button"
                                on:click={() => showResources = true}
                                title="View web resources used to generate this message (links).">🌐</button>
                        {/if}
                        <button
                            class="info-button"
                            on:click={() => showInfo = true}
                            title="View information about the generation of this message">ℹ️</button>
                    </div>
                    <button class="toggle-button hide-button" on:click={() => onToggleHidden(message)}>
                        {message.hidden ? "Show" : "Hide"}
                    </button>
                </div>
            {/if}
        </div>
        <!-- Message Body -->
        {#if !message.hidden}
            <div class="content">
                {#if message.role === "user"}
                    <!-- User Message -->
                    {message.content}
                    <div class="attachments">
                        {#each message.attachments || [] as attachment, index}
                            <div class="attachment">
                                <span title={attachment.filename}>
                                    {attachment?.filename?.slice(0, 30)}{attachment?.filename?.length > 30 ? "..." : ""}
                                </span>
                            </div>
                        {/each}
                    </div>
                {:else} 
                    <!-- Assistant Message -->
                    {#if message.isGenerating}
                        {#if message.status}
                            <div class="status">{@html message.status}</div>
                        {/if}
                        <div class="bouncing-dots">
                            <span>●</span><span>●</span><span>●</span>
                        </div>
                    {:else}
                        {#if message.researchResults && message.researchResults.length > 0}
                            <select class="research-selector" bind:value={selectedResearchResult}>
                                {#each message.researchResults as result, index}
                                    <option value={index}>
                                        {format_research_option(result, message.researchResults)}
                                    </option>
                                {/each}
                            </select>
                            {@html formatMessage(message.researchResults[selectedResearchResult].chatResult?.content)}
                        {:else}
                            {@html formatMessage(filterContent(message.content))}
                        {/if}
                    {/if}
                {/if}
            </div>
        {/if}
        {#if message.error}
            <div class="error-container">
                <div class="error-message">
                    <strong>Error:</strong> {message.error.message}
                    {#if message.error.url}
                        <div><strong>URL:</strong> {message.error.url}</div>
                    {/if}
                    {#if message.error.method}
                        <div><strong>Method:</strong> {message.error.method}</div>
                    {/if}
                    {#if message.error.statusCode}
                        <div><strong>Status:</strong> {message.error.statusCode}</div>
                    {/if}
                    {#if openRouterError}
                        <div><strong>Error Code:</strong> {openRouterError.error.code} ({errorCodeToMeaning(parseInt(openRouterError.error.code))})</div>
                        <div><strong>Error Message:</strong> {openRouterError.error.message}</div>
                        {#if openRouterError.error.message.indexOf('matching your data policy') !== -1}
                            <div><strong>Suggestion:</strong> This can be caused by having set your data policy to not permit your data to be used for training and also selecting a free provider (or a model where all the providers are free)—all free providers pay for the LLM execution by using input data as training data. If you wish to use free providers, you'll need to enable prompt training. If you prefer your privacy, you'll need to select non-free providers.</div>
                        {/if}
                    {/if}
                    <div class="error-actions">
                        {#if message.error.requestBody}
                            <button on:click={() => saveToFile('request.txt', message.error!.requestBody)}>Save Request</button>
                            <button on:click={() => navigator.clipboard.writeText(message.error!.requestBody)}>Copy Request</button>
                        {/if}
                        {#if message.error.responseBody}
                            <button on:click={() => saveToFile('response.txt', message.error!.responseBody)}>Save Response</button>
                            <button on:click={() => navigator.clipboard.writeText(message.error!.responseBody)}>Copy Response</button>
                        {/if}
                        {#if message.config}
                            <button on:click={() => saveToFile('config.json', JSON.stringify(message.config, null, 2))}>Save Config</button>
                            <button on:click={() => navigator.clipboard.writeText(JSON.stringify(message.config, null, 2))}>Copy Config</button>
                        {/if}
                    </div>
                </div>
            </div>
        {/if}
        {#if message.totalCost}
            <div class="cost">Cost: ${message.totalCost.toFixed(2)}</div>
        {/if}
    </div>
</div>

{#if showResources}
    <Resources 
        resources={currentResources} 
        annotations={currentAnnotations}
        onClose={() => showResources = false} 
    />
{/if}

{#if showInfo}
    <MessageInfo
        researchResult={currentResearchResult}
        deepResearchResult={message.deepResearchResult}
        onClose={() => showInfo = false}
    />
{/if}

<style>
    .message-container {
        position: relative;
        display: flex;
        flex-direction: row;
    }

    .message-container.user {
        justify-content: flex-end;
    }

    .message {
        margin-bottom: 1rem;
        padding: 0.5rem;
        border-radius: 20px;
        width: 80%;
        padding-left: 0.75rem;
    }

    .message.user {
        background-color: #30778a;
        padding-left: 1rem;
        border: 1px solid #40889a;
    }

    .message.assistant {
        background-color: #303028;
        border: 1px solid #554;
    }

    .role {
        font-weight: bold;
        margin-bottom: 0.25rem;
        display: flex;
        justify-content: space-between;
    }

    .cost {
        font-size: 0.8rem;
        color: #999;
        text-align: right;
        flex-grow: 0;
    }

    .hide-button {
        padding: 0.25rem;
        color: #aaa;
    }

    .edit-button {
        visibility: hidden;
        color: #aaa;
        background: transparent;
        cursor: pointer;
        padding: 0;
        margin: 0 0.25rem;
        font-size: 1.2rem;
        border: none;
    }
    div.active .edit-button {
        visibility: visible;
        background: transparent;
    }
    .edit-button:hover {
        background: rgba(0, 0, 0, 0.3);
    }

    .research-selector {
        background: #444;
        color: #fff;
        border: 1px solid #666;
        border-radius: 4px;
        padding: 0.25rem;
        margin-bottom: 0.5rem;
        width: 100%;
    }

    .copy-button, .save-button, .resources-button, .info-button, .resources-dialog {
        padding: 0.25rem;
        color: #aaa;
        background: transparent;
        cursor: pointer;
        border: 1px solid transparent;
        margin-left: 0.25rem;
    }

    .copy-button:hover, .save-button:hover, .resources-button:hover, .info-button:hover {
        background: rgba(0, 0, 0, 0.3);
        border: 1px solid #ddd;
    }

    .bouncing-dots {
        display: inline-flex;
        align-items: center;
        height: 1em;
    }

    .bouncing-dots span {
        animation: bounce 1.5s infinite ease-in-out both;
        display: inline-block;
        margin: 0 1px;
    }

    .bouncing-dots span:nth-child(1) {
        animation-delay: -0.32s;
    }

    .bouncing-dots span:nth-child(2) {
        animation-delay: -0.16s;
    }

    @keyframes bounce {
        0%, 80%, 100% {
            transform: translateY(0);
        }
        40% {
            transform: translateY(-5px);
        }
    }

    .status {
        font-size: 0.9em;
        color: #aaa;
        margin-top: 0.5rem;
    }

    .attachments {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
    }

    .attachment {
        display: flex;
        align-items: center;
        background: #444;
        padding: 0.25rem 0.5rem;
        border-radius: 10px;
        font-size: 0.8rem;
    }

    .error-container {
        margin-top: 0.5rem;
        padding: 0.5rem;
        background-color: #4a1e1e;
        border-radius: 6px;
    }

    .error-message {
        font-size: 0.85rem;
        color: #ff8383;
    }

    .error-actions {
        margin-top: 0.5rem;
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
    }

    .error-actions button {
        padding: 0.25rem 0.5rem;
        font-size: 0.75rem;
        background-color: #2a2a2a;
        border: 1px solid #666;
        border-radius: 4px;
        color: #ddd;
        cursor: pointer;
    }

    .error-actions button:hover {
        background-color: #3a3a3a;
    }
</style>


