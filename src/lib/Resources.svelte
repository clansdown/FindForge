<script lang="ts">
    import ModalDialog from "./ModalDialog.svelte";
    import type { Annotation } from "./types";

    export let annotations: Annotation[] = [];
    export let onClose: () => void;

    let filter = '';

    function getDomain(url: string): string {
        try {
            const u = new URL(url);
            return u.hostname;
        } catch (e) {
            return '';
        }
    }

    function copyToClipboard(text: string) {
        navigator.clipboard.writeText(text);
    }

    // Filter annotations by URL, title or content
    $: filteredAnnotations = filter ? annotations.filter(annotation => {
        if (annotation.type !== 'url_citation') return true;
        const uc = annotation.url_citation;
        const str = filter.toLowerCase();
        return (
            (uc.url && uc.url.toLowerCase().includes(str)) ||
            (uc.title && uc.title.toLowerCase().includes(str)) ||
            (uc.content && uc.content.toLowerCase().includes(str))
        );
    }) : annotations;
</script>

<ModalDialog isOpen={true} onClose={onClose}>
    <div class="resources">
        {#if annotations.length === 0}
            <p>No resources found</p>
        {:else}
            <div class="search-container">
                <input 
                    type="text" 
                    placeholder="Filter resources..." 
                    bind:value={filter}
                    class="search-input"
                />
            </div>
            <ul>
                {#each filteredAnnotations as annotation}
                    {#if annotation.type === 'url_citation'}
                        <li>
                            <div class="link-line">
                                <a href={annotation.url_citation.url} target="_blank" rel="noopener">
                                    {annotation.url_citation.title || annotation.url_citation.url}
                                </a>
                                <span class="domain">({getDomain(annotation.url_citation.url)})</span>
                                <button class="copy-button" on:click={() => copyToClipboard(annotation.url_citation.url)}>📋</button>
                            </div>
                            <p>{annotation.url_citation.content.slice(0, 200)}...</p>
                        </li>
                    {/if}
                {/each}
            </ul>
            <div class="close-button-container">
                <button on:click={onClose}>Close</button>
            </div>
        {/if}
    </div>
</ModalDialog>

<style>
    .resources {
        max-height: 60vh;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 1rem;
    }
    .search-container {
        margin-bottom: 1rem;
    }
    .search-input {
        width: 100%;
        padding: 0.5rem;
        border: 1px solid #444;
        border-radius: 4px;
        background-color: #222;
        color: #eee;
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
    .link-line {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
    }
    a {
        color: #4a9;
        text-decoration: none;
        font-weight: bold;
    }
    a:hover {
        text-decoration: underline;
    }
    .domain {
        color: #888;
        font-size: 0.8rem;
    }
    p {
        margin: 0.5rem 0 0;
        color: #aaa;
        font-size: 0.9rem;
    }
    .copy-button {
        padding: 0.25rem;
        font-size: 0.8rem;
    }
    .close-button-container {
        margin-top: 1rem;
        text-align: right;
    }
</style>
