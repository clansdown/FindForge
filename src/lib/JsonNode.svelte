<script lang="ts">
    import JsonNode from "./JsonNode.svelte";

    let {
        value,
        indent,
        collapsible,
        expandNewlines = true,
    }: {
        value: unknown;
        indent: number;
        collapsible: boolean;
        expandNewlines?: boolean;
    } = $props();

    let collapsed = $state(true);
    if (indent === 0 && collapsible) collapsed = false;

    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    const isExpandable = type === 'object' || type === 'array';

    if (isExpandable) {
        if (Array.isArray(value) && value.length === 1) collapsed = false;
        if (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 1) collapsed = false;
    }

    function toggle() {
        if (isExpandable) collapsed = !collapsed;
    }

    function formatPrimitive(v: unknown): string {
        if (v === null) return 'null';
        if (typeof v === 'string') {
            if (expandNewlines) return v;
            return JSON.stringify(v);
        }
        return String(v);
    }

    function summary(val: unknown): string {
        if (Array.isArray(val)) return `[${val.length} item${val.length === 1 ? '' : 's'}]`;
        if (typeof val === 'object' && val !== null) {
            const keys = Object.keys(val);
            return `{${keys.length} key${keys.length === 1 ? '' : 's'}}`;
        }
        return '';
    }
</script>

<div class="node">
    {#if isExpandable}
        <button class="toggle" onclick={toggle} onkeydown={(e) => e.key === 'Enter' && toggle()}>
            {collapsed ? '▶' : '▼'}
        </button>
        {#if collapsed}
            <button class="bracket collapsed-summary" onclick={toggle}>{summary(value)}</button>
        {:else}
            <span class="bracket">{Array.isArray(value) ? '[' : '{'}</span>
            <div class="children">
                {#if type === 'object'}
                    {#each Object.entries(value as Record<string, unknown>) as [key, val]}
                        <div class="entry">
                            <span class="key">"{key}"</span>
                            <span class="sep">: </span>
                            <JsonNode {collapsible} {expandNewlines} value={val} indent={indent + 1} />
                        </div>
                    {/each}
                {:else if type === 'array'}
                    {#each (value as Array<unknown>) as val, i (i)}
                        <div class="entry">
                            <span class="index">{i}</span>
                            <span class="sep">: </span>
                            <JsonNode {collapsible} {expandNewlines} value={val} indent={indent + 1} />
                        </div>
                    {/each}
                {/if}
            </div>
            <span class="bracket">{Array.isArray(value) ? ']' : '}'}</span>
        {/if}
    {:else}
        <span class="value type-{type}">{formatPrimitive(value)}</span>
    {/if}
</div>

<style>
    .node {
        font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
        font-size: 0.85rem;
        line-height: 1.6;
        display: flex;
        align-items: flex-start;
        flex-wrap: wrap;
    }
    .toggle {
        background: none;
        border: none;
        color: #8b949e;
        cursor: pointer;
        font-size: 0.7rem;
        padding: 0.35rem 0.25rem 0 0;
        width: 1.2em;
        text-align: center;
        flex-shrink: 0;
    }
    .toggle:hover {
        color: #e6edf3;
    }
    .bracket {
        color: #e6edf3;
        cursor: pointer;
        user-select: none;
        flex-shrink: 0;
        padding-top: 0.1rem;
    }
    .collapsed-summary:hover {
        background: rgba(255,255,255,0.05);
        border-radius: 3px;
    }
    .children {
        padding-left: 0.5rem;
        border-left: 1px solid #30363d;
        width: 100%;
    }
    .entry {
        display: flex;
        align-items: flex-start;
    }
    .key {
        color: #b392f0;
        flex-shrink: 0;
    }
    .index {
        color: #8b949e;
        flex-shrink: 0;
    }
    .sep {
        color: #e6edf3;
        margin-right: 0.25em;
        flex-shrink: 0;
    }
    .value {
        word-break: break-word;
    }
    .type-string { color: #9ecbff; white-space: pre-wrap; }
    .type-number { color: #79c0ff; }
    .type-boolean { color: #ffa657; }
    .type-null { color: #8b949e; }
</style>
