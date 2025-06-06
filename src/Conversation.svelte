<script lang="ts">
    import { onMount, tick } from "svelte";
    import { getModels } from "./lib/models";
    import { doStandardResearch, convertMessageToApiCallMessage } from "./lib/research";
    import { doDeepResearch } from "./lib/deep_research";
    import ConversationToolbar from "./ConversationToolbar.svelte";
    import { generateID, escapeHtml } from "./lib/util";
    import MarkdownIt from "markdown-it";
    import markdownItLinkAttributes from "markdown-it-link-attributes";
    import hljs from "highlight.js";
    import type {
        MessageData,
        GenerationData,
        Model,
        OpenRouterCredits,
        Attachment,
        ApiCallMessage,
        ApiCallMessageContent,
        ModelsForResearch,
    } from "./lib/types";
    import { Config, type ConversationData } from "./lib/types";
    import SearchToolbar from "./SearchToolbar.svelte";

    /***************/
    /* Propertiess */
    /***************/
    export let currentConversation: ConversationData;
    export let saveConversation: (conversation: ConversationData) => void;
    export let refreshAvailableCredits: () => Promise<void>;
    export let config: Config;
    export let availableCredits: OpenRouterCredits | undefined;

    /*******************/
    /* Local Variables */
    /*******************/
    let localConfig = createConfigCopy(config);
    let conversationDiv: HTMLDivElement;
    let userInput = "";
    let generating = false;
    let abortController: AbortController | null = null;
    let textarea: HTMLTextAreaElement;
    let models: Model[] = [];
    let showScrollToBottom = false;
    let selectionRect: { top: number; left: number; bottom: number } | null = null;
    let selectedText = "";
    let hoveredMessageId: string | null = null;
    let currentMessageContext: Attachment[] = []; // stores attached files
    let deepSearch = false; // controls deep search mode
    let deepSearchStrategy: 'auto' | 'deep' | 'broad' = 'auto'; // strategy for deep research

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

    /**************/
    /* Reactivity */
    /**************/
    $: localConfig = createConfigCopy(config);
    // Scroll to bottom when messages change
    $: if (currentConversation.messages.length) {
        scrollToBottom();
    }

    // Disable web search if no credits available
    $: if (availableCredits) {
        const remaining = availableCredits.total_credits - availableCredits.total_usage;
        if (remaining <= 0 && localConfig.allowWebSearch) {
            localConfig.allowWebSearch = false;
        }
    }

    /*************/
    /* Functions */
    /*************/
    function createConfigCopy(source: Config): Config {
        const newConfig = new Config();
        Object.assign(newConfig, source);
        return newConfig;
    }

    function setTitle(message: MessageData) {
        let title = message.content.trim();
        // Strip initial phrases
        title = title.replace(/^(what is|what are|how many|what kinds? of|are there|are there any)\s+/i, "");
        // Strip trailing phrases
        title = title.replace(/\s+(are there|in it|in them)$/i, "");
        // Split into words
        const words = title.split(/\s+/);
        let result = "";
        let currentLength = 0;
        for (const word of words) {
            const wordLength = word.length;
            // For first word: no space prefix
            // For subsequent words: add space (1 char) before word
            const addLength = currentLength === 0 ? wordLength : wordLength + 1;
            if (currentLength + addLength > 50) {
                break;
            }
            if (currentLength === 0) {
                result = word;
            } else {
                result += " " + word;
            }
            currentLength += addLength;
        }
        currentConversation.title = result;
    }

    function handleTextSelection() {
        const selection = window.getSelection();
        if (!selection || selection.toString().trim() === "") {
            selectionRect = null;
            return;
        }

        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const parentRect = conversationDiv.getBoundingClientRect();

        selectionRect = {
            top: rect.top - parentRect.top,
            left: rect.left - parentRect.left,
            bottom: rect.bottom - parentRect.top,
        };
        selectedText = selection.toString();
    }

    function doInternalSearch(text: string) {
        userInput = text;
        textarea.focus();
        clearSelection();
    }

    function clearSelection() {
        if (window.getSelection) {
            window.getSelection()?.removeAllRanges();
        }
        selectionRect = null;
    }

    function toggleMessageHidden(message: MessageData) {
        message.hidden = !message.hidden;
        currentConversation.messages = currentConversation.messages;
        saveConversation(currentConversation);
    }

    function editUserMessage(message: MessageData) {
        // Copy the message content to the input
        userInput = message.content;

        // Set this user message and the next assistant message to hidden
        message.hidden = true;

        // Find the next message (which should be an assistant message) and set it to hidden
        const index = currentConversation.messages.findIndex((m) => m.id === message.id);
        if (index >= 0 && index < currentConversation.messages.length - 1) {
            const nextMessage = currentConversation.messages[index + 1];
            if (nextMessage.role === "assistant") {
                nextMessage.hidden = true;
            }
        }

        // Update the conversation array to trigger reactivity
        currentConversation.messages = currentConversation.messages;

        // Save the conversation
        saveConversation(currentConversation);
    }

    function handleScroll() {
        if (!conversationDiv) return;
        const { scrollTop, scrollHeight, clientHeight } = conversationDiv;
        showScrollToBottom = scrollTop + clientHeight < scrollHeight - 10; // 10px tolerance
        clearSelection(); // Clear selection on scroll
    }

    getModels(localConfig).then((m) => {
        models = m;
    });

    function scrollToBottom() {
        conversationDiv.scrollTop = conversationDiv.scrollHeight;
        showScrollToBottom = false;
    }

    // Handle textarea key events
    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    }

    /**
     * Send a message to the assistant for a streaming response
     */
    async function sendMessage() {
        if (!userInput.trim() || generating) return;
        scrollToBottom();
        await tick();

        // Create user message with attachments
        const userMessage: MessageData = {
            id: generateID(),
            role: "user",
            content: userInput.trim(),
            timestamp: Date.now(),
            attachments: currentMessageContext.length > 0 ? [...currentMessageContext] : undefined,
        };

        // Add to conversation
        currentConversation.messages.push(userMessage);

        // Set title if first message in new conversation
        if (currentConversation.messages.length === 1 && currentConversation.title === "New Conversation") {
            setTitle(userMessage);
        }

        // Create assistant message placeholder
        const assistantMessage: MessageData = {
            id: generateID(),
            role: "assistant",
            content: "",
            timestamp: Date.now(),
            model: localConfig.defaultModel,
            modelName: models.find((m) => m.id === localConfig.defaultModel)?.name || "Unknown",
            totalCost: 0,
            isGenerating: true, // true for standard research, false for deep
            status: deepSearch ? '' : undefined,
        };
        currentConversation.messages.push(assistantMessage);
        currentConversation.messages = currentConversation.messages; // Trigger reactivity
        await tick(); // Ensure DOM updates before scrolling
        scrollToBottom();
        await tick();

        // Clear attachments after adding to message
        currentMessageContext = [];

        // Start generation
        generating = true;
        abortController = new AbortController();

        try {
            if (deepSearch) {
                console.log("Starting deep research...");
                // Convert the messages (without the assistant placeholder) to ApiCallMessage[]
                const apiCallMessages = currentConversation.messages.slice(0, -1).map((msg) => convertMessageToApiCallMessage(msg));
                const modelsForResearch: ModelsForResearch = {
                    reasoning: localConfig.defaultReasoningModel,
                    editor: localConfig.defaultModel,
                    researcher: localConfig.defaultModel,
                };
                const deepResult = await doDeepResearch(
                    localConfig.apiKey,
                    8192, // maxTokens
                    50, // maxWebRequests
                    modelsForResearch,
                    deepSearchStrategy, // strategy
                    apiCallMessages,
                    (status) => {
                        console.log(status);
                        const escapedStatus = escapeHtml(status);
                        const newStatusDiv = `<div class="status-message">${escapedStatus}</div>`;
                        assistantMessage.status = (assistantMessage.status || '') + newStatusDiv;
                        currentConversation.messages = currentConversation.messages.map((msg) =>
                            msg.id === assistantMessage.id ? assistantMessage : msg,
                        );
                    }, // statusCallback
                );
                assistantMessage.isGenerating = false;
                assistantMessage.content = deepResult.content;
                assistantMessage.totalCost = deepResult.total_cost;
                assistantMessage.status = undefined; // clear status when done
                assistantMessage.deepResearchResult = deepResult; // Store the full result
            } else {
                let firstChunk = true;
                const result = await doStandardResearch(
                    8192, // maxTokens
                    localConfig,
                    userMessage,
                    currentConversation.messages.slice(0, -2), // history (all messages except current user and assistant)
                    (chunk) => {
                        if (firstChunk) {
                            assistantMessage.isGenerating = false;
                            firstChunk = false;
                        }
                        assistantMessage.content += chunk;
                        currentConversation.messages = currentConversation.messages.map((msg) =>
                            msg.id === assistantMessage.id ? assistantMessage : msg,
                        );
                    },
                    (status) => {
                        console.log(status);
                    }, // updateStatus callback
                    abortController,
                );
                if (result.streamingResult.requestID) {
                    assistantMessage.requestID = result.streamingResult.requestID;
                }
                if (result.generationData) {
                    assistantMessage.generationData = result.generationData;
                    assistantMessage.totalCost = result.generationData.total_cost || 0;
                }
            }
            userInput = ""; // Clear input after sending
        } catch (error: any) {
            if (error.name !== "AbortError") {
                assistantMessage.content += "\n\n[Error: Generation failed]";
            }
        } finally {
            generating = false;
            abortController = null;
            assistantMessage.isGenerating = false;
            currentConversation.messages = currentConversation.messages.map((msg) => (msg.id === assistantMessage.id ? assistantMessage : msg));
            saveConversation(currentConversation);
            refreshAvailableCredits();
        }
    }

    function stopGeneration() {
        if (abortController) {
            abortController.abort();
        }
    }

    async function attachFile() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "text/plain,application/pdf";
        input.onchange = async (e) => {
            const file = input.files?.[0];
            if (file) {
                try {
                    if (file.type === "application/pdf") {
                        // Use FileReader to create base64-encoded data URL
                        const data_url = await new Promise<string>((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = () => {
                                const dataURL = reader.result as string;
                                resolve(dataURL); // Resolve with the full data URL
                            };
                            reader.onerror = reject;
                            reader.readAsDataURL(file);
                        });
                        currentMessageContext = [...currentMessageContext, { filename: file.name, content: data_url }];
                    } else {
                        // For text files, read as text
                        const text = await file.text();
                        currentMessageContext = [...currentMessageContext, { filename: file.name, content: text }];
                    }
                } catch (error) {
                    console.error("Error reading file:", error);
                }
            }
        };
        input.click();
    }

    function removeAttachment(index: number) {
        currentMessageContext = currentMessageContext.filter((_, i) => i !== index);
    }

    function copyMessageContent(message: MessageData) {
        navigator.clipboard.writeText(message.content);
    }

    // Placeholder cost calculation (implement based on your pricing model)
    function calculateCost(promptTokens: number, completionTokens: number, modelId: string): number {
        // Add actual pricing calculation logic here
        return 0;
    }

    function formatMessage(text: string): string {
        return md.render(text);
    }
</script>

<!---------------------------------------------------------------------------------------------------------------------------------------------------->

<div class="conversation">
    <input type="text" class="conversation-title" bind:value={currentConversation.title} on:blur={() => saveConversation(currentConversation)} />
    <!-- Toolbar goes here -->
    <ConversationToolbar bind:config={localConfig} bind:deepSearch bind:deepSearchStrategy />

    <!-- Conversation content will go here -->
    <div class="conversation-window">
        <div bind:this={conversationDiv} class="conversation-content" on:scroll={handleScroll} on:mouseup={handleTextSelection}>
            {#each currentConversation.messages as message (message.id)}
                <div
                    class="message-container {message.role}"
                    class:active={hoveredMessageId === message.id}
                    on:mouseover={() => (hoveredMessageId = message.id)}
                    on:mouseout={() => (hoveredMessageId = null)}
                    on:focus={() => (hoveredMessageId = message.id)}
                    on:blur={() => (hoveredMessageId = null)}
                >
                    {#if message.role === "user"}
                        <button class="edit-button" on:click={() => editUserMessage(message)}>✏️</button>
                    {/if}
                    <div class="message {message.role}">
                        <div class="message-header">
                            {#if message.role === "assistant"}
                                <div class="role">
                                    <div>
                                        {#if message.modelName}{message.modelName}{/if}
                                        <button
                                            class="copy-button"
                                            on:click={() => copyMessageContent(message)}
                                            title="Copy raw markdown to system clipboard">📋</button
                                        >
                                    </div>
                                    <button class="toggle-button hide-button" on:click={() => toggleMessageHidden(message)}>
                                        {message.hidden ? "Show" : "Hide"}
                                    </button>
                                </div>
                            {/if}
                        </div>
                        {#if !message.hidden}
                            <div class="content">
                                {#if message.role === "user"}
                                    {message.content}
                                    <div class="attachments">
                                        {#each message.attachments || [] as attachment, index}
                                            <div class="attachment">
                                                <span title={attachment.filename}
                                                    >{attachment?.filename?.slice(0, 30)}{attachment?.filename?.length > 30 ? "..." : ""}</span
                                                >
                                            </div>
                                        {/each}
                                    </div>
                                {:else}
                                    {#if message.isGenerating}
                                        {#if message.status}
                                            <div class="status">{@html message.status}</div>
                                        {/if}
                                        <div class="bouncing-dots">
                                            <span>●</span><span>●</span><span>●</span>
                                        </div>
                                    {:else}
                                        {@html formatMessage(message.content)}
                                    {/if}
                                {/if}
                            </div>
                        {/if}
                        {#if message.totalCost}
                            <div class="cost">Cost: ${message.totalCost.toFixed(2)}</div>
                        {/if}
                    </div>
                </div>
            {/each}
        </div>
        {#if showScrollToBottom}
            <button class="scroll-to-bottom" on:click={scrollToBottom}> ↓ </button>
        {/if}
        {#if selectionRect}
            <SearchToolbar position={selectionRect} {selectedText} onInternalSearch={doInternalSearch} searchEngine={localConfig.searchEngine} />
        {/if}
    </div>

    <!-- Total Cost goes here -->
    <div class="total-cost">
        Total Cost: ${currentConversation.messages.reduce((sum, msg) => sum + (msg.totalCost || 0), 0).toFixed(2)}
    </div>

    <!-- Chat Input goes here -->
    <div class="chat-input">
        <div class="attachments">
            {#each currentMessageContext as attachment, index}
                <div class="attachment">
                    <span title={attachment.filename}>{attachment.filename.slice(0, 30)}{attachment.filename.length > 30 ? "..." : ""}</span>
                    <button on:click={() => removeAttachment(index)}>X</button>
                </div>
            {/each}
        </div>
        <div class="input-row">
            <button on:click={attachFile} class="attach-button">📎</button>
            <textarea
                bind:this={textarea}
                bind:value={userInput}
                on:keydown={handleKeydown}
                rows="1"
                placeholder="Type your message..."
                disabled={generating}
            ></textarea>
            <button on:click={generating ? stopGeneration : sendMessage} class={generating ? "stop" : "send"}>
                {generating ? "Stop" : "Send"}
            </button>
        </div>
    </div>
</div>

<!------------------------------------------------------------------------------------------------------------------------------------------------->

<style>
    .conversation {
        height: 99%;
        padding: 1rem;
        display: flex;
        flex-direction: column;
    }

    .conversation-title {
        font-size: 1.5rem;
        font-weight: bold;
        margin: 0.1rem 0;
        width: 100%;
        border: none;
        border-bottom: 1px solid transparent;
        background: transparent;
        color: inherit;
        padding: 0;
    }

    .conversation-title:focus {
        outline: none;
        border-bottom: 1px solid #666;
    }

    .conversation-window {
        display: flex;
        flex-direction: column;
        flex-grow: 1;
        position: relative;
        height: 5rem;
    }
    .conversation-content {
        height: 100%;
        overflow-y: auto;
        flex: 1;
    }

    .scroll-to-bottom {
        position: absolute;
        bottom: 10px;
        right: 24px;
        opacity: 0.7;
        background: #383;
        color: white;
        border: none;
        border-radius: 40%;
        cursor: pointer;
        z-index: 100;
        padding: 8px 16px;
        font-size: 28px;
    }

    .scroll-to-bottom:hover {
        opacity: 1;
        background: #5a5;
    }

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

    .total-cost {
        padding: 0.5rem;
        text-align: right;
        font-weight: normal;
    }

    .chat-input {
        display: flex;
        flex-direction: column;
        margin-bottom: 1rem;
        flex-grow: 0;
    }

    .chat-input .attachments {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
    }

    .chat-input .attachment {
        display: flex;
        align-items: center;
        background: #444;
        padding: 0.25rem 0.5rem;
        border-radius: 10px;
        font-size: 0.8rem;
    }

    .chat-input .attachment button {
        margin-left: 0.5rem;
        padding: 0 0.25rem;
        background: #666;
        border: none;
        border-radius: 3px;
        cursor: pointer;
    }

    .chat-input .attachment button:hover {
        background: #888;
    }

    .chat-input .input-row {
        display: flex;
    }

    .chat-input .attach-button {
        margin-right: 0.5rem;
        padding: 0.5rem;
    }

    .chat-input textarea {
        flex: 1;
        padding: 0.5rem;
        resize: vertical;
        min-height: 50px;
    }

    .chat-input button.send,
    .chat-input button.stop {
        margin-left: 0.5rem;
        padding: 0.5rem 1rem;
    }

    .message .attachments {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
    }

    .message .attachment {
        display: flex;
        align-items: center;
        background: #444;
        padding: 0.25rem 0.5rem;
        border-radius: 10px;
        font-size: 0.8rem;
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

    .copy-button {
        padding: 0.25rem;
        color: #aaa;
        background: transparent;
        cursor: pointer;
        border: 1px solid transparent;
    }

    .copy-button:hover {
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



</style>
