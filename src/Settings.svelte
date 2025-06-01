<script lang="ts">
  import { saveConfig } from './lib/storage';
  import { Config, type Model } from './lib/types';
  import { onDestroy, onMount } from 'svelte';
  import { getModels } from './lib/models';

  export let config: Config;
  export let isOpen: boolean = false;

  let localConfig: Config = new Config();
  let availableModels: Model[] = [];
  let modelFetchError: string | null = null;
  let currentTab : 'general' | 'model' = 'general';

  function handleKeydown(event: KeyboardEvent) {
    if(isOpen) {
      if (event.key === 'Escape') {
        isOpen = false;
      }
    }
  }

  let removeKeydown: () => void;
  $: if (isOpen) {
    window.addEventListener('keydown', handleKeydown);
    removeKeydown = () => window.removeEventListener('keydown', handleKeydown);
  }

  onDestroy(() => {
    if (removeKeydown) removeKeydown();
  });

  $: if (isOpen) {
    // Create a deep copy when dialog opens
    localConfig = JSON.parse(JSON.stringify(config));
    // Fetch models when dialog opens
    modelFetchError = null;
    getModels(config)
      .then(models => { availableModels = models; })
      .catch(error => {
        modelFetchError = error.message;
        console.error('Model fetch failed:', error);
      });
  }

  function save() {
    Object.assign(config, localConfig);
    saveConfig(config);
    isOpen = false;
  }
</script>

<svelte:window on:keydown={handleKeydown} />
{#if isOpen}
<div class="modal-background" on:click|stopPropagation on:keydown={handleKeydown} role="dialog" aria-modal="true" tabindex="0">
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="modal-content" on:click|stopPropagation>
    <h2>Settings</h2>
    
    <ul class="nav nav-tabs">
      <li class="nav-item" class:active={currentTab === 'general'}><a class="nav-link" href="#" on:click={() => currentTab = 'general'}>Research</a></li>
      <li class="nav-item" class:active={currentTab === 'model'}><a class="nav-link" href="#" on:click={() => currentTab = 'model'}>Model</a></li>
    </ul>

    {#if currentTab === 'general'}

      <div class="form-group">
        <label>System Prompt:</label>
        <textarea bind:value={localConfig.systemPrompt} rows="4" />
      </div>
      
      <div class="form-group">
        <label>
          <input type="checkbox" bind:checked={localConfig.allowWebSearch} />
          Allow Web Search
        </label>
      </div>
      
      <div class="form-group">
        <label>Web Search Max Results:</label>
        <input type="number" bind:value={localConfig.webSearchMaxResults} min="1" />
      </div>
      
      <div class="form-group">
        <label>
          <input type="checkbox" bind:checked={localConfig.includePreviousMessagesAsContext} />
          Include Previous Messages as Context
        </label>
      </div>
      
      <div class="form-group">
        <label>Search Engine:</label>
        <select bind:value={localConfig.searchEngine}>
          <option value="duckduckgo">DuckDuckGo</option>
          <option value="google">Google</option>
          <option value="bing">Bing</option>
          <option value="kagi">Kagi</option>
          <option value="brave">Brave</option>
        </select>
      </div>

    {:else if currentTab === 'model'}
      <div class="form-group">
        <label>API Key:</label>
        <input type="password" bind:value={localConfig.apiKey} />
      </div>
      
      <div class="form-group">
        <label>Default Model:</label>
        <select bind:value={localConfig.defaultModel}>
          {#each availableModels as model}
            <option value={model}>{model}</option>
          {/each}
        </select>
        {#if modelFetchError}
          <div class="error">{modelFetchError}</div>
        {/if}
    </div>


    {/if}


    
    <div class="button-group">
      <button on:click={() => isOpen = false}>Cancel</button>
      <button on:click={save}>Save</button>
    </div>
  </div>
</div>
{/if}

<style>
  .modal-background {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0,0,0,0.7);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
  }
  
  .modal-content {
    background: #222;
    padding: 0 2rem 2rem 2rem;
    border: 2px solid #ddd;
    border-radius: 18px;
    box-shadow: 0 4px 10px rgba(1,1,1,0.3);
    width: 80%;
    max-width: 860px;
  }
  
  .form-group {
    margin-bottom: 1rem;
  }
  
  .form-group label {
    display: block;
    margin-bottom: 0.5rem;
    font-weight: bold;
  }
  
  .form-group input[type="text"],
  .form-group input[type="password"],
  .form-group input[type="number"],
  .form-group textarea,
  .form-group select {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid #ddd;
    border-radius: 4px;
  }
  
  .button-group {
    display: flex;
    justify-content: flex-end;
    gap: 1rem;
    margin-top: 1rem;
  }
  
  .button-group button {
    padding: 0.5rem 1rem;
    cursor: pointer;
  }

  .error {
    color: #ff6b6b;
    margin-top: 0.5rem;
    font-size: 0.9rem;
  }
</style>
