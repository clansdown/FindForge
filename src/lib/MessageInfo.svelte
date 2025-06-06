<script lang="ts">
    import ModalDialog from "./ModalDialog.svelte";
    import type { DeepResearchResult, StreamingResult, GenerationData } from "./types";

    export let info: DeepResearchResult | StreamingResult | null = null;
    export let generationData: GenerationData | undefined = undefined;
    export let onClose: () => void;

    function formatCost(cost: number | undefined): string {
        if (cost === undefined) return "N/A";
        return `$${cost.toFixed(6)}`;
    }
</script>

<ModalDialog title="Message Information" onClose={onClose}>
    <div class="message-info">
        {#if info}
            <div class="info-section">
                <h3>Research Details</h3>
                <p><strong>Total Cost:</strong> {formatCost(info.total_cost)}</p>
                
                {#if 'models' in info}
                    <p><strong>Reasoning Model:</strong> {info.models.reasoning}</p>
                    <p><strong>Editor Model:</strong> {info.models.editor}</p>
                    <p><strong>Researcher Model:</strong> {info.models.researcher}</p>
                {/if}
                
                {#if 'plan_prompt' in info && info.plan_prompt}
                    <div class="info-block">
                        <h4>Plan Prompt</h4>
                        <pre>{info.plan_prompt}</pre>
                    </div>
                {/if}
                
                {#if 'research_plan' in info && info.research_plan}
                    <div class="info-block">
                        <h4>Research Plan</h4>
                        <pre>{info.research_plan}</pre>
                    </div>
                {/if}
            </div>
        {:else if generationData}
            <div class="info-section">
                <h3>Generation Details</h3>
                <p><strong>Model:</strong> {generationData.model}</p>
                <p><strong>Total Cost:</strong> {formatCost(generationData.total_cost)}</p>
                <p><strong>Created:</strong> {new Date(generationData.created * 1000).toLocaleString()}</p>
                <p><strong>Streamed:</strong> {generationData.streamed ? 'Yes' : 'No'}</p>
                <p><strong>Canceled:</strong> {generationData.canceled ? 'Yes' : 'No'}</p>
                <p><strong>Finish Reason:</strong> {generationData.finish_reason}</p>
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
