<script lang="ts">
    import ModalDialog from "./ModalDialog.svelte";
    import type { DeepResearchResult, ResearchResult, GenerationData } from "./types";

    export let researchResult: ResearchResult | undefined = undefined;
    export let deepResearchResult: DeepResearchResult | undefined = undefined;
    export let onClose: () => void;

    function formatCost(cost: number | undefined): string {
        if (cost === undefined) return "N/A";
        return `$${cost.toFixed(6)}`;
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
    h3 {
        margin-top: 0;
        border-bottom: 1px solid #444;
        padding-bottom: 0.5rem;
    }
    h4 {
        margin-bottom: 0.5rem;
    }
    pre {
        background: #222;
        padding: 0.5rem;
        border-radius: 4px;
        overflow-x: auto;
        white-space: pre-wrap;
    }
    p {
        margin: 0.5rem 0;
    }
</style>
