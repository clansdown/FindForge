<script lang="ts">
    import { saveConfig, setLocalPreference } from "./lib/storage";
    import { Config, type Model, type OpenRouterCredits } from "./lib/types";
    import { onDestroy, onMount } from "svelte";
    import { getModels } from "./lib/models";
    import ModalDialog from "./lib/ModalDialog.svelte";
    import { generateID } from "./lib/util";
    import { estimateDeepResearchCost } from "./lib/deep_research";
    import { initGoogleDrive, setupGoogleDriveAuthentication, listDriveFiles, readDriveFile } from "./lib/google_drive";
    import { getLocalPreference } from "./lib/storage";

    export let config: Config;
    export let isOpen: boolean = false;
    export let credits: OpenRouterCredits | undefined;

    import ToggleSwitch from "./lib/ToggleSwitch.svelte";

    let localConfig: Config = new Config();
    let openrouterModels: Model[] = [];
    let availableModels: Model[] = [];
    let modelFetchError: string | null = null;
    let currentTab: "general" | "model" | "deep-research" | "cloud-storage" = config.apiKey ? "general" : "model";
    let modelFilter = "";
    let showFreeModels = false;
    let estimatedDeepResearchCost: number | string | null = null;
    let showPromptEditor: boolean = false;
    let showSynthesisPromptEditor: boolean = false;
    let isGoogleDriveSetup: boolean = false;
    let showDisconnectConfirmation: boolean = false;
    let currentSystemPromptIndex: number = 0;
    let currentSystemPromptName: string = '';
    let currentSystemPromptText: string = '';
    let currentSynthesisPromptIndex: number = 0;
    let currentSynthesisPromptName: string = '';
    let currentSynthesisPromptText: string = '';
    let googleDriveFiles: any[] = [];

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
        checkGoogleDriveSetup();
        loadGoogleDriveFiles();
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

    function checkGoogleDriveSetup() {
        const savedCredentials = getLocalPreference<any>("googleDriveCredentials", null);
        isGoogleDriveSetup = savedCredentials !== null;
    }

    async function loadGoogleDriveFiles() {
        if (isGoogleDriveSetup) {
            try {
                googleDriveFiles = await listDriveFiles();
            } catch (error) {
                console.error("Failed to load Google Drive files:", error);
                googleDriveFiles = [];
            }
        } else {
            googleDriveFiles = [];
        }
    }

    async function setupGoogleDrive() {
        try {
            await initGoogleDrive();
            await setupGoogleDriveAuthentication();
            checkGoogleDriveSetup();
            await loadGoogleDriveFiles();
        } catch (error) {
            console.error("Failed to setup Google Drive:", error);
            alert("Failed to setup Google Drive. Please try again.");
        }
    }

    async function copyToLocalStorage() {
        try {
            // List files from Google Drive
            const files = await listDriveFiles();
            if (files.length === 0) {
                alert("No files found in Google Drive to copy.");
                return;
            }

            // For each file, read its content and save to local storage
            for (const file of files) {
                if (file.mimeType === 'text/plain') {
                    const content = await readDriveFile(file.id);
                    setLocalPreference(file.name, content);
                }
            }
            alert("Data copied from Google Drive to local storage.");
        } catch (error) {
            console.error("Failed to copy data from Google Drive:", error);
            alert("Failed to copy data from Google Drive. Please try again.");
        }
    }

    function disconnectGoogleDrive() {
        showDisconnectConfirmation = true;
    }

    function confirmDisconnect() {
        setLocalPreference("googleDriveCredentials", null);
        isGoogleDriveSetup = false;
        showDisconnectConfirmation = false;
        alert("Google Drive has been disconnected.");
    }

    function cancelDisconnect() {
        showDisconnectConfirmation = false;
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
        Object.assign(config, localConfig);
        saveConfig(config);
        config = config; // trigger reactivity
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
        <li class="nav-item" class:active={currentTab === "cloud-storage"}>
            <a class="nav-link" href="#" on:click={() => (currentTab = "cloud-storage")}>Cloud Storage</a>
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

        <button class="small" on:click={() => showPromptEditor = !showPromptEditor}>
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

        <div class="form-group">
            <label for="deep-research-planning-model">Planning Model:</label>
            <select id="deep-research-planning-model" bind:value={localConfig.deepResearchPlanningModel}>
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
            <label for="deep-research-research-model">Research Model:</label>
            <select id="deep-research-research-model" bind:value={localConfig.deepResearchResearchModel}>
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
            <label for="deep-research-refining-model">Refining Model:</label>
            <select id="deep-research-refining-model" bind:value={localConfig.deepResearchRefiningModel}>
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
            <label for="deep-research-synthesis-model">Synthesis Model:</label>
            <select id="deep-research-synthesis-model" bind:value={localConfig.deepResearchSynthesisModel}>
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
            <label for="default-reasoning-model">Default "Reasoning" Model:</label>
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
            <label for="default-reasoning-effort">Default Reasoning Effort:</label>
            <select id="default-reasoning-effort" bind:value={localConfig.defaultReasoningEffort}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
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
    {:else if currentTab === "cloud-storage"}
        <div class="form-group">
            <p class="help-text">
                Set up cloud storage to share settings, conversations, and other data between devices.
            </p>
            <h4>Google Drive</h4>
            {#if !isGoogleDriveSetup}
                <button class="btn btn-primary" on:click={setupGoogleDrive}>Set Up Google Drive</button>
            {:else}
                <div class="button-group">
                    <button on:click={copyToLocalStorage}>Copy to Local Storage</button>
                    <button on:click={disconnectGoogleDrive}>Disconnect Google Drive</button>
                </div>
                {#if showDisconnectConfirmation}
                    <div class="confirmation">
                        <p>Are you sure you want to disconnect Google Drive? This will not delete any data on Google Drive.</p>
                        <div class="button-group">
                            <button on:click={cancelDisconnect}>Cancel</button>
                            <button on:click={confirmDisconnect}>Confirm</button>
                        </div>
                    </div>
                {/if}
                <div class="file-list">
                    <h5>Files in Google Drive:</h5>
                    {#if googleDriveFiles.length > 0}
                        <ul>
                            {#each googleDriveFiles as file}
                                <li>{file.name} (Last modified: {file.modifiedTime})</li>
                            {/each}
                        </ul>
                    {:else}
                        <p>No files found in Google Drive.</p>
                    {/if}
                </div>
            {/if}
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

    .confirmation {
        margin-top: 1rem;
        padding: 1rem;
        background-color: #444;
        border-radius: 4px;
    }

    .file-list {
        margin-top: 1rem;
        padding: 1rem;
        background-color: #333;
        border-radius: 4px;
        max-height: 300px;
        overflow-y: auto;
    }

    .file-list h5 {
        margin-top: 0;
    }

    .file-list ul {
        list-style-type: none;
        padding: 0;
    }

    .file-list li {
        padding: 0.5rem 0;
        border-bottom: 1px solid #444;
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

    .help-text {
        padding: .5rem 1rem;
        border: 1px solid #aaa;
        border-radius: .3rem;
        margin-left: 1rem;
        margin-right: 1rem;
    }
</style>
