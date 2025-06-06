<script lang="ts">
    import ModalDialog from "./ModalDialog.svelte";
    import type { Annotation } from "./types";

    export let annotations: Annotation[] = [];
    export let onClose: () => void;
</script>

<ModalDialog isOpen={true} onClose={onClose}>
    <div class="resources">
        {#if annotations.length === 0}
            <p>No resources found</p>
        {:else}
            <ul>
                {#each annotations as annotation}
                    {#if annotation.type === 'url_citation'}
                        <li>
                            <a href={annotation.url_citation.url} target="_blank" rel="noopener">
                                {annotation.url_citation.title || annotation.url_citation.url}
                            </a>
                            <p>{annotation.url_citation.content.slice(0, 200)}...</p>
                        </li>
                    {/if}
                {/each}
            </ul>
        {/if}
    </div>
</ModalDialog>

<style>
    .resources {
        max-height: 60vh;
        overflow-y: auto;
        padding: 1rem;
    }
    ul {
        list-style: none;
        padding: 0;
    }
    li {
        margin-bottom: 1rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid #444;
    }
    a {
        color: #4a9;
        text-decoration: none;
        font-weight: bold;
    }
    a:hover {
        text-decoration: underline;
    }
    p {
        margin: 0.5rem 0 0;
        color: #aaa;
        font-size: 0.9rem;
    }
</style>
