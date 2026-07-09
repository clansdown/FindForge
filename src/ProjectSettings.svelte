<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { saveProject } from './lib/storage';
  import type { ProjectData, Config } from './lib/types';
  import ModalDialog from './lib/ModalDialog.svelte';

  const dispatch = createEventDispatcher();

  export let isOpen = false;
  export let project: ProjectData | null = null;
  export let config: Config | null = null;

  let name = '';
  let type = 'research';
  let defaultSystemPromptId = '';
  let defaultModel = '';
  let defaultReasoningModel = '';
  let defaultReasoningEffort: 'none' | 'low' | 'medium' | 'high' | 'xhigh' = 'high';
  let quickQuestionModel = '';
  let quickQuestionReasoningEffort: 'none' | 'low' | 'medium' | 'high' | 'xhigh' = 'high';
  let deepResearchPlanningModel = '';
  let deepResearchResearchModel = '';
  let deepResearchRefiningModel = '';
  let deepResearchSynthesisModel = '';
  let deepResearchPlanningEffort: 'none' | 'low' | 'medium' | 'high' | 'xhigh' = 'high';
  let deepResearchResearchEffort: 'none' | 'low' | 'medium' | 'high' | 'xhigh' = 'high';
  let deepResearchRefiningEffort: 'none' | 'low' | 'medium' | 'high' | 'xhigh' = 'high';
  let deepResearchSynthesisEffort: 'none' | 'low' | 'medium' | 'high' | 'xhigh' = 'high';
  let allowWebSearch = false;
  let webSearchMaxResults = 5;
  let toolsEnabled = true;
  let maxToolIterations = 8;
  let deepResearchPhases = 1;
  let deepResearchMaxSubqrequests = 8;
  let deepResearchWebRequestsPerSubrequest = 0;
  let deepResearchMaxPlanningTokens = 16384;
  let deepResearchMaxSynthesisTokens = 16384;
  let saving = false;
  let error = '';
  let systemPrompts: { id: string; name: string }[] = [];

  $: if (config) {
    systemPrompts = config.systemPrompts || [];
  }

  $: if (project) {
    name = project.name;
    type = project.type;
    const s = project.settings || {};
    defaultSystemPromptId = project.defaultSystemPromptId || '';
    defaultModel = (s as any).defaultModel || '';
    defaultReasoningModel = (s as any).defaultReasoningModel || '';
    defaultReasoningEffort = (s as any).defaultReasoningEffort || 'high';
    quickQuestionModel = (s as any).quickQuestionModel || '';
    quickQuestionReasoningEffort = (s as any).quickQuestionReasoningEffort || 'high';
    deepResearchPlanningModel = (s as any).deepResearchPlanningModel || '';
    deepResearchResearchModel = (s as any).deepResearchResearchModel || '';
    deepResearchRefiningModel = (s as any).deepResearchRefiningModel || '';
    deepResearchSynthesisModel = (s as any).deepResearchSynthesisModel || '';
    deepResearchPlanningEffort = (s as any).deepResearchPlanningEffort || 'high';
    deepResearchResearchEffort = (s as any).deepResearchResearchEffort || 'high';
    deepResearchRefiningEffort = (s as any).deepResearchRefiningEffort || 'high';
    deepResearchSynthesisEffort = (s as any).deepResearchSynthesisEffort || 'high';
    allowWebSearch = (s as any).allowWebSearch ?? false;
    webSearchMaxResults = (s as any).webSearchMaxResults ?? 5;
    toolsEnabled = (s as any).toolsEnabled ?? true;
    maxToolIterations = (s as any).maxToolIterations ?? 8;
    deepResearchPhases = (s as any).deepResearchPhases ?? 1;
    deepResearchMaxSubqrequests = (s as any).deepResearchMaxSubqrequests ?? 8;
    deepResearchWebRequestsPerSubrequest = (s as any).deepResearchWebRequestsPerSubrequest ?? 0;
    deepResearchMaxPlanningTokens = (s as any).deepResearchMaxPlanningTokens ?? 16384;
    deepResearchMaxSynthesisTokens = (s as any).deepResearchMaxSynthesisTokens ?? 16384;
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      error = 'Please enter a project name.';
      return;
    }
    if (!project) return;

    saving = true;
    error = '';

    // Build settings from form values — always overwrites project.settings entirely
    const settings: Record<string, unknown> = {};
    if (defaultModel) settings.defaultModel = defaultModel;
    if (defaultReasoningModel) settings.defaultReasoningModel = defaultReasoningModel;
    if (defaultReasoningEffort !== 'high') settings.defaultReasoningEffort = defaultReasoningEffort;
    if (quickQuestionModel) settings.quickQuestionModel = quickQuestionModel;
    if (quickQuestionReasoningEffort !== 'high') settings.quickQuestionReasoningEffort = quickQuestionReasoningEffort;
    if (deepResearchPlanningModel) settings.deepResearchPlanningModel = deepResearchPlanningModel;
    if (deepResearchResearchModel) settings.deepResearchResearchModel = deepResearchResearchModel;
    if (deepResearchRefiningModel) settings.deepResearchRefiningModel = deepResearchRefiningModel;
    if (deepResearchSynthesisModel) settings.deepResearchSynthesisModel = deepResearchSynthesisModel;
    if (deepResearchPlanningEffort !== 'high') settings.deepResearchPlanningEffort = deepResearchPlanningEffort;
    if (deepResearchResearchEffort !== 'high') settings.deepResearchResearchEffort = deepResearchResearchEffort;
    if (deepResearchRefiningEffort !== 'high') settings.deepResearchRefiningEffort = deepResearchRefiningEffort;
    if (deepResearchSynthesisEffort !== 'high') settings.deepResearchSynthesisEffort = deepResearchSynthesisEffort;
    if (allowWebSearch !== false) settings.allowWebSearch = allowWebSearch;
    if (webSearchMaxResults !== 5) settings.webSearchMaxResults = webSearchMaxResults;
    if (toolsEnabled !== true) settings.toolsEnabled = toolsEnabled;
    if (maxToolIterations !== 8) settings.maxToolIterations = maxToolIterations;
    if (deepResearchPhases !== 1) settings.deepResearchPhases = deepResearchPhases;
    if (deepResearchMaxSubqrequests !== 8) settings.deepResearchMaxSubqrequests = deepResearchMaxSubqrequests;
    if (deepResearchWebRequestsPerSubrequest !== 0) settings.deepResearchWebRequestsPerSubrequest = deepResearchWebRequestsPerSubrequest;
    if (deepResearchMaxPlanningTokens !== 16384) settings.deepResearchMaxPlanningTokens = deepResearchMaxPlanningTokens;
    if (deepResearchMaxSynthesisTokens !== 16384) settings.deepResearchMaxSynthesisTokens = deepResearchMaxSynthesisTokens;

    try {
      const updated: ProjectData = {
        ...project,
        name: trimmed,
        // Do NOT include settings from project.settings — only what the form says
        settings: Object.keys(settings).length > 0 ? settings as Partial<Config> : {} as Partial<Config>,
        defaultSystemPromptId: defaultSystemPromptId || undefined,
        updated: Date.now(),
      };
      await saveProject(updated);
      dispatch('save', updated);
    } catch (err) {
      console.error('Failed to save project settings:', err);
      error = 'Failed to save. Check console for details.';
    }
    saving = false;
  }

  function resetToDefaults() {
    defaultSystemPromptId = '';
    defaultModel = '';
    defaultReasoningModel = '';
    defaultReasoningEffort = 'high';
    quickQuestionModel = '';
    quickQuestionReasoningEffort = 'high';
    deepResearchPlanningModel = '';
    deepResearchResearchModel = '';
    deepResearchRefiningModel = '';
    deepResearchSynthesisModel = '';
    deepResearchPlanningEffort = 'high';
    deepResearchResearchEffort = 'high';
    deepResearchRefiningEffort = 'high';
    deepResearchSynthesisEffort = 'high';
    allowWebSearch = false;
    webSearchMaxResults = 5;
    toolsEnabled = true;
    maxToolIterations = 8;
    deepResearchPhases = 1;
    deepResearchMaxSubqrequests = 8;
    deepResearchWebRequestsPerSubrequest = 0;
    deepResearchMaxPlanningTokens = 16384;
    deepResearchMaxSynthesisTokens = 16384;
  }

  function close() {
    if (!saving) {
      error = '';
      dispatch('close');
    }
  }
</script>

<ModalDialog {isOpen} on:close={close} size="xlg">
  <h2>Project Settings</h2>
  {#if error}
    <div class="error">{error}</div>
  {/if}

  <div class="form-group">
    <label for="proj-name">Name:</label>
    <input type="text" id="proj-name" bind:value={name} disabled={saving} />
  </div>

  <div class="form-group">
    <label for="proj-type">Type:</label>
    <input type="text" id="proj-type" value={type === 'research' ? 'Research' : 'Brainstorming'} disabled />
  </div>

  <h4>System Prompt</h4>
  <div class="form-group">
    <label for="proj-default-prompt">Default Prompt:</label>
    <select id="proj-default-prompt" bind:value={defaultSystemPromptId} disabled={saving}>
      <option value="">(Use global default)</option>
      {#each systemPrompts as p}
        <option value={p.id}>{p.name}</option>
      {/each}
    </select>
  </div>

  <h4>Model Defaults</h4>
  <div class="row">
    <div class="col-md-6">
      <div class="form-group">
        <label for="proj-default-model">Default Model:</label>
        <input type="text" id="proj-default-model" bind:value={defaultModel} placeholder="(Use global)" disabled={saving} />
      </div>
    </div>
    <div class="col-md-6">
      <div class="form-group">
        <label for="proj-reasoning-model">Reasoning Model:</label>
        <input type="text" id="proj-reasoning-model" bind:value={defaultReasoningModel} placeholder="(Use global)" disabled={saving} />
      </div>
    </div>
  </div>

  <div class="row">
    <div class="col-md-6">
      <div class="form-group">
        <label for="proj-reasoning-effort">Reasoning Effort:</label>
        <select id="proj-reasoning-effort" bind:value={defaultReasoningEffort} disabled={saving}>
          <option value="none">None</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="xhigh">Max</option>
        </select>
      </div>
    </div>
    <div class="col-md-6">
      <div class="form-group">
        <label for="proj-qq-model">Quick Question Model:</label>
        <input type="text" id="proj-qq-model" bind:value={quickQuestionModel} placeholder="(Use global)" disabled={saving} />
      </div>
    </div>
  </div>

  <h4>Deep Research Models</h4>
  <div class="row">
    <div class="col-md-6">
      <div class="form-group">
        <label for="proj-dr-planning">Planning Model:</label>
        <input type="text" id="proj-dr-planning" bind:value={deepResearchPlanningModel} placeholder="(Use global)" disabled={saving} />
      </div>
    </div>
    <div class="col-md-6">
      <div class="form-group">
        <label for="proj-dr-planning-effort">Planning Effort:</label>
        <select id="proj-dr-planning-effort" bind:value={deepResearchPlanningEffort} disabled={saving}>
          <option value="none">None</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="xhigh">Max</option>
        </select>
      </div>
    </div>
  </div>

  <div class="row">
    <div class="col-md-6">
      <div class="form-group">
        <label for="proj-dr-research">Research Model:</label>
        <input type="text" id="proj-dr-research" bind:value={deepResearchResearchModel} placeholder="(Use global)" disabled={saving} />
      </div>
    </div>
    <div class="col-md-6">
      <div class="form-group">
        <label for="proj-dr-research-effort">Research Effort:</label>
        <select id="proj-dr-research-effort" bind:value={deepResearchResearchEffort} disabled={saving}>
          <option value="none">None</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="xhigh">Max</option>
        </select>
      </div>
    </div>
  </div>

  <div class="row">
    <div class="col-md-6">
      <div class="form-group">
        <label for="proj-dr-refining">Refining Model:</label>
        <input type="text" id="proj-dr-refining" bind:value={deepResearchRefiningModel} placeholder="(Use global)" disabled={saving} />
      </div>
    </div>
    <div class="col-md-6">
      <div class="form-group">
        <label for="proj-dr-refining-effort">Refining Effort:</label>
        <select id="proj-dr-refining-effort" bind:value={deepResearchRefiningEffort} disabled={saving}>
          <option value="none">None</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="xhigh">Max</option>
        </select>
      </div>
    </div>
  </div>

  <div class="row">
    <div class="col-md-6">
      <div class="form-group">
        <label for="proj-dr-synthesis">Synthesis Model:</label>
        <input type="text" id="proj-dr-synthesis" bind:value={deepResearchSynthesisModel} placeholder="(Use global)" disabled={saving} />
      </div>
    </div>
    <div class="col-md-6">
      <div class="form-group">
        <label for="proj-dr-synthesis-effort">Synthesis Effort:</label>
        <select id="proj-dr-synthesis-effort" bind:value={deepResearchSynthesisEffort} disabled={saving}>
          <option value="none">None</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="xhigh">Max</option>
        </select>
      </div>
    </div>
  </div>

  <h4>Web Search</h4>
  <div class="row">
    <div class="col-md-6">
      <div class="form-group">
        <label>
          <input type="checkbox" bind:checked={allowWebSearch} disabled={saving} />
          Enable Web Search
        </label>
      </div>
    </div>
    <div class="col-md-6">
      <div class="form-group">
        <label for="proj-web-max">Max Results:</label>
        <input type="number" id="proj-web-max" bind:value={webSearchMaxResults} min="1" disabled={saving} />
      </div>
    </div>
  </div>

  <h4>Tool Settings</h4>
  <div class="row">
    <div class="col-md-6">
      <div class="form-group">
        <label>
          <input type="checkbox" bind:checked={toolsEnabled} disabled={saving} />
          Enable Tools
        </label>
      </div>
    </div>
    <div class="col-md-6">
      <div class="form-group">
        <label for="proj-tool-iter">Max Iterations:</label>
        <input type="number" id="proj-tool-iter" bind:value={maxToolIterations} min="1" disabled={saving} />
      </div>
    </div>
  </div>

  <h4>Deep Research Params</h4>
  <div class="row">
    <div class="col-md-4">
      <div class="form-group">
        <label for="proj-dr-phases">Phases:</label>
        <input type="number" id="proj-dr-phases" bind:value={deepResearchPhases} min="1" max="3" disabled={saving} />
      </div>
    </div>
    <div class="col-md-4">
      <div class="form-group">
        <label for="proj-dr-threads">Max Threads per Phase:</label>
        <input type="number" id="proj-dr-threads" bind:value={deepResearchMaxSubqrequests} min="1" disabled={saving} />
      </div>
    </div>
    <div class="col-md-4">
      <div class="form-group">
        <label for="proj-dr-web-req">Web Requests per Thread:</label>
        <input type="number" id="proj-dr-web-req" bind:value={deepResearchWebRequestsPerSubrequest} min="0" disabled={saving} />
      </div>
    </div>
  </div>

  <div class="row">
    <div class="col-md-6">
      <div class="form-group">
        <label for="proj-dr-plan-tokens">Max Planning Tokens:</label>
        <input type="number" id="proj-dr-plan-tokens" bind:value={deepResearchMaxPlanningTokens} min="1" disabled={saving} />
      </div>
    </div>
    <div class="col-md-6">
      <div class="form-group">
        <label for="proj-dr-synth-tokens">Max Synthesis Tokens:</label>
        <input type="number" id="proj-dr-synth-tokens" bind:value={deepResearchMaxSynthesisTokens} min="1" disabled={saving} />
      </div>
    </div>
  </div>

  <div class="button-group">
    <button class="btn btn-outline-secondary" on:click={resetToDefaults} disabled={saving}>Reset to Defaults</button>
    <div class="ms-auto">
      <button on:click={close} disabled={saving}>Cancel</button>
      <button on:click={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
    </div>
  </div>
</ModalDialog>

<style>
  h4 {
    margin-top: 1.5rem;
    margin-bottom: 0.5rem;
    border-bottom: 1px solid #444;
    padding-bottom: 0.25rem;
  }
  .form-group {
    margin-bottom: 0.75rem;
  }
  .form-group label {
    display: block;
    margin-bottom: 0.25rem;
    font-weight: bold;
    font-size: 0.9rem;
  }
  .form-group input[type="text"],
  .form-group input[type="number"],
  .form-group select {
    width: 100%;
    padding: 0.4rem;
    border: 1px solid #555;
    border-radius: 4px;
    background: #333;
    color: #fff;
    box-sizing: border-box;
  }
  .form-group input[disabled],
  .form-group select[disabled] {
    opacity: 0.6;
  }
  .button-group {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid #444;
  }
  .error {
    color: #ff6b6b;
    margin-bottom: 1rem;
  }
</style>
