<script lang="ts">
  import MenuBar from './MenuBar.svelte';
  import History from './History.svelte';
  import Conversation from './Conversation.svelte';
  import type { ApplicationMode, Config, ConversationData, OpenRouterCredits } from './lib/types';
  import { loadConfig, saveConfig, storeConversation as saveConversationStorage, loadConversations, deleteConversation, initializeConversationStorage } from './lib/storage';
  import { generateID, sleep } from './lib/util';
  import { fetchOpenRouterCredits } from './lib/models';
  import Intro from './Intro.svelte';
  import { getLocalPreferenceStore } from './lib/storage';
  import { doesCloudStorageRequireAuthentication, initCloudStorage, loadCloudConfig } from './lib/cloud_storage';

  loadCloudConfig();
  
  let config : Config;
  let showHistory = true;
  const applicationMode = getLocalPreferenceStore('ApplicationMode', 'research' as ApplicationMode);
  let isDragging = false;
  let splitContainer: HTMLDivElement;
  let currentConversation : ConversationData = {
    id: generateID(),
    title: 'New Conversation',
    messages: [],
    created: new Date().valueOf(),
    updated: new Date().valueOf()
  };
  let conversations: ConversationData[] = [];
  let availableOpenrouterCredits: OpenRouterCredits | undefined;
  let cloud_storage_requires_authentication = doesCloudStorageRequireAuthentication();

  if(!cloud_storage_requires_authentication) {
    initialize();
  }



  // Refresh credits when the API key changes
  $: if (config?.apiKey) {
    refreshAvailableCredits(0);
  }

  function initialize() {
    /* Load the config */
    loadConfig().then((loadedConfig) => {
      config = loadedConfig;
    });
    
    /* Initialize conversation storage and load existing conversations */
    initializeConversationStorage().then((d) => {
      loadConversations().then((loadedConversations) => {
        conversations = loadedConversations;
      });
    });
  }

  async function refreshAvailableCredits(delay:number = 5000) {
    if (config.apiKey) {
      try {
        if(delay) await sleep(delay);
        availableOpenrouterCredits = await fetchOpenRouterCredits(config.apiKey);
      } catch (e) {
        console.error('Failed to fetch OpenRouter credits', e);
        availableOpenrouterCredits = undefined;
      }
    } else {
      availableOpenrouterCredits = undefined;
    }
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
      config.historyWidth = Math.max(100, x);
      saveConfig(config);
      config = config; // Trigger reactivity
    }
  }

  function newConversation() {
    currentConversation = {
      id: generateID(),
      title: 'New Conversation',
      messages: [],
      created: new Date().valueOf(),
      updated: new Date().valueOf()
    };
  }

  function setCurrentConversation(conversation: ConversationData) {
    currentConversation = conversation;
  }

  function removeConversation(conversation: ConversationData) {
    if (confirm('Are you sure you want to delete this conversation? This action is permanent and cannot be undone.')) {
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
        conversations.push(conversation);
        conversations = conversations; // Trigger reactivity
    }
    saveConversationStorage(conversation);
  }

  function openSettings() {
    // This will be handled by MenuBar via event bubbling
    const event = new CustomEvent('openSettings');
    document.dispatchEvent(event);
  }

  async function authenticateCloudStorage() {
    cloud_storage_requires_authentication = !(await initCloudStorage());
    if (!cloud_storage_requires_authentication) {
      initialize();
    }
  }
</script>

<main>
  <MenuBar bind:config={config} bind:showHistory={showHistory} {newConversation} credits={availableOpenrouterCredits} {applicationMode} />
  {#if cloud_storage_requires_authentication}
    <div class="alert">
      Cloud storage authentication is required.
      <div class="row my-4">
        <div class="col text-center">
          <button class="btn btn-primary" style="margin: auto;" on:click={authenticateCloudStorage}>Authenticate</button>
        </div>
      </div>
    </div>
  {:else}
    {#if config?.apiKey}
      <!-- svelte-ignore a11y-click-events-have-key-events a11y_no_noninteractive_element_interactions -->
      <div class="split-container" bind:this={splitContainer} on:mousemove={handleDrag} on:mouseup={stopDrag} on:mouseleave={stopDrag} role="main">
        {#if showHistory}
          <div class="history-container" style="width: {config.historyWidth}px">
            <History {config} {conversations} {setCurrentConversation} {removeConversation} />
          </div>
          <div class="resize-handle" on:mousedown={startDrag} role="slider" tabindex="0" aria-valuenow={config.historyWidth}></div>
        {/if}
        <div class="conversation-container">
          <Conversation bind:currentConversation={currentConversation} {config} {saveConversation} {refreshAvailableCredits} availableCredits={availableOpenrouterCredits} {applicationMode} />
        </div>
      </div>
    {:else}
      <Intro on:openSettings={openSettings} />
    {/if}
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
  }
  
  .alert {
    margin: 3rem auto;
    padding: 1rem;
  }

</style>
