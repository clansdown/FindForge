<script lang="ts">
    import type { ToolCallProgress } from './types';

    export let progress: ToolCallProgress[];

    function linkify(text: string): string {
        return text.replace(
            /(https?:\/\/[^\s<]+)/g,
            '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
        );
    }
</script>

{#if progress && progress.length > 0}
    <div class="tool-call-progress">
        {#each progress as tc}
            <div class="tool-call-item {tc.status}">
                <span class="tc-icon">
                    {#if tc.status === 'running'}🔄
                    {:else if tc.status === 'completed'}✅
                    {:else if tc.status === 'error'}❌
                    {/if}
                </span>
                <span class="tc-name">{tc.displayName}</span>
                {#if tc.formattedArgs}
                    <span class="tc-args">{@html linkify(tc.formattedArgs)}</span>
                {/if}
                {#if tc.formattedResult}
                    <span class="tc-result-preview">{@html linkify(tc.formattedResult)}</span>
                {/if}
                {#if tc.durationMs}
                    <span class="tc-duration">({tc.durationMs}ms)</span>
                {/if}
            </div>
        {/each}
    </div>
{/if}

<style>
    .tool-call-progress {
        margin: 0.5rem 0;
        padding: 0.5rem;
        background: #1a1a1a;
        border-radius: 8px;
        border: 1px solid #333;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .tool-call-item {
        display: inline-flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 0.3em;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 0.85rem;
        line-height: 1.6;
        word-break: break-word;
    }
    .tc-icon { width: 1.2rem; text-align: center; flex-shrink: 0; }
    .tc-name { font-weight: bold; color: #ddd; }
    .tc-args { color: #999; font-size: 0.8rem; }
    .tc-duration { color: #666; font-size: 0.8rem; }
    .tc-result-preview { color: #aaa; font-size: 0.8rem; }
</style>
