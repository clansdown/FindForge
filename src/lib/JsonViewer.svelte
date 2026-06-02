<script lang="ts">
    import JsonNode from "./JsonNode.svelte";

    let { json, expandNewlines = true }: { json: string; expandNewlines?: boolean } = $props();

    let parsed = $state<unknown>(undefined);
    let parseError = $state(false);
    try {
        parsed = JSON.parse(json);
    } catch {
        parseError = true;
    }
</script>

{#if parseError}
    <pre class="json-fallback">{json}</pre>
{:else}
    <div class="json-tree">
        <JsonNode collapsible={true} {expandNewlines} value={parsed} indent={0} />
    </div>
{/if}

<style>
    .json-tree {
        font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
        font-size: 0.85rem;
        line-height: 1.5;
        overflow-x: auto;
        padding: 0.5rem 0;
    }
    .json-fallback {
        font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
        font-size: 0.85rem;
        white-space: pre-wrap;
        word-break: break-word;
        margin: 0;
        padding: 0.5rem;
        background: #0d1117;
        border: 1px solid #30363d;
        border-radius: 6px;
    }
</style>
