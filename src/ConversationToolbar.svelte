<script lang="ts">
  import { getModels } from './lib/models';
  import type { Config, Model, ExperimentationOptions, SystemPrompt, ParallelResearchModel } from './lib/types';
  import { onMount } from 'svelte';
  import PushButton from './lib/PushButton.svelte';
  import { formatModelName } from './lib/util';
  import { estimateDeepResearchCost } from './lib/deep_research';
  import Select from 'svelte-select';
    import IconCheckedList from './lib/IconCheckedList.svelte';

    
  export let config: Config;
  export let deepSearch = false; // bound from parent
  export let deepSearchStrategy: 'auto' | 'deep' | 'broad' = 'auto'; // bound from parent
  export let experimentationOptions: ExperimentationOptions; // bound from parent

  let allModels: Model[] = [];
  let modelFilter = '';
  let experimentMode = false; // new state for experiment mode

  interface SelectItem {
    value: SystemPrompt;
    label: string;
  }

  let selectedSystemPrompts : SelectItem[] = [];
  let selectedParallelModels: {value: ParallelResearchModel, label: string}[] = [];
  
  $: {
    // Ensure at least one prompt is selected (default if empty)
    if (selectedSystemPrompts.length === 0 && config?.systemPrompts?.length > 0) {
      selectedSystemPrompts = [{
        value: config.systemPrompts[0],
        label: config.systemPrompts[0].name
      }];
    }

    // Ensure at least one model is selected (default if empty)
    if (selectedParallelModels.length === 0 && filteredModels?.length > 0) {
      const defaultModel = filteredModels.find(m => m.id === config.defaultModel) || filteredModels[0];
      selectedParallelModels = [{
        value: {
          modelId: defaultModel.id,
          modelName: defaultModel.name
        },
        label: formatModelName(defaultModel.name)
      }];
    }

    experimentationOptions.standardResearchPrompts = selectedSystemPrompts.map(item => item.value);
    experimentationOptions.standardResearchModels = selectedParallelModels.map(item => item.value);
  }
  
  $: parallelModelOptions = filteredModels.map(model => ({
    value: {modelId: model.id, modelName: model.name},
    label: formatModelName(model.name)
  }));

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
          (${(parseFloat(model.pricing.prompt)*1000000).toFixed(2)}/M, ${(parseFloat(model.pricing.completion)*1000000).toFixed(2)}/M)
        </option>
      {/each}
    </select>
  </div>

  <div class="toolbar-group" title="System prompt to use for this conversation">
    <select bind:value={config.systemPrompt}>
      {#each config.systemPrompts as prompt}
        <option value={prompt.prompt}>{prompt.name}</option>
      {/each}
    </select>
  </div>

  <div class="toolbar-group">
    <label title="If enabled, the LLM can look up information on the web. This costs extra money.">
      <input type="checkbox" bind:checked={config.allowWebSearch} />
      🌐
    </label>
    <label class="ms-2" title="The maximum number of results to allow the LLM to request. At time of writing, they cost $.004 per result.">
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
  <div class="toolbar-group">
    <PushButton title="Enable experimentation features" bind:pushed={experimentMode}>🔬</PushButton>
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
            (${(parseFloat(model.pricing.prompt)*1000000).toFixed(2)}/M, ${(parseFloat(model.pricing.completion)*1000000).toFixed(2)}/M)
          </option>
        {/each}
      </select>
    </div>
    <div class="toolbar-group" title="Synthesis prompt for deep research">
      <select id="synthesis-prompt" bind:value={config.deepResearchSystemPrompt}>
        {#each config.synthesisPrompts as prompt}
          <option value={prompt.prompt}>{prompt.name}</option>
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
    
    <div class="toolbar-group" title="Number of research phases">
      <label for="research-phases"><IconCheckedList /></label>
      <input style="width: 2rem;" id="research-phases" type="number" bind:value={config.deepResearchPhases} min="1" max="3" />
    </div>
    
    <div class="toolbar-group" title="Maximum number of research threads to use for researching the question.">
      <label for="max-subqueries">🧵/<IconCheckedList /></label>
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

{#if experimentMode}
<div class="toolbar experiment-toolbar flex flex-row flex-between">
  <div class="flex flex-row flex-wrap gap-2">
    <div class="toolbar-group">
      <PushButton title="Execute research in parallel" bind:pushed={experimentationOptions.parallelResearch}>⇉</PushButton>
    </div>
    {#if experimentationOptions.parallelResearch}
      <div class="toolbar-group" title="Select system prompts to use in parallel research">
        <label>Prompts:</label>
        <Select
          multiple
          items={config.systemPrompts.map(p => ({ value: p, label: p.name }))}
          bind:value={selectedSystemPrompts}
          placeholder="Select prompts..."
        />
      </div>
      <div class="toolbar-group" title="Select models to use in parallel research">
        <label>Models:</label>
        <Select
          multiple
          items={parallelModelOptions}
          bind:value={selectedParallelModels}
          placeholder="Select models..."
        />
      </div>
    {/if}
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

  .deep-search-toolbar, .experiment-toolbar {
    border-top: 1px solid #888;
    margin-top: -0.5rem;
    padding-top: 0.5rem;
  }
</style>
