<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { callOpenRouterStreaming, fetchGenerationData, getModels } from './lib/models';
  import ConversationToolbar from './ConversationToolbar.svelte';
  import { generateID } from './lib/util';
  import MarkdownIt from 'markdown-it';
  import markdownItLinkAttributes from 'markdown-it-link-attributes';
  import hljs from 'highlight.js';
  import type { MessageData, GenerationData, Model, OpenRouterCredits } from './lib/types';
  import { Config, type ConversationData } from './lib/types';
  import SearchToolbar from './SearchToolbar.svelte';

  /***************/
  /* Propertiess */
  /***************/
  export let currentConversation : ConversationData;
  export let saveConversation: (conversation: ConversationData) => void;
  export let refreshAvailableCredits: () => Promise<void>;
  export let config: Config;
  export let availableCredits: OpenRouterCredits | undefined;



  /*******************/
  /* Local Variables */
  /*******************/
  let localConfig = createConfigCopy(config);
  let conversationDiv: HTMLDivElement;
  let userInput = '';
  let generating = false;
  let abortController: AbortController | null = null;
  let textarea: HTMLTextAreaElement;
  let models : Model[] = [];
  let showScrollToBottom = false;
  let selectionRect: { top: number, left: number, bottom: number } | null = null;
  let selectedText = '';
  let hoveredMessageId: string | null = null;
  let currentMessageContext: string[] = []; // stores attached file contents

  const md = new MarkdownIt({
    html: false,
    breaks: true,
    linkify: true,
    highlight: function (str : string, lang : string) : string {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return '<pre class="hljs"><code>' +
                 hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
                 '</code></pre>';
        } catch (__) {}
      }
      return '<pre class="hljs"><code>' + md.utils.escapeHtml(str) + '</code></pre>';
    }
  });
  md.use(markdownItLinkAttributes, {
    attrs: {
      target: '_blank',
      rel: 'noopener'
    }
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

  function handleTextSelection() {
    const selection = window.getSelection();
    if (!selection || selection.toString().trim() === '') {
      selectionRect = null;
      return;
    }
    
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const parentRect = conversationDiv.getBoundingClientRect();
    
    selectionRect = {
      top: rect.top - parentRect.top + conversationDiv.scrollTop,
      left: rect.left - parentRect.left,
      bottom: rect.bottom - parentRect.top + conversationDiv.scrollTop
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
    const index = currentConversation.messages.findIndex(m => m.id === message.id);
    if (index >= 0 && index < currentConversation.messages.length - 1) {
      const nextMessage = currentConversation.messages[index+1];
      if (nextMessage.role === 'assistant') {
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

  getModels(localConfig).then(m => {
    models = m;
  });

  function scrollToBottom() {
    conversationDiv.scrollTop = conversationDiv.scrollHeight;
    showScrollToBottom = false;
  }

  // Handle textarea key events
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
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
  
    // Create user message with attachments
    const userMessage: MessageData = {
      id: generateID(),
      role: 'user',
      content: userInput.trim(),
      timestamp: Date.now(),
      attachments: currentMessageContext.length > 0 ? [...currentMessageContext] : undefined,
    };
    
    // Add to conversation
    currentConversation.messages.push(userMessage);
    
    // Create assistant message placeholder
    const assistantMessage: MessageData = {
      id: generateID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      model: localConfig.defaultModel,
      modelName: models.find(m => m.id === localConfig.defaultModel)?.name || 'Unknown',
      totalCost: 0,
    };
    currentConversation.messages.push(assistantMessage);
    currentConversation.messages = currentConversation.messages; // Trigger reactivity
    await tick();

    // Clear attachments after adding to message
    currentMessageContext = [];


    // Start generation
    generating = true;
    abortController = new AbortController();
    
    try {
      // Prepare messages for API
      const messagesForAPI = localConfig.includePreviousMessagesAsContext
        ? currentConversation.messages.slice(0, -1)
            .filter(m => !m.hidden)
            .map(m => ({ role: m.role, content: m.content }))
        : [userMessage];
      
      if (localConfig.systemPrompt) {
        messagesForAPI.unshift({ role: 'user', content: localConfig.systemPrompt });
      }
      
      // Prepare messages including attachments
      const messagesWithAttachments = [...messagesForAPI];
      if (userMessage.attachments) {
        for (const attachment of userMessage.attachments) {
          messagesWithAttachments.push({ role: 'user', content: attachment });
        }
      }
      messagesWithAttachments.push({ role: 'user', content: userMessage.content });

      /* Call streaming API */
      const result = await callOpenRouterStreaming(
        localConfig.apiKey,
        localConfig.defaultModel,
        8192, // maxTokens
        localConfig.allowWebSearch ? localConfig.webSearchMaxResults : 0,
        messagesWithAttachments,
        (chunk) => {
          assistantMessage.content += chunk;
          currentConversation.messages = currentConversation.messages.map(msg => 
            msg.id === assistantMessage.id ? assistantMessage : msg
          );
        },
        abortController
      );
      userInput = ''; // Clear input after sending
      
      /* Fetch generation data */
      if (result.requestID) {
        assistantMessage.requestID = result.requestID;
        const generationData = await fetchGenerationData(localConfig.apiKey, result.requestID);
        if (generationData) {
          assistantMessage.generationData = generationData;
          assistantMessage.totalCost = generationData?.total_cost || 0;
        }
      }
    } catch (error : any) {
      if (error.name !== 'AbortError') {
        assistantMessage.content += '\n\n[Error: Generation failed]';
      }
    } finally {
      generating = false;
      abortController = null;
      currentConversation.messages = currentConversation.messages.map(msg => 
        msg.id === assistantMessage.id ? assistantMessage : msg
      );
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
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'text/plain';
    input.onchange = async (e) => {
      const file = input.files?.[0];
      if (file) {
        try {
          const text = await file.text();
          currentMessageContext = [...currentMessageContext, text];
        } catch (error) {
          console.error('Error reading file:', error);
        }
      }
    };
    input.click();
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
  <ConversationToolbar bind:config={localConfig} />
  

  <!-- Conversation content will go here -->
  <div class="conversation-window">
    <div bind:this={conversationDiv} class="conversation-content" on:scroll={handleScroll} on:mouseup={handleTextSelection}>
      {#each currentConversation.messages as message (message.id)}
        <div class="message-container {message.role}" class:active={hoveredMessageId === message.id} 
          on:mouseover={() => hoveredMessageId = message.id} on:mouseout={() => hoveredMessageId = null}
          on:focus={() => hoveredMessageId = message.id} on:blur={() => hoveredMessageId = null}>
          {#if message.role === 'user'}
            <button class="edit-button" on:click={() => editUserMessage(message)}>✏️</button>
          {/if}
        <div class="message {message.role}" >
          <div class="message-header">
            {#if message.role === 'assistant'}
            <div class="role">{#if message.modelName}{message.modelName}{/if}
              <button class="toggle-button hide-button" on:click={() => toggleMessageHidden(message)}>
                {message.hidden ? 'Show' : 'Hide'}
              </button>
              </div>
            {/if}
          </div>
          {#if !message.hidden}
            <div class="content">
              {#if message.role === 'user'}
                {message.content}
              {:else}
                {@html formatMessage(message.content)}
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
        <button class="scroll-to-bottom" on:click={scrollToBottom}>
          ↓
        </button>
      {/if}
      {#if selectionRect}
        <SearchToolbar 
          position={selectionRect} 
          selectedText={selectedText} 
          onInternalSearch={doInternalSearch} 
          searchEngine={localConfig.searchEngine} 
        />
      {/if}
  </div>

  <!-- Total Cost goes here -->
  <div class="total-cost">
    Total Cost: ${currentConversation.messages.reduce((sum, msg) => sum + (msg.totalCost || 0), 0).toFixed(2)}
  </div>

  <!-- Chat Input goes here -->
  <div class="chat-input">
    <button on:click={attachFile} class="attach-button">📎</button>
    <textarea
      bind:this={textarea}
      bind:value={userInput}
      on:keydown={handleKeydown}
      rows="1"
      placeholder="Type your message..."
      disabled={generating}
    ></textarea>
    <button 
      on:click={generating ? stopGeneration : sendMessage}
      class={generating ? 'stop' : 'send'}
    >
      {generating ? 'Stop' : 'Send'}
    </button>
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
    margin: .1rem 0;
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
    padding-left: .75rem;
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
    margin-bottom: 1rem;
    flex-grow: 0;
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
  
  .chat-input button {
    margin-left: 0.5rem;
    padding: 0.5rem 1rem;
  }

  .hide-button {
    padding: .25rem;
    color: #aaa;
  }

  .edit-button {
    visibility: hidden;
    color: #aaa;
    background: transparent;
    cursor: pointer;
    padding: 0;
    margin: 0 .25rem;
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
</style>
