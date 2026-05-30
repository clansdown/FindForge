<script lang="ts">
  import MenuBar from './MenuBar.svelte';
  import History from './History.svelte';
  import Conversation from './Conversation.svelte';
  import type { ApplicationMode, Config, ConversationData } from './lib/types';
  import { loadConfig, saveConfig, storeConversation as saveConversationStorage, loadConversations, deleteConversation, initializeConversationStorage } from './lib/storage';
  import { generateID } from './lib/util';
  import { availableModelsStore } from './lib/availableModelsStore';
  import { creditStore, refreshCredits } from './lib/creditStore';
  import Intro from './Intro.svelte';
  import { getLocalPreferenceStore } from './lib/storage';
  import { onMount } from 'svelte';

  let config : Config;
  let showHistory = true;
  const applicationMode = getLocalPreferenceStore('ApplicationMode', 'research' as ApplicationMode);
  let isDragging = false;
  let splitContainer: HTMLDivElement;
  let currentConversation : ConversationData = {
    id: generateID(),
    title: 'New Topic',
    messages: [],
    created: new Date().valueOf(),
    updated: new Date().valueOf()
  };
  let conversations: ConversationData[] = [];

  initialize();

  // Refresh credits when config changes (apiKey toggle, init, etc.)
  $: if (config) {
    refreshCredits(config);
  }

  onMount(() => {
    const appEl = document.getElementById('app');
    if (!appEl) return;

    const handleConfigUpdated = (e: Event) => {
      config = (e as CustomEvent).detail as Config;
      refreshCredits(config);
    };

    const handleConversationsUpdated = (e: Event) => {
      conversations = (e as CustomEvent).detail as ConversationData[];
    };

    const handleConversationUpdated = (e: Event) => {
      const updated = (e as CustomEvent).detail as ConversationData;
      conversations = conversations.map(c => c.id === updated.id ? updated : c);
    };

    document.addEventListener('configUpdated', handleConfigUpdated);
    document.addEventListener('conversationsUpdated', handleConversationsUpdated);
    document.addEventListener('conversationUpdated', handleConversationUpdated);

    return () => {
      document.removeEventListener('configUpdated', handleConfigUpdated);
      document.removeEventListener('conversationsUpdated', handleConversationsUpdated);
      document.removeEventListener('conversationUpdated', handleConversationUpdated);
    };
  });

  function initialize() {
    /* Load the config */
    loadConfig().then((loadedConfig) => {
      config = loadedConfig;
      availableModelsStore.set(config.availableModels);
    });

    /* Initialize conversation storage and load existing conversations */
    initializeConversationStorage().then(() => {
      loadConversations().then((loadedConversations) => {
        conversations = loadedConversations;
      });
    });
  }

  function startDrag() {
    isDragging = true;
  }

  function stopDrag() {
    isDragging = false;
  }

  function handleDrag(e: MouseEvent) {
    if (isDragging) {
      let x = e.clientX - splitContainer.getBoundingClientRect().x;
      const maxWidth = splitContainer.clientWidth * 0.8;
      config.historyWidth = Math.max(100, Math.min(x, maxWidth));
      saveConfig(config);
    }
  }

  function newConversation() {
    currentConversation = {
      id: generateID(),
      title: 'New Topic',
      messages: [],
      created: new Date().valueOf(),
      updated: new Date().valueOf()
    };
  }

  function setCurrentConversation(conversation: ConversationData) {
    currentConversation = conversation;
  }

  function removeConversation(conversation: ConversationData) {
    if (confirm('Are you sure you want to delete this topic? This action is permanent and cannot be undone.')) {
      deleteConversation(conversation.id);
      conversations = conversations.filter(c => c.id !== conversation.id);
    }
  }

  function saveConversation(conversation: ConversationData) {
    // Update the 'updated' timestamp to now
    conversation.updated = Date.now();

    console.log('Saving conversation:', conversation);
    // Update the conversations list: if it exists, replace, else add
    const index = conversations.findIndex(c => c.id === conversation.id);
    if (index >= 0) {
        conversations[index] = conversation;
    } else {
        conversations = [...conversations, conversation];
    }
    saveConversationStorage(conversation);
  }

  function openSettings() {
    const event = new CustomEvent('openSettings');
    document.dispatchEvent(event);
  }
</script>

<main>
  <MenuBar bind:config={config} bind:showHistory={showHistory} {newConversation} {applicationMode} />
  {#if config?.apiKey}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y_no_noninteractive_element_interactions -->
    <div class="split-container" bind:this={splitContainer} on:mousemove={handleDrag} on:mouseup={stopDrag} on:mouseleave={stopDrag} role="main">
      {#if showHistory}
        <div class="history-container" style="width: {config.historyWidth}px">
          <History {conversations} {setCurrentConversation} {removeConversation} />
        </div>
        <div class="resize-handle" on:mousedown={startDrag} role="slider" tabindex="0" aria-valuenow={config.historyWidth}></div>
      {/if}
      <div class="conversation-container">
        <Conversation bind:currentConversation={currentConversation} {config} {saveConversation} {applicationMode} />
      </div>
    </div>
  {:else}
    <Intro on:openSettings={openSettings} />
  {/if}
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100%;
    max-width: 80rem;
    margin: auto;
  }
  .split-container {
    display: flex;
    height: calc(100vh - 50px); /* Adjust based on menu bar height */
    width: 100%;
    justify-content: center;
    margin: auto;
  }

  .history-container {
    height: 100%;
    overflow: hidden;
    max-width: 80%;
  }

  .resize-handle {
    width: 5px;
    background-color: #ccc;
    cursor: col-resize;
    height: 100%;
  }

  .resize-handle:hover {
    background-color: #646cff;
  }

  .conversation-container {
    flex: 1;
    height: 100%;
    width: 100%;
    overflow: hidden;
    min-width: 0;
  }

</style>
