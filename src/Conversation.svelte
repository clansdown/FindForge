<script lang="ts">
    import { onMount, tick } from "svelte";
    import { getModels } from "./lib/models";
    import { doStandardResearch, convertMessageToApiCallMessage, doParallelResearch } from "./lib/research";
    import { doDeepResearch } from "./lib/deep_research";
    import ConversationToolbar from "./ConversationToolbar.svelte";
    import { generateID, escapeHtml, formatModelName, extractConversationReferences, isBraveOrChromium } from "./lib/util";
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
        DeepResearchResult,
        StreamingResult,
        Annotation,
        ExperimentationOptions,
        SystemPrompt,

        Resource

    } from "./lib/types";
    import { APIError, Config, type ConversationData } from "./lib/types";
    import SearchToolbar from "./SearchToolbar.svelte";
    import Resources from "./lib/Resources.svelte";
    import MessageInfo from "./lib/MessageInfo.svelte";
    import GettingStarted from "./GettingStarted.svelte";
    import Message from "./lib/Message.svelte";

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
    let supportsWebSpeechTranscription : boolean;
    let speechTimeoutMS = 5000; // milliseconds of silence before auto-send
    let speechSendCommand = "Computer: send message"; // voice command to send
    let isListening = false;
    let speechRecognition: SpeechRecognition | null = null;
    let speechTimeout: number | null = null;
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
    let showResourcesFor: string | null = null; // message ID for which to show resources
    let showInfoFor: string | null = null; // message ID for which to show info
    let currentConversationID = currentConversation.id;
    let lastMessageCount = currentConversation.messages.length;
    let experimentationOptions: ExperimentationOptions = {
        parallelResearch: false, // Enable parallel research mode
        standardResearchPrompts: [],
        standardResearchModels : []
    };
    
    let allConversationResources: Resource[] = [];
    let allConversationAnnotations: Annotation[] = [];
    let showAllResources = false;

    isBraveOrChromium().then(result => { console.log(result); supportsWebSpeechTranscription = !result});
    
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
    // Handle conversation changes
    $: {
        if (currentConversationID !== currentConversation.id) {
            currentConversationID = currentConversation.id;
            if (conversationDiv) {
                conversationDiv.scrollTop = 0;
            }
            // Update last message count to the current conversation's message length
            lastMessageCount = currentConversation.messages.length;
        }
    }
    // Scroll to bottom when new messages are added
    $: {
        const messageCount = currentConversation.messages.length;
        if (messageCount !== lastMessageCount && messageCount > lastMessageCount) {
            // Only scroll if the new message count is greater (meaning new messages were added)
            scrollToBottom();
        }
        // Always update the lastMessageCount
        lastMessageCount = messageCount;
    }

    // Disable web search if no credits available
    $: if (availableCredits) {
        const remaining = availableCredits.total_credits - availableCredits.total_usage;
        if (remaining <= 0 && localConfig.allowWebSearch) {
            localConfig.allowWebSearch = false;
        }
    }

    $: { // Get all resources from conversation
        const refs = extractConversationReferences(currentConversation);
        allConversationResources = refs.resources;
        allConversationAnnotations = refs.annotations;
    }


    /*************/
    /* Functions */
    /*************/
    function startSpeechRecognition() {
        if (isListening) return;
        
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert("Speech recognition not supported in your browser");
            return;
        }

        speechRecognition = new SpeechRecognition();
        speechRecognition.continuous = true;
        speechRecognition.interimResults = true;

        speechRecognition.onstart = () => {
            isListening = true;
            userInput = "(Listening...) ";
        };

        speechRecognition.onresult = (event) => {
            const transcript = Array.from(event.results)
                .map(result => result[0])
                .map(result => result.transcript)
                .join('');

            userInput = transcript;
            
            // Check for send command
            const normalizedInput = transcript.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '');
            const normalizedCommand = speechSendCommand.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '');
            
            if (normalizedInput.includes(normalizedCommand)) {
                console.log("Send command detected, sending message...");
                sendMessage();
                return;
            }

            // Reset timeout on speech activity
            if (speechTimeout) clearTimeout(speechTimeout);
            speechTimeout = setTimeout(() => {
                if (isListening && userInput.trim() !== "(Listening...)") {
                    console.log("Silence timeout reached, sending message...");
                    sendMessage();
                }
            }, speechTimeoutMS);
        };

        speechRecognition.onerror = (event) => {
            console.error("Speech recognition error: ", event);
            stopSpeechRecognition();
        };

        speechRecognition.onend = stopSpeechRecognition;
        speechRecognition.start();
    }

    function stopSpeechRecognition() {
        if (speechRecognition) speechRecognition.stop();
        if (speechTimeout) clearTimeout(speechTimeout);
        isListening = false;
        speechRecognition = null;
        speechTimeout = null;
        
        // Remove listening prefix if present
        if (userInput.startsWith("(Listening...) ")) {
            userInput = userInput.substring("(Listening...) ".length);
        }
    }

    function toggleSpeechRecognition() {
        isListening ? stopSpeechRecognition() : startSpeechRecognition();
    }
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
        if(localConfig.autoSave)
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
        if(localConfig.autoSave)
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
        if (conversationDiv) {
            conversationDiv.scrollTop = conversationDiv.scrollHeight;
            showScrollToBottom = false;
        }
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

        // Validate parallel research configuration
        if (experimentationOptions.parallelResearch) {
            if (experimentationOptions.standardResearchPrompts.length === 0) {
                alert("Error: No research prompts selected for parallel research. Please select at least one prompt in the experimentation options.");
                return;
            }
            if (experimentationOptions.standardResearchModels.length === 0) {
                alert("Error: No research models selected for parallel research. Please select at least one model in the experimentation options.");
                return;
            }
        }

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
        const configCopy = createConfigCopy(localConfig);
        configCopy.apiKey = ''; // Remove API key from stored config
        
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
            config: configCopy,
        };
        currentConversation.messages.push(assistantMessage);
        currentConversation.messages = currentConversation.messages; // Trigger reactivity
        await tick(); // Ensure DOM updates
        scrollToBottom();
        
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
                    localConfig,
                    localConfig.apiKey,
                    8192, // maxTokens
                    modelsForResearch,
                    deepSearchStrategy, // strategy
                    userInput.trim(),
                    apiCallMessages.slice(0, -1), // exclude the current user message
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
                assistantMessage.resources = deepResult.resources; // Store resources separately for UI
                if (deepResult.annotations) {
                    assistantMessage.annotations = deepResult.annotations;
                }
            } else if (experimentationOptions.parallelResearch) {
                // Convert the messages (without the assistant placeholder) to ApiCallMessage[]
                const apiCallMessages = currentConversation.messages.slice(0, -1).map((msg) => convertMessageToApiCallMessage(msg));
                const results = await doParallelResearch(
                    8192, // maxTokens
                    localConfig,
                    convertMessageToApiCallMessage(userMessage), // user message
                    currentConversation.messages.slice(0, -2), // history
                    experimentationOptions.standardResearchPrompts,
                    experimentationOptions.standardResearchModels,
                    abortController
                );
                
                if (results.length > 0) {
                    const result = results[0];
                    assistantMessage.isGenerating = false;
                    assistantMessage.content = result.chatResult?.content || '';
                    assistantMessage.researchResults = results;
                    if (result.generationData) {
                        assistantMessage.generationData = result.generationData;
                        assistantMessage.totalCost = result.generationData.total_cost || 0;
                    }
                    if (result.annotations) {
                        assistantMessage.annotations = result.annotations;
                    }
                }
            } else {
                let firstChunk = true;
                const result = await doStandardResearch(
                    16384, // maxTokens
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
                        tick();
                        scrollToBottom();
                    },
                    (status) => {
                        console.log(status);
                    }, // updateStatus callback
                    abortController,
                );
                assistantMessage.researchResult = result;
                if (result.streamingResult.requestID) {
                    assistantMessage.requestID = result.streamingResult.requestID;
                }
                if (result.generationData) {
                    assistantMessage.generationData = result.generationData;
                    assistantMessage.totalCost = result.generationData.total_cost || 0;
                }
                if (result.annotations) {
                    assistantMessage.annotations = result.annotations;
                }
                if(result.resources) {
                    assistantMessage.resources = result.resources;
                }
                currentConversation.messages = currentConversation.messages; // trigger reactivity
                await tick(); // Ensure DOM updates
            }
            userInput = ""; // Clear input after sending
        } catch (error: any) {
            console.error("Generation error:", error);
            if (error.name !== "AbortError") {
                if (error instanceof APIError) {
                    assistantMessage.error = {
                        message: error.message,
                        url: error.url,
                        method: error.method,
                        statusCode: error.statusCode,
                        requestBody: error.requestBody,
                        responseBody: error.responseBody
                    };
                    assistantMessage.content += "\n\n[API Error occurred. Check error details for more information.]";
                } else {
                    assistantMessage.error = {
                        message: error.message || "Unknown error"
                    };
                    assistantMessage.content += "\n\n[Generation failed. Error: " + (error.message || "Unknown error") + "]";
                }
            }
        } finally {
            generating = false;
            abortController = null;
            assistantMessage.isGenerating = false;
            currentConversation.messages = currentConversation.messages.map((msg) => (msg.id === assistantMessage.id ? assistantMessage : msg));
            if(localConfig.autoSave)
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

    function saveMessageToFile(message: MessageData, conversationTitle: string) {
        // Create filename: conversation title with underscores + timestamp
        const safeTitle = conversationTitle.replace(/[^a-z0-9]+/gi, '_');
        const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
        const filename = `${safeTitle}_${timestamp}.md`;

        // Create Blob and trigger download
        const blob = new Blob([message.content], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();

        // Clean up
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 0);
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
    <div class="conversation-header">
        <input type="text" class="conversation-title" bind:value={currentConversation.title} on:blur={() => saveConversation(currentConversation)} />
        {#if allConversationResources.length > 0 || allConversationAnnotations.length > 0}
            <button class="resources-button" on:click={() => showAllResources = true} title="View all web resources used in this conversation">🌐</button>
        {/if}
    </div>
    <!-- Toolbar goes here -->
    <ConversationToolbar bind:config={localConfig} bind:deepSearch bind:deepSearchStrategy bind:experimentationOptions />

    <!-- Conversation content will go here -->
    <div class="conversation-window">
        <div bind:this={conversationDiv} class="conversation-content" on:scroll={handleScroll} on:mouseup={handleTextSelection}>
            {#each currentConversation.messages as message (message.id)}
                <Message
                    message={message}
                    conversationTitle={currentConversation.title}
                    onEdit={editUserMessage}
                    onToggleHidden={toggleMessageHidden}
                />
                
            {:else}
                <center>(Type your message below and hit send to get started.)</center>
                <GettingStarted />
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
            {#if supportsWebSpeechTranscription}
                <button on:click={toggleSpeechRecognition} class={isListening ? 'mic-button active' : 'mic-button'} title="Speech Input">
                    {isListening ? '🎤' : '🎤'}
                </button>
            {:else}
                <button class="mic-button disabled" title="Speech input is not supported in this browser" disabled>
                    🎤
                </button>
            {/if}
            <button on:click={generating ? stopGeneration : sendMessage} class={generating ? "stop" : "send"}>
                {generating ? "Stop" : "Send"}
            </button>
        </div>
    </div>
</div>

{#if showResourcesFor}
    <Resources 
        resources={currentConversation.messages.find(m => m.id === showResourcesFor)?.resources || []} 
        annotations={currentConversation.messages.find(m => m.id === showResourcesFor)?.annotations || []}
        onClose={() => showResourcesFor = null} 
    />
{/if}

{#if showInfoFor}
    <MessageInfo 
        researchResult={currentConversation.messages.find(m => m.id === showInfoFor)?.researchResult}
        deepResearchResult={currentConversation.messages.find(m => m.id === showInfoFor)?.deepResearchResult}
        onClose={() => showInfoFor = null} 
    />
{/if}

{#if showAllResources}
    <Resources 
        resources={allConversationResources} 
        annotations={allConversationAnnotations}
        onClose={() => showAllResources = false}
    />
{/if}

<!------------------------------------------------------------------------------------------------------------------------------------------------->

<style>
    .conversation {
        height: 99%;
        padding: 1rem;
        display: flex;
        flex-direction: column;
    }

    .conversation-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }
    
    .conversation-title {
        font-size: 1.5rem;
        font-weight: bold;
        margin: 0.1rem 0;
        flex-grow: 1;
        border: none;
        border-bottom: 1px solid transparent;
        background: transparent;
        color: inherit;
        padding: 0;
    }
    
    .resources-button {
        background: none;
        font-size: 1.5rem;
        cursor: pointer;
        opacity: 0.7;
        padding: 0.25rem;
    }
    
    .resources-button:hover {
        opacity: 1;
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

    .chat-input .mic-button {
        margin-right: 0.5rem;
        padding: 0.5rem;
        background: none;
        border: none;
        cursor: pointer;
        font-size: 1.2rem;
    }
    .chat-input .mic-button.disabled {
        opacity: 0.3;
        cursor: not-allowed;
    }

    .chat-input .mic-button.active {
        color: #f00;
        animation: pulse 1.5s infinite;
    }

    @keyframes pulse {
        0% { opacity: 1; }
        50% { opacity: 0.5; }
        100% { opacity: 1; }
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




</style>
