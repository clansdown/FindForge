<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { callOpenRouterStreaming, fetchGenerationData } from './lib/models';
  import { escapeHtml, generateID } from './lib/util';
  import type { MessageData, GenerationData } from './lib/types';
  import type { Config, ConversationData } from './lib/types';

  export let config: Config;
  export let currentConversation : ConversationData;

  let conversationDiv: HTMLDivElement;
  let userInput = '';
  let generating = false;
  let abortController: AbortController | null = null;
  let textarea: HTMLTextAreaElement;

  // Scroll to bottom when messages change
  $: if (currentConversation.messages.length) {
    scrollToBottom();
  }

  function scrollToBottom() {
    conversationDiv.scrollTop = conversationDiv.scrollHeight;
  }

  // Handle textarea key events
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  async function sendMessage() {
    if (!userInput.trim() || generating) return;
    
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
      
      // Call streaming API
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
      
      // Fetch generation data
      if (result.requestID) {
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
    return formattedContent;
  }
</script>




<div class="conversation">
  <h2>Conversation</h2>
  <!-- Toolbar goes here -->
  

  <!-- Conversation content will go here -->
  <div bind:this={conversationDiv} class="conversation-content">
    {#each currentConversation.messages as message (message.id)}
      <div class="message {message.role}">
        <div class="role">{message.role}</div>
        <div class="content">{@html formatMessage(message.content)}</div>
        {#if message.totalCost}
          <div class="cost">Cost: ${message.totalCost.toFixed(2)}</div>
        {/if}
      </div>
    {/each}
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
  .conversation {
    height: 100%;
    padding: 1rem;
    display: flex;
    flex-direction: column;
  }
  .conversation-content {
    overflow-y: auto;
    flex: 1;
  }
  
  .message {
    margin-bottom: 1rem;
    padding: 0.5rem;
    border-radius: 4px;
    width: 80%;
  }
  
  .message.user {
    background-color: #30577a;

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
    color: #666;
  }
  
  .total-cost {
    padding: 0.5rem;
    text-align: right;
    font-weight: normal;
  }
  
  .chat-input {
    display: flex;
    margin-top: 1rem;
    margin-bottom: 1rem;
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
