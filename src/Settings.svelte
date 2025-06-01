<script lang="ts">
  import { saveConfig } from './lib/storage';
  import { Config } from './lib/types';

  export let config: Config;
  export let isOpen: boolean = false;

  let localConfig: Config = new Config();

  $: if (isOpen) {
    // Create a deep copy when dialog opens
    localConfig = JSON.parse(JSON.stringify(config));
  }

  function save() {
    Object.assign(config, localConfig);
    saveConfig(config);
    isOpen = false;
  }
</script>

{#if isOpen}
<div class="modal-background" on:click|stopPropagation>
  <div class="modal-content" on:click|stopPropagation>
    <h2>Settings</h2>
    
    <div class="form-group">
      <label>API Key:</label>
      <input type="password" bind:value={localConfig.apiKey} />
    </div>
    
    <div class="form-group">
      <label>Default Model:</label>
      <input type="text" bind:value={localConfig.defaultModel} />
    </div>
    <!--  TODO: fix this garbage
    <div class="form-group">
      <label>Available Models (comma separated):</label>
      <input type="text" bind:value={localConfig.availableModels.join(', ')} />
    </div>
  -->
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
        <option value="google">Google</option>
        <option value="bing">Bing</option>
        <option value="duckduckgo">DuckDuckGo</option>
      </select>
    </div>
    
    <div class="button-group">
      <button on:click={save}>Save</button>
      <button on:click={() => isOpen = false}>Cancel</button>
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
    background-color: rgba(0,0,0,0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
  }
  
  .modal-content {
    background: #111;
    padding: 2rem;
    border-radius: 8px;
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
</style>
