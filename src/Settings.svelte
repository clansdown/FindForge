<script lang="ts">
    import { saveConfig } from "./lib/storage";
    import { Config, type Model, type OpenRouterCredits } from "./lib/types";
    import { onDestroy, onMount } from "svelte";
    import { getModels } from "./lib/models";
    import ModalDialog from "./lib/ModalDialog.svelte";
    import { generateID } from "./lib/util";

    export let config: Config;
    export let isOpen: boolean = false;
    export let credits: OpenRouterCredits | undefined;

    import ToggleSwitch from "./lib/ToggleSwitch.svelte";

    let localConfig: Config = new Config();
    let openrouterModels: Model[] = [];
    let availableModels: Model[] = [];
    let modelFetchError: string | null = null;
    let currentTab: "general" | "model" | "deep-research" = config.apiKey ? "general" : "model";
    let modelFilter = "";
    let showFreeModels = false;

    $: remainingCredits = credits ? credits.total_credits - credits.total_usage : -1;

    $: filteredModels = (
        modelFilter
            ? openrouterModels.filter(
                  (model) =>
                      model.name.toLowerCase().includes(modelFilter.toLowerCase()) || model.id.toLowerCase().includes(modelFilter.toLowerCase()),
              )
            : openrouterModels
    ).filter((model) => {
        if (showFreeModels) {
            return parseFloat(model.pricing.prompt) === 0 && parseFloat(model.pricing.completion) === 0;
        } else {
            return parseFloat(model.pricing.prompt) > 0 || parseFloat(model.pricing.completion) > 0;
        }
    });

    $: availableModels = calculateAvailableModelsFromConfig(localConfig.availableModels, openrouterModels);

    $: if (isOpen) {
        opened();
    }

    function opened() {
        console.log("Settings dialog opened");
        // Create a deep copy when dialog opens
        localConfig = JSON.parse(JSON.stringify(config));
        // Fetch models when dialog opens
        modelFetchError = null;
        if (config.apiKey) {
            getModels(config)
                .then((models) => {
                    models.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
                    openrouterModels = models.map((model) => ({
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
        localConfig = localConfig;
    }

    function save() {
        setAvailableModelsConfig(openrouterModels);
        Object.assign(config, localConfig);
        saveConfig(config);
        isOpen = false;
    }
</script>

<ModalDialog on:close={() => (isOpen = false)} {isOpen}>
    <h2>Settings</h2>

    <ul class="nav nav-tabs">
        <li class="nav-item" class:active={currentTab === "general"}>
            <a class="nav-link" href="#" on:click={() => (currentTab = "general")}>Research</a>
        </li>
        <li class="nav-item" class:active={currentTab === "deep-research"}>
            <a class="nav-link" href="#" on:click={() => (currentTab = "deep-research")}>Deep Research</a>
        </li>
        <li class="nav-item" class:active={currentTab === "model"}>
            <a class="nav-link" href="#" on:click={() => (currentTab = "model")}>Models</a>
        </li>
    </ul>

    <!---------------------------->
    <!-- Research Configuration -->
    <!---------------------------->
    {#if currentTab === "general"}
        <div class="form-group">
            <label for="system-prompt">System Prompt:</label>
            <textarea id="system-prompt" bind:value={localConfig.systemPrompt} rows="4"></textarea>
        </div>

        <div class="form-group">
            <label for="allow-web-search">
                <input type="checkbox" id="allow-web-search" bind:checked={localConfig.allowWebSearch} />
                Allow Web Search
            </label>
        </div>

        <div class="form-group">
            <label for="web-search-max-results">Web Search Max Results:</label>
            <input type="number" id="web-search-max-results" bind:value={localConfig.webSearchMaxResults} min="1" />
        </div>

        <div class="form-group">
            <label for="include-previous-messages">
                <input type="checkbox" id="include-previous-messages" bind:checked={localConfig.includePreviousMessagesAsContext} />
                Include Previous Messages as Context
            </label>
        </div>

        <div class="form-group">
            <label for="search-engine">Search Engine:</label>
            <select id="search-engine" bind:value={localConfig.searchEngine}>
                <option value="duckduckgo">DuckDuckGo</option>
                <option value="kagi">Kagi</option>
                <option value="brave">Brave</option>
                <option value="bing">Bing</option>
                <option value="google">Google</option>
            </select>
        </div>

        <!------------------------------>
        <!-- Deep Research Configuration -->
        <!------------------------------>
    {:else if currentTab === "deep-research"}
        <div class="form-group">
            <label for="deep-research-system-prompt">Deep Research System Prompt:</label>
            <textarea
                id="deep-research-system-prompt"
                bind:value={localConfig.deepResearchSystemPrompt}
                rows="4"
                placeholder="Optional. Specify special instructions for the LLM..."
            ></textarea>
        </div>

        <div class="form-group">
            <label for="deep-research-web-search-max-results">Deep Research Planning Max Web Search Results:</label>
            <input type="number" id="deep-research-web-search-max-results" bind:value={localConfig.deepResearchWebSearchMaxPlanningResults} min="1" />
        </div>

        <div class="form-group">
            <label for="deep-research-max-subqrequests">Maximum Research Threads:</label>
            <input type="number" id="deep-research-max-subqrequests" bind:value={localConfig.deepResearchMaxSubqrequests} min="1" />
        </div>

        <div class="form-group">
            <label for="deep-research-web-requests-per-subrequest">Web Requests Per Research Thread:</label>
            <input
                type="number"
                id="deep-research-web-requests-per-subrequest"
                bind:value={localConfig.deepResearchWebRequestsPerSubrequest}
                min="1"
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
                        {model.name}
                        (In: ${(parseFloat(model.pricing.prompt) * 1000000).toFixed(2)}/M, Out: ${(
                            parseFloat(model.pricing.completion) * 1000000
                        ).toFixed(2)}/M)
                    </option>
                {/each}
            </select>
            {#if modelFetchError}
                <div class="error">{modelFetchError}</div>
            {/if}
        </div>

        <div class="form-group">
            <label for="default-reasoning-model">Default Reasoning Model:</label>
            <select id="default-reasoning-model" bind:value={localConfig.defaultReasoningModel}>
                {#each availableModels as model}
                    <option value={model.id}>
                        {model.name}
                        (In: ${(parseFloat(model.pricing.prompt) * 1000000).toFixed(2)}/M, Out: ${(
                            parseFloat(model.pricing.completion) * 1000000
                        ).toFixed(2)}/M)
                    </option>
                {/each}
            </select>
        </div>

        <div class="form-group">
            <h4>Available Models:</h4>
            <div class="filters">
                <div class="price-filters">
                    <ToggleSwitch bind:checked={showFreeModels}>
                        Free
                        <span slot="front">Paid</span>
                    </ToggleSwitch>
                </div>
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
                            <label for={model.id} style="margin-right: 1rem;"
                                >{model.name}
                                (In: ${(parseFloat(model.pricing.prompt) * 1000000).toFixed(2)}/M, Out: ${(
                                    parseFloat(model.pricing.completion) * 1000000
                                ).toFixed(2)}/M)
                            </label>
                        </div>
                    </div>
                {/each}
            </div>
        </div>
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
</style>
