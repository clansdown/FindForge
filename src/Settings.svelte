<script lang="ts">
    import { saveConfig, getLocalPreference } from "./lib/storage";
    import { Config, type Model } from "./lib/types";
    import { onDestroy, onMount } from "svelte";
    import { getModels } from "./lib/models";
    import ModalDialog from "./lib/ModalDialog.svelte";
    import { generateID, formatModelLabel, formatContextLength } from "./lib/util";
    import { availableModelsStore } from "./lib/availableModelsStore";
    import { estimateDeepResearchCost } from "./lib/deep_research";
    import { creditStore } from "./lib/creditStore";
    import { cloudSyncStore,
        enableCloudSync,
        disableCloudSync,
        triggerManualSync,
        triggerCompleteResync,
        isSignedIn
    } from "./cloudSync";

    export let config: Config;
    export let isOpen: boolean = false;

    let localConfig: Config = new Config();
    let openrouterModels: Model[] = [];
    let availableModels: Model[] = [];
    let modelFetchError: string | null = null;
    let currentTab: "general" | "model" | "deep-research" | "tools" | "cloud-sync" | "config" = config?.apiKey ? "general" : "model";
    let modelFilter = "";
    let estimatedDeepResearchCost: number | string | null = null;
    let showPromptEditor: boolean = false;
    let showSynthesisPromptEditor: boolean = false;
    let currentSystemPromptIndex: number = 0;
    let currentSystemPromptName: string = '';
    let currentSystemPromptText: string = '';
    let currentSynthesisPromptIndex: number = 0;
    let currentSynthesisPromptName: string = '';
    let currentSynthesisPromptText: string = '';

    let configSnapshot = '';

    // ── Document cache state ──
    let cacheStats: { usedBytes: number; entryCount: number; limitBytes: number } | null = null;
    let cacheLimitMb = 1000;
    let pwaInstalled = false;

    onMount(async () => {
        const { getCacheStats, isPwaInstalled } = await import('./lib/docCache');
        const stats = await getCacheStats();
        cacheStats = stats;
        cacheLimitMb = stats.limitBytes / 1_000_000;
        pwaInstalled = isPwaInstalled();
    });

    async function handleClearCache() {
        const { clearCache } = await import('./lib/docCache');
        await clearCache();
        if (cacheStats) {
            cacheStats = { usedBytes: 0, entryCount: 0, limitBytes: cacheStats.limitBytes };
        }
    }

    $: filteredModels = (
        modelFilter
            ? openrouterModels.filter(
                  (model) =>
                      model.name.toLowerCase().includes(modelFilter.toLowerCase()) || model.id.toLowerCase().includes(modelFilter.toLowerCase()),
              )
            : openrouterModels
    ).filter((model) => {
        return parseFloat(model.pricing.prompt) > 0 || parseFloat(model.pricing.completion) > 0;
    }).filter(m => m.supported_parameters?.includes('tools'));

    $: availableModels = openrouterModels.filter(m => m.allowed);

    $: if (openrouterModels.length > 0) {
        const enabledIds = openrouterModels.filter(m => m.allowed).map(m => m.id);
        availableModelsStore.set(enabledIds);
    }

    $: if (isOpen) {
        opened();
    }

    $: if(isOpen) estimateDeepResearchCost(localConfig).then((cost) => {
        estimatedDeepResearchCost = cost;
    }).catch((error) => {
        console.error('Failed to estimate deep research cost', error);
        estimatedDeepResearchCost = 'Error: ' + error.message;
    });

    $: if (currentSystemPromptIndex >= 0 && currentSystemPromptIndex < localConfig.systemPrompts.length) {
        currentSystemPromptName = localConfig.systemPrompts[currentSystemPromptIndex].name;
        currentSystemPromptText = localConfig.systemPrompts[currentSystemPromptIndex].prompt;
    } else if (currentSystemPromptIndex === -1) {
        currentSystemPromptName = '';
        currentSystemPromptText = '';
    }

    $: if (currentSynthesisPromptIndex >= 0 && currentSynthesisPromptIndex < localConfig.synthesisPrompts.length) {
        currentSynthesisPromptName = localConfig.synthesisPrompts[currentSynthesisPromptIndex].name;
        currentSynthesisPromptText = localConfig.synthesisPrompts[currentSynthesisPromptIndex].prompt;
    } else if (currentSynthesisPromptIndex === -1) {
        currentSynthesisPromptName = '';
        currentSynthesisPromptText = '';
    }

    function opened() {
        console.log("Settings dialog opened");
        // Create a deep copy when dialog opens
        localConfig = JSON.parse(JSON.stringify(config));
        configSnapshot = JSON.stringify(config);
        // Initialize system prompt UI
        if (localConfig.systemPrompts.length > 0) {
            currentSystemPromptIndex = 0;
            currentSystemPromptName = localConfig.systemPrompts[0].name;
            currentSystemPromptText = localConfig.systemPrompts[0].prompt;
        } else {
            currentSystemPromptIndex = -1;
            currentSystemPromptName = '';
            currentSystemPromptText = '';
        }
        // Initialize synthesis prompt UI
        if (localConfig.synthesisPrompts.length > 0) {
            currentSynthesisPromptIndex = 0;
            currentSynthesisPromptName = localConfig.synthesisPrompts[0].name;
            currentSynthesisPromptText = localConfig.synthesisPrompts[0].prompt;
        } else {
            currentSynthesisPromptIndex = -1;
            currentSynthesisPromptName = '';
            currentSynthesisPromptText = '';
        }
        // Fetch models when dialog opens
        modelFetchError = null;
        if (config.apiKey) {
            getModels(config)
                .then((models) => {
                    models.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
                    openrouterModels = models
                        .filter(m => m.supported_parameters?.includes('tools'))
                        .map((model) => ({
                            ...model,
                            allowed: localConfig.availableModels.length === 0 ? true : localConfig.availableModels.includes(model.id),
                        }));
                })
                .catch((error) => {
                    modelFetchError = error.message;
                    console.error("Model fetch failed:", error);
                });
        } else {
            openrouterModels = [];
            modelFetchError = "API key is required to fetch models.";
        }
    }




    function calculateAvailableModelsFromConfig(list: string[], models: Model[]): Model[] {
        let am: Model[] = [];
        if (list && list.length > 0) {
            list.forEach((modelID) => {
                let model = models.find((m) => m.id === modelID);
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
        let am: string[] = [];
        models.forEach((model) => {
            if (model.allowed) {
                am.push(model.id);
            }
        });
        localConfig.availableModels = am;
    }

    function deleteSystemPrompt() {
        if (currentSystemPromptIndex > 0) { // don't delete the first one (Default)
            localConfig.systemPrompts.splice(currentSystemPromptIndex, 1);
            // Switch to the first one
            currentSystemPromptIndex = 0;
        }
    }

    function discardSystemPrompt() {
        // Switch to the first one (Default)
        currentSystemPromptIndex = 0;
    }

    function saveSystemPrompt() {
        if (currentSystemPromptIndex === -1) {
            // Add new
            localConfig.systemPrompts.push({
                id: generateID(),
                name: currentSystemPromptName,
                prompt: currentSystemPromptText
            });
            currentSystemPromptIndex = localConfig.systemPrompts.length - 1;
        } else {
            // Update existing
            if (currentSystemPromptIndex >= 0 && currentSystemPromptIndex < localConfig.systemPrompts.length) {
                localConfig.systemPrompts[currentSystemPromptIndex].name = currentSystemPromptName;
                localConfig.systemPrompts[currentSystemPromptIndex].prompt = currentSystemPromptText;
            }
        }
    }

    function deleteSynthesisPrompt() {
        if (currentSynthesisPromptIndex > 0) { // don't delete the first one (Default)
            localConfig.synthesisPrompts.splice(currentSynthesisPromptIndex, 1);
            // Switch to the first one
            currentSynthesisPromptIndex = 0;
        }
    }

    function discardSynthesisPrompt() {
        // Switch to the first one (Default)
        currentSynthesisPromptIndex = 0;
    }

    function saveSynthesisPrompt() {
        if (currentSynthesisPromptIndex === -1) {
            // Add new
            localConfig.synthesisPrompts.push({
                id: generateID(),
                name: currentSynthesisPromptName,
                prompt: currentSynthesisPromptText
            });
            currentSynthesisPromptIndex = localConfig.synthesisPrompts.length - 1;
        } else {
            // Update existing
            if (currentSynthesisPromptIndex >= 0 && currentSynthesisPromptIndex < localConfig.synthesisPrompts.length) {
                localConfig.synthesisPrompts[currentSynthesisPromptIndex].name = currentSynthesisPromptName;
                localConfig.synthesisPrompts[currentSynthesisPromptIndex].prompt = currentSynthesisPromptText;
            }
        }
    }

    function save() {
        setAvailableModelsConfig(openrouterModels);
        if (configSnapshot && JSON.stringify(config) !== configSnapshot) {
            if (!confirm('Cloud sync has updated settings while this dialog was open. Overwrite remote changes with your edits?')) {
                return;
            }
        }
        Object.assign(config, localConfig);
        saveConfig(config);
        isOpen = false;
    }
</script>

<ModalDialog on:close={() => (isOpen = false)} {isOpen} size="xlg">
    <h2>Settings</h2>

    <ul class="nav nav-tabs">
        <li class="nav-item" class:active={currentTab === "general"}>
            <button class="nav-link" on:click={() => (currentTab = "general")}>Research</button>
        </li>
        <li class="nav-item" class:active={currentTab === "deep-research"}>
            <button class="nav-link" on:click={() => (currentTab = "deep-research")}>Deep Research</button>
        </li>
        <li class="nav-item" class:active={currentTab === "config"}>
            <button class="nav-link" on:click={() => (currentTab = "config")}>Config</button>
        </li>
        <li class="nav-item" class:active={currentTab === "model"}>
            <button class="nav-link" on:click={() => (currentTab = "model")}>Models</button>
        </li>
        <li class="nav-item" class:active={currentTab === "tools"}>
            <button class="nav-link" on:click={() => (currentTab = "tools")}>Tools</button>
        </li>
        <li class="nav-item" class:active={currentTab === "cloud-sync"}>
            <button class="nav-link" on:click={() => (currentTab = "cloud-sync")}>Cloud Sync</button>
        </li>
    </ul>

    <!---------------------------->
    <!-- Research Configuration -->
    <!---------------------------->
    {#if currentTab === "general"}
        <div class="form-group">
            <label for="default-system-prompt-select">Default System Prompt:</label>
            <select id="default-system-prompt-select" bind:value={localConfig.defaultSystemPromptId}>
                {#each localConfig.systemPrompts as prompt}
                    <option value={prompt.id}>{prompt.name}</option>
                {/each}
            </select>
        </div>

        <button class="small" style="margin-bottom: 1rem;" on:click={() => showPromptEditor = !showPromptEditor}>
            {showPromptEditor ? 'Hide' : 'Manage'} Prompts
        </button>

        {#if showPromptEditor}
            <div class="form-group">
                <label for="system-prompt-select">Prompt to Edit:</label>
                <select id="system-prompt-select" bind:value={currentSystemPromptIndex}>
                    {#each localConfig.systemPrompts as prompt, index (index)}
                        <option value={index}>{prompt.name}</option>
                    {/each}
                    <option value={-1}>New...</option>
                </select>
            </div>
        <div class="form-group prompt-editor">
            <div class="form-group">
                <label for="system-prompt-name">Name:</label>
                <input type="text" id="system-prompt-name" bind:value={currentSystemPromptName} />
            </div>

            <div class="form-group">
                <label for="system-prompt">Prompt:</label>
                <textarea id="system-prompt" bind:value={currentSystemPromptText} rows="4"></textarea>
            </div>

            <div class="form-group button-group">
                <button on:click={deleteSystemPrompt} disabled={currentSystemPromptIndex === 0}>Delete</button>
                <button on:click={discardSystemPrompt}>Discard</button>
                <button on:click={saveSystemPrompt}>Save</button>
            </div>
        </div>
        {/if}

        <div class="form-group" style="display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;">
            <label for="tools-enabled" style="display: flex; align-items: center; gap: 0.3rem; white-space: nowrap;">
                <input type="checkbox" id="tools-enabled" bind:checked={localConfig.toolsEnabled} />
                Enable Tools
            </label>
            <label style="display: flex; align-items: center; gap: 0.3rem; white-space: nowrap;">
                Max Iterations:
                <input type="number" bind:value={localConfig.maxToolIterations} min="1" max="100" style="width: 70px;" />
            </label>
        </div>

        <div class="form-group" style="display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;">
            <label style="display: flex; align-items: center; gap: 0.3rem; white-space: nowrap;">
                <input type="checkbox" bind:checked={localConfig.allowWebSearch} />
                Web Search
            </label>

            <label style="display: flex; align-items: center; gap: 0.3rem; white-space: nowrap;">
                Max Results:
                <input type="number" bind:value={localConfig.webSearchMaxResults} min="1" style="width: 70px;" />
            </label>
        </div>

        <div class="form-group">
            <label for="include-previous-messages">
                <input type="checkbox" id="include-previous-messages" bind:checked={localConfig.includePreviousMessagesAsContext} />
                Include Previous Messages as Context
            </label>
        </div>

        <div class="form-group">
            <h4>Model Access</h4>
            {#if $creditStore.balance != null}
                <p>
                    Available:
                    {#if $creditStore.unit === 'dollars'}
                        ${$creditStore.balance.toFixed(2)}
                    {:else}
                        {$creditStore.balance} credits
                    {/if}
                </p>
            {/if}
        </div>



        <!------------------------------>
        <!-- Deep Research Configuration -->
        <!------------------------------>
    {:else if currentTab === "deep-research"}
        <div class="form-group">
            <label for="default-synthesis-prompt-select">Default Synthesis Prompt:</label>
            <select id="default-synthesis-prompt-select" bind:value={localConfig.defaultSynthesisPromptId}>
                {#each localConfig.synthesisPrompts as prompt}
                    <option value={prompt.id}>{prompt.name}</option>
                {/each}
            </select>
        </div>

        <button class="small" on:click={() => showSynthesisPromptEditor = !showSynthesisPromptEditor}>
            {showSynthesisPromptEditor ? 'Hide' : 'Manage'} Prompts
        </button>

        {#if showSynthesisPromptEditor}
            <div class="form-group">
                <label for="synthesis-prompt-select">Prompt to Edit:</label>
                <select id="synthesis-prompt-select" bind:value={currentSynthesisPromptIndex}>
                    {#each localConfig.synthesisPrompts as prompt, index (index)}
                        <option value={index}>{prompt.name}</option>
                    {/each}
                    <option value={-1}>New...</option>
                </select>
            </div>

            <div class="form-group prompt-editor">
                <div class="form-group">
                    <label for="synthesis-prompt-name">Name:</label>
                    <input type="text" id="synthesis-prompt-name" bind:value={currentSynthesisPromptName} />
                </div>

                <div class="form-group">
                    <label for="synthesis-prompt">Prompt:</label>
                    <textarea id="synthesis-prompt" bind:value={currentSynthesisPromptText} rows="4"></textarea>
                </div>

                <div class="form-group button-group">
                    <button on:click={deleteSynthesisPrompt} disabled={currentSynthesisPromptIndex === 0}>Delete</button>
                    <button on:click={discardSynthesisPrompt}>Discard</button>
                    <button on:click={saveSynthesisPrompt}>Save</button>
                </div>
            </div>
        {/if}

        <div class="form-group">
            <label for="deep-research-web-search-max-results">Deep Research Planning Max Web Search Results:</label>
            <input type="number" id="deep-research-web-search-max-results" bind:value={localConfig.deepResearchWebSearchMaxPlanningResults} min="1" />
        </div>

        <div class="form-group" title="The number of research phases to use.">
            <label for="deep-research-phases">Deep Research Phases:</label>
            <input type="number" id="deep-research-phases" bind:value={localConfig.deepResearchPhases} min="1" max="3" />
        </div>

        <div class="form-group">
            <label for="deep-research-max-subqrequests">Maximum Research Threads per Phase:</label>
            <input type="number" id="deep-research-max-subqrequests" bind:value={localConfig.deepResearchMaxSubqrequests} min="1" />
        </div>

        <div class="form-group">
            <label for="deep-research-web-requests-per-subrequest">Web Requests Per Research Thread:</label>
            <input
                type="number"
                id="deep-research-web-requests-per-subrequest"
                bind:value={localConfig.deepResearchWebRequestsPerSubrequest}
                min="0"
            />
        </div>

        <div class="form-group">
            <label for="deep-research-max-planning-tokens">Max Planning Tokens:</label>
            <input type="number" id="deep-research-max-planning-tokens" bind:value={localConfig.deepResearchMaxPlanningTokens} min="1" />
        </div>

        <div class="form-group">
            <label for="deep-research-max-synthesis-tokens">Max Synthesis Tokens:</label>
            <input type="number" id="deep-research-max-synthesis-tokens" bind:value={localConfig.deepResearchMaxSynthesisTokens} min="1" />
        </div>

        <div class="form-group">
            <label for="deep-research-planning-model">Planning Model:</label>
            <select id="deep-research-planning-model" bind:value={localConfig.deepResearchPlanningModel}>
                {#each availableModels as model}
                    <option value={model.id}>
                        {formatModelLabel(model)}
                    </option>
                {/each}
            </select>
        </div>

        <div class="form-group">
            <label for="deep-research-planning-effort">Planning Thinking Level:</label>
            <select id="deep-research-planning-effort" bind:value={localConfig.deepResearchPlanningEffort}>
                <option value="none">None</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="xhigh">Max</option>
            </select>
        </div>

        <div class="form-group">
            <label for="deep-research-research-model">Research Model:</label>
            <select id="deep-research-research-model" bind:value={localConfig.deepResearchResearchModel}>
                {#each availableModels as model}
                    <option value={model.id}>
                        {formatModelLabel(model)}
                    </option>
                {/each}
            </select>
        </div>

        <div class="form-group">
            <label for="deep-research-research-model">Research Model:</label>
            <select id="deep-research-research-model" bind:value={localConfig.deepResearchResearchModel}>
                {#each availableModels as model}
                    <option value={model.id}>
                        {formatModelLabel(model)}
                    </option>
                {/each}
            </select>
        </div>

        <div class="form-group">
            <label for="deep-research-refining-model">Refining Model:</label>
            <select id="deep-research-refining-model" bind:value={localConfig.deepResearchRefiningModel}>
                {#each availableModels as model}
                    <option value={model.id}>
                        {formatModelLabel(model)}
                    </option>
                {/each}
            </select>
        </div>

        <div class="form-group">
            <label for="deep-research-refining-effort">Refining Thinking Level:</label>
            <select id="deep-research-refining-effort" bind:value={localConfig.deepResearchRefiningEffort}>
                <option value="none">None</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="xhigh">Max</option>
            </select>
        </div>

        <div class="form-group">
            <label for="deep-research-synthesis-model">Synthesis Model:</label>
            <select id="deep-research-synthesis-model" bind:value={localConfig.deepResearchSynthesisModel}>
                {#each availableModels as model}
                    <option value={model.id}>
                        {formatModelLabel(model)}
                    </option>
                {/each}
            </select>
        </div>

        <div class="form-group">
            <label for="deep-research-synthesis-model">Synthesis Model:</label>
            <select id="deep-research-synthesis-model" bind:value={localConfig.deepResearchSynthesisModel}>
                {#each availableModels as model}
                    <option value={model.id}>
                        {formatModelLabel(model)}
                    </option>
                {/each}
            </select>
        </div>

        <div class="form-group">
            <label for="deep-research-synthesis-effort">Synthesis Thinking Level:</label>
            <select id="deep-research-synthesis-effort" bind:value={localConfig.deepResearchSynthesisEffort}>
                <option value="none">None</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="xhigh">Max</option>
            </select>
        </div>

        <div class="form-group">
            <div class="text-end" title="The estimated cost per deep research message">Estimated Cost:
                {#if estimatedDeepResearchCost === null}
                    Calculating...
                {:else if typeof estimatedDeepResearchCost === 'number'}
                    ${(estimatedDeepResearchCost + 0.005).toFixed(2)}
                {:else}
                    {estimatedDeepResearchCost}
                {/if}
            </div>
        </div>

        <!------------------------------>
        <!-- Config -->
        <!------------------------------>
    {:else if currentTab === "config"}
        <div class="form-group">
            <h4>Search Engine</h4>
            <label style="display: flex; align-items: center; gap: 0.3rem; white-space: nowrap;">
                Search Engine (selected text):
                <select bind:value={localConfig.searchEngine} style="width: auto;">
                    <option value="duckduckgo">DuckDuckGo</option>
                    <option value="kagi">Kagi</option>
                    <option value="brave">Brave</option>
                    <option value="bing">Bing</option>
                    <option value="google">Google</option>
                </select>
            </label>
        </div>

        <!------------------------------>
        <!-- Document Cache -->
        <!------------------------------>
        <div class="form-group">
            <h4>Document Cache</h4>
            {#if cacheStats}
                <p>Used: {(cacheStats.usedBytes / 1_000_000).toFixed(1)} MB / {(cacheStats.limitBytes / 1_000_000).toFixed(0)} MB ({cacheStats.entryCount} files)</p>
                <div class="form-group">
                    <label for="cache-limit">Cache Limit (MB):</label>
                    <input type="number" id="cache-limit" bind:value={cacheLimitMb} min="100" max="10000"
                        on:change={async () => {
                            const { setSizeLimit } = await import('./lib/docCache');
                            const saved = await setSizeLimit(cacheLimitMb * 1_000_000);
                            cacheLimitMb = saved / 1_000_000;
                            const { getCacheStats } = await import('./lib/docCache');
                            cacheStats = await getCacheStats();
                        }} />
                </div>
                {#if !pwaInstalled && cacheStats && cacheStats.usedBytes / cacheStats.limitBytes > 0.9}
                    <p class="help-text warning-text">Install the app for unlimited local storage.</p>
                {/if}
                <button class="btn btn-sm btn-outline-danger" on:click={handleClearCache}>Clear Cache</button>
            {:else}
                <p>Calculating...</p>
            {/if}
        </div>

        <!------------------------->
        <!-- Model Configuration -->
        <!------------------------->
    {:else if currentTab === "model"}
        <div class="form-group">
            <label for="api-key">API Key:</label>
            <input type="password" id="api-key" bind:value={localConfig.apiKey} />
        </div>

        <div class="form-group">
            <label for="default-model">Default Model:</label>
            <select id="default-model" bind:value={localConfig.defaultModel}>
                {#each availableModels as model}
                    <option value={model.id}>
                        {formatModelLabel(model)}
                    </option>
                {/each}
            </select>
            {#if modelFetchError}
                <div class="error">{modelFetchError}</div>
            {/if}
        </div>

        <div class="form-group">
            <label for="default-reasoning-model">Default "Reasoning" Model:</label>
            <select id="default-reasoning-model" bind:value={localConfig.defaultReasoningModel}>
                {#each availableModels as model}
                    <option value={model.id}>
                        {formatModelLabel(model)}
                    </option>
                {/each}
            </select>
        </div>

        <div class="form-group">
            <label for="default-reasoning-effort">Default Reasoning Effort:</label>
            <select id="default-reasoning-effort" bind:value={localConfig.defaultReasoningEffort}>
                <option value="none">None</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="xhigh">Max</option>
            </select>
        </div>

        <hr />
        <h4>Quick Question</h4>
        <div class="form-group">
            <label for="quick-question-model">Model:</label>
            <select id="quick-question-model" bind:value={localConfig.quickQuestionModel}>
                {#each availableModels as model}
                    <option value={model.id}>
                        {formatModelLabel(model)}
                    </option>
                {/each}
            </select>
        </div>
        <div class="form-group">
            <label for="quick-question-effort">Reasoning Effort:</label>
            <select id="quick-question-effort" bind:value={localConfig.quickQuestionReasoningEffort}>
                <option value="none">None</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="xhigh">Max</option>
            </select>
        </div>

        <div class="form-group">
            <h4>Available Models:</h4>
            <div class="filters">
                <div class="filter-container">
                    <input type="text" placeholder="Filter by name..." bind:value={modelFilter} class="filter-input" />
                    {#if modelFilter}
                        <button class="clear-button" on:click={() => (modelFilter = "")} aria-label="Clear filter">×</button>
                    {/if}
                </div>
            </div>
            <div class="model-list">
                {#each filteredModels as model}
                    <div class="row">
                        <div class="col">
                            <input type="checkbox" id={model.id} bind:checked={model.allowed} />
                            <label for={model.id} style="margin-right: 1rem;">
                                {model.name}
                                <span class="model-meta">
                                    — {formatContextLength(model.context_length)} context —
                                    ${(parseFloat(model.pricing.prompt) * 1_000_000).toFixed(2)}/${(parseFloat(model.pricing.completion) * 1_000_000).toFixed(2)}/M
                                </span>
                            </label>
                        </div>
                    </div>
                {/each}
            </div>
        </div>
    {:else if currentTab === "tools"}
            <div class="form-group" style="margin-left: 2rem;">
                <label>
                    <input type="checkbox" checked={localConfig.enabledTools.includes('scientific_calculator')}
                        on:change={(e) => {
                            const el = e.currentTarget as HTMLInputElement;
                            if (el.checked) localConfig.enabledTools = [...localConfig.enabledTools, 'scientific_calculator'];
                            else localConfig.enabledTools = localConfig.enabledTools.filter(t => t !== 'scientific_calculator');
                        }} />
                    <strong>Scientific Calculator</strong>
                    <p class="help-text">Evaluate mathematical expressions and numerical computations.</p>
                </label>
            </div>
            <div class="form-group" style="margin-left: 2rem;">
                <label>
                    <input type="checkbox" checked={localConfig.enabledTools.includes('wikipedia')}
                        on:change={(e) => {
                            const el = e.currentTarget as HTMLInputElement;
                            if (el.checked) localConfig.enabledTools = [...localConfig.enabledTools, 'wikipedia'];
                            else localConfig.enabledTools = localConfig.enabledTools.filter(t => t !== 'wikipedia');
                        }} />
                    <strong>Wikipedia</strong>
                    <p class="help-text">Search or fetch full articles from Wikipedia.</p>
                </label>
            </div>
            <div class="form-group" style="margin-left: 2rem;">
                <label>
                    <input type="checkbox" checked={localConfig.enabledTools.includes('catholic_encyclopedia_search')}
                        on:change={(e) => {
                            const el = e.currentTarget as HTMLInputElement;
                            if (el.checked) localConfig.enabledTools = [...localConfig.enabledTools, 'catholic_encyclopedia_search'];
                            else localConfig.enabledTools = localConfig.enabledTools.filter(t => t !== 'catholic_encyclopedia_search');
                        }} />
                    <strong>Catholic Encyclopedia Search</strong>
                    <p class="help-text">Search Catholic doctrine, history, saints, and theology.</p>
                </label>
            </div>
            <div class="form-group" style="margin-left: 2rem;">
                <label>
                    <input type="checkbox" checked={localConfig.enabledTools.includes('web_fetch')}
                        on:change={(e) => {
                            const el = e.currentTarget as HTMLInputElement;
                            if (el.checked) localConfig.enabledTools = [...localConfig.enabledTools, 'web_fetch'];
                            else localConfig.enabledTools = localConfig.enabledTools.filter(t => t !== 'web_fetch');
                        }} />
                    <strong>Web Page Fetch</strong>
                    <p class="help-text">Fetch and extract main content from any web page.</p>
                </label>
            </div>
            <div class="form-group" style="margin-left: 2rem;">
                <label>
                    <input type="checkbox" checked={localConfig.enabledTools.includes('pubmed_search')}
                        on:change={(e) => {
                            const el = e.currentTarget as HTMLInputElement;
                            if (el.checked) localConfig.enabledTools = [...localConfig.enabledTools, 'pubmed_search'];
                            else localConfig.enabledTools = localConfig.enabledTools.filter(t => t !== 'pubmed_search');
                        }} />
                    <strong>PubMed Search</strong>
                    <p class="help-text">Search biomedical and life sciences research papers.</p>
                </label>
            </div>
            <div class="form-group" style="margin-left: 2rem;">
                <label>
                    <input type="checkbox" checked={localConfig.enabledTools.includes('crossref_search')}
                        on:change={(e) => {
                            const el = e.currentTarget as HTMLInputElement;
                            if (el.checked) localConfig.enabledTools = [...localConfig.enabledTools, 'crossref_search'];
                            else localConfig.enabledTools = localConfig.enabledTools.filter(t => t !== 'crossref_search');
                        }} />
                    <strong>Crossref Search</strong>
                    <p class="help-text">Search preprints and papers across all disciplines.</p>
                </label>
            </div>
            <div class="form-group" style="margin-left: 2rem;">
                <label>
                    <input type="checkbox" checked={localConfig.enabledTools.includes('pubmed_fetch')}
                        on:change={(e) => {
                            const el = e.currentTarget as HTMLInputElement;
                            if (el.checked) localConfig.enabledTools = [...localConfig.enabledTools, 'pubmed_fetch'];
                            else localConfig.enabledTools = localConfig.enabledTools.filter(t => t !== 'pubmed_fetch');
                        }} />
                    <strong>PubMed Full-Text Fetch</strong>
                    <p class="help-text">Fetch full text of open-access biomedical articles.</p>
                </label>
            </div>
            <div class="form-group" style="margin-left: 2rem;">
                <label>
                    <input type="checkbox" checked={localConfig.enabledTools.includes('fetch_paper')}
                        on:change={(e) => {
                            const el = e.currentTarget as HTMLInputElement;
                            if (el.checked) localConfig.enabledTools = [...localConfig.enabledTools, 'fetch_paper'];
                            else localConfig.enabledTools = localConfig.enabledTools.filter(t => t !== 'fetch_paper');
                        }} />
                    <strong>Fetch Full Paper</strong>
                    <p class="help-text">Fetch full text of papers by DOI, arXiv ID, or URL.</p>
                </label>
            </div>
            <div class="form-group" style="margin-left: 2rem;">
                <label>
                    <input type="checkbox" checked={localConfig.enabledTools.includes('sep_search')}
                        on:change={(e) => {
                            const el = e.currentTarget as HTMLInputElement;
                            if (el.checked) localConfig.enabledTools = [...localConfig.enabledTools, 'sep_search'];
                            else localConfig.enabledTools = localConfig.enabledTools.filter(t => t !== 'sep_search');
                        }} />
                    <strong>Stanford Encyclopedia Search</strong>
                    <p class="help-text">Search and fetch articles from the Stanford Encyclopedia of Philosophy.</p>
                </label>
            </div>
            <div class="form-group" style="margin-left: 2rem;">
                <label>
                    <input type="checkbox" checked={localConfig.enabledTools.includes('fandom_search')}
                        on:change={(e) => {
                            const el = e.currentTarget as HTMLInputElement;
                            if (el.checked) localConfig.enabledTools = [...localConfig.enabledTools, 'fandom_search'];
                            else localConfig.enabledTools = localConfig.enabledTools.filter(t => t !== 'fandom_search');
                        }} />
                    <strong>Fandom Wiki Search</strong>
                    <p class="help-text">Search wikis for games, movies, TV shows, and entertainment.</p>
                </label>
            </div>
            <div class="form-group" style="margin-left: 2rem;">
                <label>
                    <input type="checkbox" checked={localConfig.enabledTools.includes('document_search')}
                        on:change={(e) => {
                            const el = e.currentTarget as HTMLInputElement;
                            if (el.checked) localConfig.enabledTools = [...localConfig.enabledTools, 'document_search'];
                            else localConfig.enabledTools = localConfig.enabledTools.filter(t => t !== 'document_search');
                        }} />
                    <strong>Document Search</strong>
                    <p class="help-text">Search within a fetched document for specific passages by query or regex.</p>
                </label>
            </div>
    {:else if currentTab === "cloud-sync"}
        <div class="form-group">
            <h4>Cloud Sync</h4>
            <p class="help-text">
                Sync your settings, topics, and credentials across devices using FindForge Cloud Storage.
                {#if !isSignedIn()}
                    <br/><strong>Sign in with Clerk to enable cloud sync.</strong>
                {/if}
            </p>
        </div>

        {#if isSignedIn()}
            <div class="form-group">
                {#if $cloudSyncStore.enabled}
                    <p>Status: <strong>Enabled</strong>
                        {#if $cloudSyncStore.lastSyncTime}
                            — Last synced: {new Date($cloudSyncStore.lastSyncTime!).toLocaleString()}
                        {/if}
                        {#if $cloudSyncStore.isSyncing}
                            — Syncing...
                        {/if}
                    </p>
                    {#if $cloudSyncStore.lastSyncError}
                        <p class="error">Last error: {$cloudSyncStore.lastSyncError}</p>
                    {/if}
                {:else}
                    <p>Status: <strong>Disabled</strong></p>
                {/if}
            </div>

            <div class="form-group">
                {#if $cloudSyncStore.enabled}
                    <button on:click={() => disableCloudSync()}>Disable Cloud Sync</button>
                {:else}
                    <button on:click={() => enableCloudSync()}>Enable Cloud Sync</button>
                {/if}
            </div>

            {#if $cloudSyncStore.enabled}
                <div class="form-group" style="display: flex; gap: 0.5rem;">
                    <button on:click={() => triggerManualSync().catch(err => alert('Sync failed: ' + err.message))}>Sync Now</button>
                    <button on:click={() => triggerCompleteResync().catch(err => alert('Full re-sync failed: ' + err.message))}>Full Re-sync</button>
                </div>
            {/if}
        {:else}
            <div class="form-group">
                <p>Cloud sync requires Clerk authentication. Please sign in.</p>
            </div>
        {/if}
    {/if}

    <div class="button-group">
        <button on:click={() => (isOpen = false)}>Cancel</button>
        <button on:click={save}>Save</button>
    </div>
</ModalDialog>

<style>
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

    button.small {
        padding: 0.25rem 0.5rem;
        margin-left: 0.5rem;
    }
    
    .prompt-editor {
        background-color: #333;
        padding: 1rem;
        border-radius: 4px;
    }

    .error {
        color: #ff6b6b;
        margin-top: 0.5rem;
        font-size: 0.9rem;
    }

    .model-meta {
        color: #999;
        font-size: 0.8rem;
    }

    .model-list {
        max-height: 450px;
        overflow-y: auto;
        border: 1px solid #ddd;
        border-radius: 4px;
        padding: 0.5rem;
        background-color: #333;
    }

    .filter-container {
        position: relative;
        display: flex;
        margin-bottom: 4px;
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

    h4 {
        margin-bottom: 0.3rem;
    }

    .help-text {
        padding: .5rem 1rem;
        border: 1px solid #aaa;
        border-radius: .3rem;
        margin-left: 1rem;
        margin-right: 1rem;
    }

    :global(.nav-tabs) {
        border-bottom: 1px solid #ddd !important;
    }
</style>
