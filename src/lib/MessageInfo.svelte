<script lang="ts">
    import ModalDialog from "./ModalDialog.svelte";
    import type { DeepResearchResult, ResearchResult, GenerationData, Annotation, ChatResult, ResearchThread } from "./types";
    import MarkdownIt from 'markdown-it';
    import { onMount } from 'svelte';

    export let researchResult: ResearchResult | undefined = undefined;
    export let deepResearchResult: DeepResearchResult | undefined = undefined;
    export let onClose: () => void;

    const md = new MarkdownIt();
    let copySuccess: string | null = null;
    let activeTab: 'overview' | 'plan' | 'threads' | 'synthesis' | 'annotations' = 'overview';
    let selectedThreadIndex = 0;
    let selectedThread: ResearchThread | null = null;

    $: {
        if (deepResearchResult) {
            if (selectedThreadIndex >= 0 && selectedThreadIndex < deepResearchResult.research_threads.length) {
                selectedThread = deepResearchResult.research_threads[selectedThreadIndex];
            } else {
                selectedThread = null;
            }
        } else {
            selectedThread = null;
        }
    }

    function formatCost(cost: number | undefined): string {
        if (cost === undefined) return "N/A";
        return `$${cost.toFixed(4)}`;
    }

    function formatTime(seconds: number): string {
        if (seconds < 60) {
            return `${seconds.toFixed(1)}s`;
        } else {
            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = seconds % 60;
            return `${minutes}m ${remainingSeconds.toFixed(1)}s`;
        }
    }

    function formatAnnotation(annotation: Annotation): string {
        if (annotation.type === 'url_citation') {
            return `URL Citation: <a href="${annotation.url_citation.url}" target="_blank" rel="noopener">${annotation.url_citation.url}</a> (${annotation.url_citation.title})`;
        }
        return `Unknown annotation type: ${annotation.type}`;
    }

    function formatChatContent(content: string): string {
        return md.render(content);
    }

    async function copyToClipboard(text: string, label: string) {
        try {
            await navigator.clipboard.writeText(text);
            copySuccess = `Copied ${label} to clipboard!`;
            setTimeout(() => copySuccess = null, 2000);
        } catch (err) {
            copySuccess = `Failed to copy ${label}`;
        }
    }

    function formatGenerationData(data: GenerationData | undefined): string {
        if (!data) return "N/A";
        return `Cost: ${formatCost(data.total_cost)}, Tokens: ${data.tokens_prompt || 0} in, ${data.tokens_completion || 0} out. Generation time: ${((data.generation_time || 0)/1000).toFixed(1)}s.`;
    }
</script>

<ModalDialog isOpen={true} onClose={onClose}>
    <div class="message-info">
        {#if deepResearchResult}
            <div class="info-section">
                <h1>Deep Research Details</h1>
                
                <div class="tabs">
                    <button class:active={activeTab === 'overview'} on:click={() => activeTab = 'overview'}>Overview</button>
                    <button class:active={activeTab === 'plan'} on:click={() => activeTab = 'plan'}>Plan</button>
                    <button class:active={activeTab === 'threads'} on:click={() => activeTab = 'threads'}>Threads</button>
                    <button class:active={activeTab === 'synthesis'} on:click={() => activeTab = 'synthesis'}>Synthesis</button>
                    <button class:active={activeTab === 'annotations'} on:click={() => activeTab = 'annotations'}>Annotations</button>
                </div>
                
                {#if activeTab === 'overview'}
                    <div class="tab-content">
                        <p><strong>Total Cost:</strong> {formatCost(deepResearchResult.total_cost)}</p>
                        <p><strong>Total Generation Time:</strong> {formatTime(deepResearchResult.total_generation_time)}</p>
                        <p><strong>Reasoning Model:</strong> {deepResearchResult.models.reasoning}</p>
                        <p><strong>Editor Model:</strong> {deepResearchResult.models.editor}</p>
                        <p><strong>Researcher Model:</strong> {deepResearchResult.models.researcher}</p>
                    </div>
                {:else if activeTab === 'plan'}
                    <div class="tab-content">
                        <div class="info-block">
                            <div class="chat-result">
                                <div class="chat-header">
                                    <h4>Plan Prompt</h4>
                                    <button on:click={() => copyToClipboard(deepResearchResult.plan_prompt, 'plan prompt')} class="copy-button">
                                        📋
                                    </button>
                                </div>
                                <div style="text-align: justify; padding: 0 1rem;">{deepResearchResult.plan_prompt}</div>
                                <p>{formatGenerationData(deepResearchResult.plan_result.generationData)}</p>
                                <h3>Plan Content</h3>
                                <div class="chat-content">
                                    {@html formatChatContent(deepResearchResult.plan_result.content)}
                                </div>
                            </div>
                        </div>
                    </div>
                {:else if activeTab === 'threads'}
                    <div class="tab-content">
                        <div class="info-block">
                            <select bind:value={selectedThreadIndex} class="thread-selector">
                                {#each deepResearchResult.research_threads as _, index (index)}
                                    <option value={index}>Thread {index + 1}</option>
                                {/each}
                            </select>
                            {#if selectedThread}
                                <div class="thread-block">
                                    <div class="chat-header">
                                        <h4>Prompt</h4>
                                        <button on:click={() => copyToClipboard(selectedThread!.prompt, `thread ${selectedThreadIndex+1} prompt`)} class="copy-button">
                                            📋
                                        </button>
                                    </div>
                                    <pre>{selectedThread.prompt}</pre>
                                    
                                    {#if selectedThread.firstPass}
                                        <div class="chat-result">
                                            <div class="chat-header">
                                                <h4>First Pass</h4>
                                                <button on:click={() => copyToClipboard(selectedThread!.firstPass?.content||'', `thread ${selectedThreadIndex+1} first pass`)} class="copy-button">
                                                    📋
                                                </button>
                                            </div>
                                            <p>{formatGenerationData(selectedThread.firstPass.generationData)}</p>
                                            <div class="chat-content">
                                                {@html formatChatContent(selectedThread.firstPass.content)}
                                            </div>
                                        </div>
                                    {/if}
                                    
                                    {#if selectedThread.refined}
                                        <div class="chat-result">
                                            <div class="chat-header">
                                                <h5>Refined</h5>
                                                <button on:click={() => copyToClipboard(selectedThread!.refined?.content||'', `thread ${selectedThreadIndex+1} refined`)} class="copy-button">
                                                    📋
                                                </button>
                                            </div>
                                            <p>{formatGenerationData(selectedThread.refined.generationData)}</p>
                                            <div class="chat-content">
                                                {@html formatChatContent(selectedThread.refined.content)}
                                            </div>
                                        </div>
                                    {/if}
                                </div>
                            {/if}
                        </div>
                    </div>
                {:else if activeTab === 'synthesis'}
                    <div class="tab-content">
                        <div class="info-block">
                            <div class="chat-result">
                                <div class="chat-header">
                                    <h4>Synthesis Prompt</h4>
                                    <button on:click={() => copyToClipboard(deepResearchResult.synthesis_prompt, 'synthesis prompt')} class="copy-button">
                                        📋
                                    </button>
                                </div>
                                <pre>{deepResearchResult.synthesis_prompt}</pre>
                                <p><strong>Generation Data:</strong> {formatGenerationData(deepResearchResult.synthesis_result.generationData)}</p>
                                <h4>Synthesis Content</h4>
                                <div class="chat-content">
                                    {@html formatChatContent(deepResearchResult.synthesis_result.content)}
                                </div>
                            </div>
                        </div>
                    </div>
                {:else if activeTab === 'annotations'}
                    <div class="tab-content">
                        {#if deepResearchResult.annotations && deepResearchResult.annotations.length > 0}
                            <div class="info-block">
                                <h4>Annotations</h4>
                                <ol>
                                    {#each deepResearchResult.annotations as annotation}
                                        <li>{@html formatAnnotation(annotation)}</li>
                                    {/each}
                                </ol>
                            </div>
                        {:else}
                            <p>No annotations found.</p>
                        {/if}
                    </div>
                {/if}
            </div>
        {:else if researchResult}
            <div class="info-section">
                <h3>Research Details</h3>
                <p><strong>Created:</strong> {new Date(researchResult.streamingResult.created * 1000).toLocaleString()}</p>
                <p><strong>Model:</strong> {researchResult.streamingResult.model}</p>
                {#if researchResult.generationData}
                    <p><strong>Total Cost:</strong> {formatCost(researchResult.generationData.total_cost)}</p>
                    <p><strong>Generation Time:</strong> {((researchResult.generationData.generation_time || 0)/1000).toFixed(1)}s</p>
                    <p><strong>Streamed:</strong> {researchResult.generationData.streamed ? 'Yes' : 'No'}</p>
                    <p><strong>Canceled:</strong> {researchResult.generationData.canceled ? 'Yes' : 'No'}</p>
                    <p><strong>Finish Reason:</strong> {researchResult.generationData.finish_reason}</p>
                {/if}
                {#if researchResult.systemPrompt}
                    <div class="info-block">
                        {#if researchResult.systemPromptName}
                            <p><strong>Prompt Name:</strong> {researchResult.systemPromptName}</p>
                        {/if}
                        <div class="chat-header">
                            <h4>System Prompt</h4>
                            <button on:click={() => copyToClipboard(researchResult.systemPrompt||'', 'system prompt')} class="copy-button">
                                📋
                            </button>
                        </div>
                        <pre>{researchResult.systemPrompt}</pre>
                    </div>
                {/if}

                {#if researchResult.streamingResult.annotations && researchResult.streamingResult.annotations.length > 0}
                    <div class="info-block">
                        <h4>Annotations</h4>
                        <ol>
                            {#each researchResult.streamingResult.annotations as annotation}
                                <li>{@html formatAnnotation(annotation)}</li>
                            {/each}
                        </ol>
                    </div>
                {/if}
            </div>
        {/if}
    </div>
</ModalDialog>

<style>
    .message-info {
        padding: 1rem;
        height: 90vh;
        overflow-y: auto;
    }
    .info-section {
        margin-bottom: 1.5rem;
    }
    .info-block {
        margin-top: 1rem;
    }
    .thread-block {
        margin-bottom: 2rem;
        padding: 1rem;
        background: #1a1a1a;
        border-radius: 8px;
    }
    .chat-result {
        margin-top: 1rem;
        padding: 1rem;
        background: #1a1a1a;
        border-radius: 8px;
    }
    .chat-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
    }
    .copy-button {
        background: none;
        border: none;
        color: #ccc;
        cursor: pointer;
        font-size: 1.2rem;
    }
    .chat-content {
        margin-top: 0.5rem;
        padding: 0.5rem;
        background: #222;
        border-radius: 4px;
    }
    h3 {
        margin-top: 0;
        border-bottom: 1px solid #444;
        padding-bottom: 0.5rem;
    }
    h4 {
        margin-bottom: 0.5rem;
    }
    h5 {
        margin: 0.5rem 0;
        font-size: 0.9rem;
    }
    pre {
        background: #222;
        padding: 0.5rem;
        margin-left: 0.6rem;
        border-radius: 4px;
        overflow-x: auto;
        white-space: pre-wrap;
        font-size: 0.8rem;
    }
    p {
        margin: 0.5rem 0;
    }
    ul {
        margin: 0.5rem 0;
        padding-left: 1rem;
    }
    li {
        margin: 0.25rem 0;
        font-size: 0.9rem;
    }
    .tabs {
        display: flex;
        margin-bottom: 1rem;
        border-bottom: 1px solid #444;
    }
    .tabs button {
        padding: 0.5rem 1rem;
        background: none;
        border: none;
        color: #ccc;
        cursor: pointer;
        font-size: 0.9rem;
    }
    .tabs button.active {
        border-bottom: 2px solid #4caf50;
        color: #fff;
    }
    .tab-content {
        margin-top: 1rem;
    }
    .thread-selector {
        background: #1a1a1a;
        color: #fff;
        border: 1px solid #444;
        border-radius: 4px;
        padding: 0.5rem;
        margin-bottom: 1rem;
        width: 100%;
    }
</style>
