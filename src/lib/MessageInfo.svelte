<script lang="ts">
    import ModalDialog from "./ModalDialog.svelte";
    import type { DeepResearchResult, ResearchResult, GenerationData, Annotation } from "./types";

    export let researchResult: ResearchResult | undefined = undefined;
    export let deepResearchResult: DeepResearchResult | undefined = undefined;
    export let onClose: () => void;

    function formatCost(cost: number | undefined): string {
        if (cost === undefined) return "N/A";
        return `$${cost.toFixed(6)}`;
    }

    function formatAnnotation(annotation: Annotation): string {
        if (annotation.type === 'url_citation') {
            return `URL Citation: ${annotation.url_citation.url} (${annotation.url_citation.title})`;
        }
        return `Unknown annotation type: ${annotation.type}`;
    }
</script>

<ModalDialog isOpen={true} onClose={onClose}>
    <div class="message-info">
        {#if deepResearchResult}
            <div class="info-section">
                <h3>Deep Research Details</h3>
                <p><strong>Total Cost:</strong> {formatCost(deepResearchResult.total_cost)}</p>
                
                <p><strong>Reasoning Model:</strong> {deepResearchResult.models.reasoning}</p>
                <p><strong>Editor Model:</strong> {deepResearchResult.models.editor}</p>
                <p><strong>Researcher Model:</strong> {deepResearchResult.models.researcher}</p>
                
                {#if deepResearchResult.plan_prompt}
                    <div class="info-block">
                        <h4>Plan Prompt</h4>
                        <pre>{deepResearchResult.plan_prompt}</pre>
                    </div>
                {/if}
                
                {#if deepResearchResult.research_plan}
                    <div class="info-block">
                        <h4>Research Plan</h4>
                        <pre>{deepResearchResult.research_plan}</pre>
                    </div>
                {/if}

                {#if deepResearchResult.sub_results && deepResearchResult.sub_results.length > 0}
                    <div class="info-block">
                        <h4>Sub Results (Raw)</h4>
                        {#each deepResearchResult.sub_results as result, index}
                            <div class="result-block">
                                <h5>Result {index + 1}</h5>
                                <pre>{result}</pre>
                            </div>
                        {/each}
                    </div>
                {/if}

                {#if deepResearchResult.refined_sub_results && deepResearchResult.refined_sub_results.length > 0}
                    <div class="info-block">
                        <h4>Refined Sub Results</h4>
                        {#each deepResearchResult.refined_sub_results as result, index}
                            <div class="result-block">
                                <h5>Result {index + 1}</h5>
                                <pre>{result}</pre>
                            </div>
                        {/each}
                    </div>
                {/if}

                {#if deepResearchResult.annotations && deepResearchResult.annotations.length > 0}
                    <div class="info-block">
                        <h4>Annotations</h4>
                        <ul>
                            {#each deepResearchResult.annotations as annotation}
                                <li>{formatAnnotation(annotation)}</li>
                            {/each}
                        </ul>
                    </div>
                {/if}
            </div>
        {:else if researchResult}
            <div class="info-section">
                <h3>Research Details</h3>
                <p><strong>Model:</strong> {researchResult.streamingResult.model}</p>
                <p><strong>Created:</strong> {new Date(researchResult.streamingResult.created * 1000).toLocaleString()}</p>
                {#if researchResult.generationData}
                    <p><strong>Total Cost:</strong> {formatCost(researchResult.generationData.total_cost)}</p>
                    <p><strong>Streamed:</strong> {researchResult.generationData.streamed ? 'Yes' : 'No'}</p>
                    <p><strong>Canceled:</strong> {researchResult.generationData.canceled ? 'Yes' : 'No'}</p>
                    <p><strong>Finish Reason:</strong> {researchResult.generationData.finish_reason}</p>
                {/if}

                {#if researchResult.streamingResult.annotations && researchResult.streamingResult.annotations.length > 0}
                    <div class="info-block">
                        <h4>Annotations</h4>
                        <ul>
                            {#each researchResult.streamingResult.annotations as annotation}
                                <li>{formatAnnotation(annotation)}</li>
                            {/each}
                        </ul>
                    </div>
                {/if}
            </div>
        {/if}
    </div>
</ModalDialog>

<style>
    .message-info {
        padding: 1rem;
        max-height: 60vh;
        overflow-y: auto;
    }
    .info-section {
        margin-bottom: 1.5rem;
    }
    .info-block {
        margin-top: 1rem;
    }
    .result-block {
        margin-top: 0.5rem;
        margin-bottom: 1rem;
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
</style>
