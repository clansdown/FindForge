<script lang="ts">
  import { saveConfig } from './lib/storage';
  import { Config } from './lib/types';
  import { onDestroy, onMount } from 'svelte';
  import { getModels } from '../lib/models';

  export let config: Config;
  export let isOpen: boolean = false;

  let localConfig: Config = new Config();
  let availableModels: string[] = [];
  let modelFetchError: string | null = null;

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
      .then(models => {
        availableModels = models.map(m => m.id);
      })
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
    background-color: rgba(0,0,0,0.6);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
  }
  
  .modal-content {
    background: #222;
    padding: 2rem;
    border: 1px solid #ddd;
    border-radius: 18px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    width: 80%;
    max-width: 600px;
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
