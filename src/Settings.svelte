<script lang="ts">
  import { saveConfig } from './lib/storage';
  import { Config, type Model, type OpenRouterCredits } from './lib/types';
  import { onDestroy, onMount } from 'svelte';
  import { getModels } from './lib/models';

  export let config: Config;
  export let isOpen: boolean = false;
  export let credits: OpenRouterCredits | undefined;

  let localConfig: Config = new Config();
  let openrouterModels: Model[] = [];
  let availableModels : Model[] = [];
  let modelFetchError: string | null = null;
  let currentTab : 'general' | 'model' =  config.apiKey ? 'general' : 'model';
  let modelFilter = '';
  
  $: remainingCredits = credits ? credits.total_credits - credits.total_usage : -1;
  $: showOnlyFreeModels = remainingCredits === 0;

  $: filteredModels = (modelFilter ? openrouterModels.filter(model => 
        model.name.toLowerCase().includes(modelFilter.toLowerCase()) ||
        model.id.toLowerCase().includes(modelFilter.toLowerCase())
      ) : openrouterModels)
      .filter(model => {
        if (showOnlyFreeModels) {
          return parseFloat(model.pricing.prompt) === 0 && parseFloat(model.pricing.completion) === 0;
        }
        return true;
      });

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

  $: availableModels = calculateAvailableModelsFromConfig(localConfig.availableModels, openrouterModels);

  onDestroy(() => {
    if (removeKeydown) removeKeydown();
  });

  $: if (isOpen) {
    opened();
  }

  function opened() {
    console.log('Settings dialog opened');
    // Create a deep copy when dialog opens
    localConfig = JSON.parse(JSON.stringify(config));
    // Fetch models when dialog opens
    modelFetchError = null;
    if(config.apiKey) {
      getModels(config)
        .then(models => { 
          models.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
          openrouterModels = models.map(model => ({
            ...model,
            allowed: localConfig.availableModels.length === 0 
              ? true 
              : localConfig.availableModels.includes(model.id)
          })); 
        })
        .catch(error => {
          modelFetchError = error.message;
          console.error('Model fetch failed:', error);
        });
    } else {
      openrouterModels = [];
      modelFetchError = 'API key is required to fetch models.';
    }
  }


  function calculateAvailableModelsFromConfig(list:string[], models: Model[]) : Model[] {
    let am : Model[] = [];
    if (list && list.length > 0) {
      list.forEach(modelID => {
        let model = models.find(m => m.id === modelID);
        if (model) {
          am.push(model);
        }
      });
    } else {
      // If no available models are set, return all models
      am = models;
    }
    return am;
  }

  /**
   * Sets the availableModels field in the config based on the user-sellected models.
  */
  function setAvailableModelsConfig(models: Model[]) {
    let am : string[] = [];
    models.forEach(model => {
      if (model.allowed) {
        am.push(model.id);
      }
    });
    localConfig.availableModels = am;
    localConfig = localConfig;
  }

  function save() {
    setAvailableModelsConfig(openrouterModels);
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

    <!---------------------------->
    <!-- Research Configuration -->
    <!---------------------------->
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
          <option value="kagi">Kagi</option>
          <option value="brave">Brave</option>
          <option value="bing">Bing</option>
          <option value="google">Google</option>
        </select>
      </div>

    <!------------------------->
    <!-- Model Configuration -->
    <!------------------------->
    {:else if currentTab === 'model'}
      <div class="form-group">
        <label>API Key:</label>
        <input type="password" bind:value={localConfig.apiKey} />
      </div>
      
      <div class="form-group">
        <label>Default Model:</label>
        <select bind:value={localConfig.defaultModel}>
          {#each availableModels as model}
            <option value={model.id}>
              {model.name}
              (In: ${(parseFloat(model.pricing.prompt)*1000000).toFixed(2)}/M, Out: ${(parseFloat(model.pricing.completion)*1000000).toFixed(2)}/M)
            </option>
          {/each}
        </select>
        {#if modelFetchError}
          <div class="error">{modelFetchError}</div>
        {/if}
      </div>

      <div class="form-group">
        <label>Available Models</label>
        <div class="form-group">
          <div class="filter-container">
            <input 
              type="text" 
              placeholder="Filter models..." 
              bind:value={modelFilter}
              class="filter-input"
            />
            {#if modelFilter}
              <button class="clear-button" on:click={() => modelFilter = ''} aria-label="Clear filter">
                ×
              </button>
            {/if}
          </div>
        </div>
        <div class="model-list">
          {#each filteredModels as model}
            <div class="row">
              <div class="col">
                <input type="checkbox" bind:checked={model.allowed} />
                <span style="margin-right: 1rem;">{model.name} </span>
                (In: ${(parseFloat(model.pricing.prompt)*1000000).toFixed(2)}/M, Out: ${(parseFloat(model.pricing.completion)*1000000).toFixed(2)}/M)
              </div>
            </div>
          {/each}
        </div>
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
    color: #fff;
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

  .model-list {
    max-height: 300px;
    overflow-y: auto;
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 0.5rem;
    background-color: #333;
  }
  
  .filter-container {
    position: relative;
    display: flex;
  }
  
  .clear-button {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: #999;
    cursor: pointer;
    font-size: 1.2rem;
    line-height: 1;
    padding: 0;
  }
  
  .clear-button:hover {
    color: #fff;
  }
  
  .filter-input {
    width: 100%;
    padding: 0.5rem 30px 0.5rem 0.5rem; /* top, right, bottom, left */
    border: 1px solid #ddd;
    border-radius: 4px;
    background-color: #333;
    color: white;
  }

</style>
