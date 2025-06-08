<script lang="ts">
    import ModalDialog from "./ModalDialog.svelte";
    import type { Resource, Annotation } from "./types";

    export let resources: Resource[] = [];
    export let annotations: Annotation[] = [];
    export let onClose: () => void;

    let filterResources = '';
    let filterAnnotations = '';

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

    function resourceMatches(resource: Resource, filterStr: string): boolean {
        filterStr = filterStr.toLowerCase();
        return (
            (resource.url && resource.url.toLowerCase().includes(filterStr)) ||
            (resource.title && resource.title.toLowerCase().includes(filterStr)) ||
            (resource.author && resource.author.toLowerCase().includes(filterStr)) ||
            (resource.date && resource.date.toLowerCase().includes(filterStr)) ||
            (resource.type && resource.type.toLowerCase().includes(filterStr)) ||
            (resource.summary && resource.summary.toLowerCase().includes(filterStr))
        );
    }

    function annotationMatches(annotation: Annotation, filterStr: string): boolean {
        if (annotation.type !== 'url_citation') return false;
        const uc = annotation.url_citation;
        filterStr = filterStr.toLowerCase();
        return (
            (uc.url && uc.url.toLowerCase().includes(filterStr)) ||
            (uc.title && uc.title.toLowerCase().includes(filterStr)) ||
            (uc.content && uc.content.toLowerCase().includes(filterStr))
        );
    }

    $: filteredResources = filterResources ? resources.filter(r => resourceMatches(r, filterResources)) : resources;
    $: filteredAnnotations = filterAnnotations ? annotations.filter(a => annotationMatches(a, filterAnnotations)) : annotations;
</script>

<ModalDialog isOpen={true} onClose={onClose}>
    <div class="resources">
        {#if resources.length === 0 && annotations.length === 0}
            <p>No resources found</p>
        {:else}
            {#if resources.length > 0}
                <div class="search-container">
                    <input 
                        type="text" 
                        placeholder="Filter resources..." 
                        bind:value={filterResources}
                        class="search-input"
                    />
                </div>
            {/if}

            {#if filteredResources.length > 0}
                <h2>Resources</h2>
                <ul>
                    {#each filteredResources as resource}
                        <li>
                            <div class="link-line">
                                <a href={resource.url} target="_blank" rel="noopener">
                                    {resource.title || resource.url}
                                </a>
                                <button class="copy-button" on:click={() => copyToClipboard(resource.url)}>📋</button>
                            </div>
                            <div class="meta">
                                <div class="row">
                                    <div class="col">
                                        {#if resource.type}
                                            <span class="type">{resource.type}</span>
                                        {/if}
                                        <span class="domain">({getDomain(resource.url)})</span>
                                        </div>
                                        <div class="colt text-end">
                                        {#if resource.date}
                                            <span class="date">{resource.date}</span>
                                        {/if}
                                    </div>
                                </div>
                                <div class="row">
                                    <div class="col">
                                        {#if resource.author}
                                            <span class="author">by {resource.author}</span>
                                        {/if}
                                    </div>
                                </div>

                            </div>
                            {#if resource.purpose}
                                <div class="purpose">{resource.purpose}</div>
                            {/if}
                            {#if resource.summary}
                                <p>{resource.summary}</p>
                            {:else}
                                <p>[No summary provided]</p>
                            {/if}
                        </li>
                    {/each}
                </ul>
            {/if}

            {#if annotations.length > 0}
                <div class="search-container">
                    <input 
                        type="text" 
                        placeholder="Filter web citations..." 
                        bind:value={filterAnnotations}
                        class="search-input"
                    />
                </div>
            {/if}

            {#if filteredAnnotations.length > 0}
                <h2>Web Citations</h2>
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
            {/if}

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
    .meta {
        color: #ccc;
        display: block;
        gap: 0.5rem;
        margin-top: 0.25rem;
    }
    .domain {
        color: #888;
    }
    p {
        margin: 0.5rem 0 0 1rem;
        color: #ccc;
    }
    .copy-button {
        padding: 0.25rem;
        font-size: 0.8rem;
    }
    .close-button-container {
        margin-top: 1rem;
        text-align: right;
    }

    h2 {
        font-size: 1.1rem;
        margin-top: 1.5rem;
        margin-bottom: 0.5rem;
        color: #4a9;
    }
</style>
