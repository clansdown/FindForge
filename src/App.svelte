<script lang="ts">
  import MenuBar from './MenuBar.svelte';
  import History from './History.svelte';
  import Conversation from './Conversation.svelte';
  import type { Config, ConversationData, ProjectData } from './lib/types';
  import { loadConfig, saveConfig, storeConversation as saveConversationStorage, loadConversations, deleteConversation, initializeConversationStorage, migrateToProjects } from './lib/storage';
  import { generateID } from './lib/util';
  import { availableModelsStore } from './lib/availableModelsStore';
  import { creditStore, refreshCredits } from './lib/creditStore';
  import Intro from './Intro.svelte';
  import { onMount } from 'svelte';
  import { isCloudSyncPromptNeeded, enableCloudSync, dismissCloudSyncPrompt, isSignedIn } from './cloudSync';
  import { isClerkEnabled } from './auth';
  import NewProjectDialog from './NewProjectDialog.svelte';
  import ProjectSettings from './ProjectSettings.svelte';

  let config : Config;
  let showHistory = true;
  let isDragging = false;
  let splitContainer: HTMLDivElement;
  let currentConversation : ConversationData = {
    id: generateID(),
    projectId: '',
    title: 'New Topic',
    messages: [],
    created: new Date().valueOf(),
    updated: new Date().valueOf()
  };
  let conversations: ConversationData[] = [];
  let showCloudSyncPrompt = false;
  let enablingCloudSync = false;
  let projects: ProjectData[] = [];
  let currentProject: ProjectData | null = null;
  let showNewProjectDialog = false;
  let showProjectSettings = false;

  initialize();

  // Refresh credits when config changes (apiKey toggle, init, etc.)
  $: if (config) {
    refreshCredits(config);
  }

  // Persist last used project
  $: if (currentProject) {
    localStorage.setItem('lastProjectId', currentProject.id);
  }

  onMount(() => {
    const appEl = document.getElementById('app');
    if (!appEl) return;

    if (isCloudSyncPromptNeeded() && isClerkEnabled() && isSignedIn()) {
      showCloudSyncPrompt = true;
    }

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

  async function initialize() {
    /* Load the config */
    const loadedConfig = await loadConfig();
    config = loadedConfig;
    availableModelsStore.set(config.availableModels);

    /* Initialize conversation storage */
    await initializeConversationStorage();

    /* Migrate to projects if needed and load projects */
    projects = await migrateToProjects();

    /* Load existing conversations */
    const loadedConversations = await loadConversations();
    conversations = loadedConversations;

    /* Select current project */
    const lastId = localStorage.getItem('lastProjectId');
    const target = lastId ? projects.find(p => p.id === lastId) : null;
    if (target) {
      currentProject = target;
    } else if (projects.length > 0) {
      currentProject = projects[0];
    }

    /* Ensure current conversation has a valid projectId */
    if (currentProject && !currentConversation.projectId) {
      currentConversation.projectId = currentProject.id;
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
      const maxWidth = splitContainer.clientWidth * 0.8;
      config.historyWidth = Math.max(100, Math.min(x, maxWidth));
      saveConfig(config);
    }
  }

  function newConversation() {
    currentConversation = {
      id: generateID(),
      projectId: currentProject?.id || '',
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

  async function setCurrentProject(project: ProjectData) {
    currentProject = project;
    // Save current conversation before switching
    if (currentConversation.messages.length > 0) {
      saveConversation(currentConversation);
    }
    // Start fresh conversation for the new project
    newConversation();
  }

  async function handleProjectCreated(project: ProjectData) {
    projects = [...projects, project];
    currentProject = project;
    showNewProjectDialog = false;
    newConversation();
  }

  async function handleProjectUpdated(updated: ProjectData) {
    projects = projects.map(p => p.id === updated.id ? updated : p);
    if (currentProject?.id === updated.id) {
      currentProject = updated;
    }
    showProjectSettings = false;
  }

  async function handleEnableCloudSync() {
    enablingCloudSync = true;
    try {
      await enableCloudSync();
      // Re-read config after sync to pick up downloaded API key
      const newConfig = await loadConfig();
      config = newConfig;
      availableModelsStore.set(config.availableModels);
      refreshCredits(config);
    } catch (err) {
      console.error('Failed to enable cloud sync:', err);
    }
    enablingCloudSync = false;
    showCloudSyncPrompt = false;
  }

  function handleDismissCloudSync() {
    dismissCloudSyncPrompt();
    showCloudSyncPrompt = false;
  }

  function openSettings() {
    const event = new CustomEvent('openSettings');
    document.dispatchEvent(event);
  }
</script>

<main>
  <MenuBar bind:config={config} bind:showHistory={showHistory} {newConversation}
    on:openNewProject={() => showNewProjectDialog = true}
    on:openProjectSettings={() => showProjectSettings = true} />
  {#if config?.apiKey}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y_no_noninteractive_element_interactions -->
    <div class="split-container" bind:this={splitContainer} on:mousemove={handleDrag} on:mouseup={stopDrag} on:mouseleave={stopDrag} role="main">
      {#if showHistory}
        <div class="history-container" style="width: {config.historyWidth}px">
          <History {conversations} {setCurrentConversation} {removeConversation} {currentProject} />
        </div>
        <div class="resize-handle" on:mousedown={startDrag} role="slider" tabindex="0" aria-valuenow={config.historyWidth}></div>
      {/if}
      <div class="conversation-container">
        <Conversation bind:currentConversation={currentConversation} {config} {saveConversation} {currentProject} {projects}
          on:switchProject={(e) => setCurrentProject(e.detail)} />
      </div>
    </div>
  {:else}
    <Intro on:openSettings={openSettings} />
  {/if}
</main>

{#if showCloudSyncPrompt}
  <div class="cloud-sync-overlay">
    <div class="cloud-sync-modal">
      <h3>Enable cloud sync?</h3>
      <p>Back up your data and access it on other devices.</p>
      <div class="cloud-sync-actions">
        <button class="btn btn-primary" on:click={handleEnableCloudSync} disabled={enablingCloudSync}>
          {enablingCloudSync ? 'Enabling…' : 'Yes'}
        </button>
        <button class="btn btn-secondary ms-2" on:click={handleDismissCloudSync} disabled={enablingCloudSync}>
          No thanks
        </button>
      </div>
    </div>
  </div>
{/if}

<NewProjectDialog isOpen={showNewProjectDialog} on:create={(e) => handleProjectCreated(e.detail)} on:close={() => showNewProjectDialog = false} />
<ProjectSettings project={currentProject} {config} isOpen={showProjectSettings} on:save={(e) => handleProjectUpdated(e.detail)} on:close={() => showProjectSettings = false} />

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

  .cloud-sync-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
  }

  .cloud-sync-modal {
    background: #222;
    border: 1px solid #555;
    border-radius: 8px;
    padding: 2rem;
    max-width: 420px;
    width: 90%;
  }

  .cloud-sync-modal h3 {
    margin: 0 0 0.5rem;
  }

  .cloud-sync-modal p {
    margin: 0 0 1.5rem;
    color: #aaa;
  }

  .cloud-sync-actions {
    display: flex;
    justify-content: flex-end;
  }

</style>
