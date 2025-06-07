<script lang="ts">
  import { getModels } from './lib/models';
  import type { Config, Model } from './lib/types';
  import { onMount } from 'svelte';
  import PushButton from './lib/PushButton.svelte';
    import { formatModelName } from './lib/util';
    import { estimateDeepResearchCost } from './lib/deep_research';
  
  export let config: Config;
  export let deepSearch = false; // bound from parent
  export let deepSearchStrategy: 'auto' | 'deep' | 'broad' = 'auto'; // bound from parent

  let allModels: Model[] = [];
  let modelFilter = '';

  $: filteredModels = allModels
    .filter(model => config.availableModels.includes(model.id))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  onMount(async () => {
    try {
      allModels = await getModels(config);
    } catch (error) {
      console.error('Failed to fetch models', error);
    }
  });
</script>

<div class="toolbar">
  <div class="toolbar-group">
    <select bind:value={config.defaultModel}>
      {#each filteredModels as model}
        <option value={model.id}>
          {formatModelName(model.name)}
          (In: ${(parseFloat(model.pricing.prompt)*1000000).toFixed(2)}/M, Out: ${(parseFloat(model.pricing.completion)*1000000).toFixed(2)}/M)
        </option>
      {/each}
    </select>
  </div>

  <div class="toolbar-group">
    <label title="If enabled, the LLM can look up information on the web. This costs extra money.">
      <input type="checkbox" bind:checked={config.allowWebSearch} />
      Web Search
    </label>
    <label class="ms-2" title="The maximum number of results to allow the LLM to request. At time of writing, they cost $.004 per result.">
      Max:
      <input style="width: 2rem;" type="number" bind:value={config.webSearchMaxResults} min="1" max="10" />
    </label>
  </div>

  <div class="toolbar-group">
    <label>
      <input id="previous-messages" type="checkbox" bind:checked={config.includePreviousMessagesAsContext} />
      <label for="previous-messages" title="Include previous messages as context. This uses more tokens and thus costs more.">Include Context</label>
    </label>
  </div>

  <div class="toolbar-group">
    <PushButton title="Enable deep searching" bind:pushed={deepSearch}>⛏️</PushButton>
  </div>
</div>

{#if deepSearch}
<div class="toolbar deep-search-toolbar flex flex-row flex-between">
  <div class="flex flex-row flex-wrap gap-2">
    <div class="toolbar-group" title='"Reasoning" model to use for deep searching'>
      <select id="reasoning-model" bind:value={config.defaultReasoningModel}>
        {#each filteredModels as model}
          <option value={model.id}>
            {formatModelName(model.name)}
            (In: ${(parseFloat(model.pricing.prompt)*1000000).toFixed(2)}/M, Out: ${(parseFloat(model.pricing.completion)*1000000).toFixed(2)}/M)
          </option>
        {/each}
      </select>
    </div>
    <div class="toolbar-group" title="Research strategy">
      <select id="search-strategy" bind:value={deepSearchStrategy}>
        <option value="auto">Auto</option>
        <option value="deep">Deep</option>
        <option value="broad">Broad</option>
      </select>
    </div>
    
    <div class="toolbar-group" title="Maximum number of research threads to use for researching the question.">
      <label for="max-subqueries">🧵</label>
      <input style="width: 2rem;" id="max-subqueries" type="number" bind:value={config.deepResearchMaxSubqrequests} min="1" max="16" />
    </div>
    
    <div class="toolbar-group" title="Maximum number of web requests to make per research thread.">
      <label for="web-reqs-per-subquery">🌐/🧵</label>
      <input style="width: 2rem;" id="web-reqs-per-subquery" type="number" bind:value={config.deepResearchWebRequestsPerSubrequest} min="1" max="32" />
    </div>
  </div>
  <div class="px-2 text-secondary" title="Estimated cost of the deep research operation.">
    {#await estimateDeepResearchCost(config) then cost}
      Est: ${cost.toFixed(2)}
    {/await}
  </div>
</div>
{/if}

<style>
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: center;
    padding: 0.5rem 0;
    margin-bottom: 1rem;
    border-bottom: 1px solid #888;
  }

  .toolbar-group {
    display: flex;
    align-items: center;
    gap: 0.1rem;
    margin-left: 0.2rem;
    margin-right: 0.2rem;
  }


  select, input[type="number"] {
    background-color: #333;
    color: white;
    border: 1px solid #666;
    border-radius: 4px;
    padding: 0.25rem;
  }

  .deep-search-toolbar {
    border-top: 1px solid #888;
    margin-top: -0.5rem;
    padding-top: 0.5rem;
  }
</style>
