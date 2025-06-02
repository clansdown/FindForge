<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { callOpenRouterStreaming, fetchGenerationData, getModels } from './lib/models';
  import { escapeHtml, generateID } from './lib/util';
  import type { MessageData, GenerationData, Model } from './lib/types';
  import type { Config, ConversationData } from './lib/types';
  import SearchToolbar from './SearchToolbar.svelte';

  export let config: Config;
  export let currentConversation : ConversationData;
  export let saveConversation: (conversation: ConversationData) => void;
  export let refreshAvailableCredits: () => Promise<void>;

  let conversationDiv: HTMLDivElement;
  let userInput = '';
  let generating = false;
  let abortController: AbortController | null = null;
  let textarea: HTMLTextAreaElement;
  let models : Model[] = [];
  let showScrollToBottom = false;
  let selectionRect: { top: number, left: number, bottom: number } | null = null;
  let selectedText = '';

  // Scroll to bottom when messages change
  $: if (currentConversation.messages.length) {
    scrollToBottom();
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
  

  function handleScroll() {
    if (!conversationDiv) return;
    const { scrollTop, scrollHeight, clientHeight } = conversationDiv;
    showScrollToBottom = scrollTop + clientHeight < scrollHeight - 10; // 10px tolerance
    clearSelection(); // Clear selection on scroll
  }

  getModels(config).then(m => {
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
  
    // Create user message
    const userMessage: MessageData = {
      id: generateID(),
      role: 'user',
      content: userInput.trim(),
      timestamp: Date.now(),
    };
    
    // Add to conversation
    currentConversation.messages.push(userMessage);
    
    // Create assistant message placeholder
    const assistantMessage: MessageData = {
      id: generateID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      model: config.defaultModel,
      modelName: models.find(m => m.id === config.defaultModel)?.name || 'Unknown',
      totalCost: 0,
    };
    currentConversation.messages.push(assistantMessage);
    currentConversation.messages = currentConversation.messages; // Trigger reactivity
    await tick();


    // Start generation
    generating = true;
    abortController = new AbortController();
    
    try {
      // Prepare messages for API
      const messagesForAPI = config.includePreviousMessagesAsContext
        ? currentConversation.messages.slice(0, -1).map(m => ({ role: m.role, content: m.content }))
        : [userMessage];
      
      if (config.systemPrompt) {
        messagesForAPI.unshift({ role: 'user', content: config.systemPrompt });
      }
      
      /* Call streaming API */
      const result = await callOpenRouterStreaming(
        config.apiKey,
        config.defaultModel,
        8192, // maxTokens
        config.allowWebSearch ? config.webSearchMaxResults : 0,
        messagesForAPI,
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
        const generationData = await fetchGenerationData(config.apiKey, result.requestID);
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

  // Placeholder cost calculation (implement based on your pricing model)
  function calculateCost(promptTokens: number, completionTokens: number, modelId: string): number {
    // Add actual pricing calculation logic here
    return 0;
  }

  function formatMessage(text: string): string {
    let formattedContent = text;
    formattedContent = formattedContent.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    formattedContent = formattedContent.replace(/`([^`]+)`/g, '<code>$1</code>');
    formattedContent = formattedContent.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    formattedContent = formattedContent.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    formattedContent = formattedContent.replace(/\n/g, '<br>');

    // Convert markdown links to [source] links
    formattedContent = formattedContent.replace(/\[[^\]]*\]\(([^)]+)\)/g, '[<a href="$1" target="_blank">source</a>]');

    // Split by HTML tags to avoid replacing URLs inside tags
    const parts = formattedContent.split(/(<[^>]+>)/);
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) { // not inside a tag
        // Replace bare URLs with [source] links
        parts[i] = parts[i].replace(/(https?:\/\/[^\s<]+)/g, '[<a href="$1" target="_blank">source</a>]');
      }
    }
    formattedContent = parts.join('');

    return formattedContent;
  }
</script>




<div class="conversation">
  <input type="text" class="conversation-title" bind:value={currentConversation.title} on:blur={() => saveConversation(currentConversation)} />
  <!-- Toolbar goes here -->
  

  <!-- Conversation content will go here -->
  <div class="conversation-window">
    <div bind:this={conversationDiv} class="conversation-content" on:scroll={handleScroll} on:mouseup={handleTextSelection}>
      {#each currentConversation.messages as message (message.id)}
        <div class="message {message.role}">
          {#if message.modelName}<div class="role">{message.modelName}</div>{/if}
          <div class="content">{@html formatMessage(message.content)}</div>
          {#if message.totalCost}
            <div class="cost">Cost: ${message.totalCost.toFixed(2)}</div>
          {/if}
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
          searchEngine={config.searchEngine} 
        />
      {/if}
  </div>

  <!-- Total Cost goes here -->
  <div class="total-cost">
    Total Cost: ${currentConversation.messages.reduce((sum, msg) => sum + (msg.totalCost || 0), 0).toFixed(2)}
  </div>

  <!-- Chat Input goes here -->
  <div class="chat-input">
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




<style>
  .conversation-title {
    font-size: 1.5rem;
    font-weight: bold;
    margin: 0.83em 0;
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

  .conversation {
    height: 99%;
    padding: 1rem;
    display: flex;
    flex-direction: column;
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
  
  .message {
    margin-bottom: 1rem;
    padding: 0.5rem;
    border-radius: 16px;
    width: 80%;
  }
  
  .message.user {
    background-color: #30577a;
    margin-left: auto;
  }
  
  .message.assistant {
    background-color: #444;
  }
  
  .role {
    font-weight: bold;
    margin-bottom: 0.25rem;
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
</style>
