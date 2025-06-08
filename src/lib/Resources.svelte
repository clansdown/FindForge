<script lang="ts">
    import ModalDialog from "./ModalDialog.svelte";
    import type { Resource, Annotation } from "./types";

    export let resources: Resource[] = [];
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

    function resourcesFromAnnotations(annotations: Annotation[]): Resource[] {
        return annotations
            .filter(annotation => annotation.type === 'url_citation')
            .map(annotation => {
                const uc = annotation.url_citation;
                return {
                    url: uc.url,
                    title: uc.title,
                    author: undefined,
                    date: undefined,
                    type: 'web citation',
                    summary: uc.content
                };
            });
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
        ) == true;
    }

    $: annotationResources = resourcesFromAnnotations(annotations);
    $: filteredResources = filter ? resources.filter(r => resourceMatches(r, filter)) : resources;
    $: filteredAnnotationResources = filter ? annotationResources.filter(r => resourceMatches(r, filter)) : annotationResources;
</script>

<ModalDialog isOpen={true} onClose={onClose}>
    <div class="resources">
        {#if resources.length === 0 && annotations.length === 0}
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

            {#if filteredResources.length > 0}
                <h2>Resources</h2>
                <ul>
                    {#each filteredResources as resource}
                        <li>
                            <div class="link-line">
                                <a href={resource.url} target="_blank" rel="noopener">
                                    {resource.title || resource.url}
                                </a>
                                <span class="domain">({getDomain(resource.url)})</span>
                                <button class="copy-button" on:click={() => copyToClipboard(resource.url)}>📋</button>
                            </div>
                            {#if resource.summary}
                                <p>{resource.summary}</p>
                            {:else}
                                <p>[No summary provided]</p>
                            {/if}
                            <div class="meta">
                                {#if resource.author}
                                    <span class="author">{resource.author}</span>
                                {/if}
                                {#if resource.date}
                                    <span class="date">{resource.date}</span>
                                {/if}
                                {#if resource.type}
                                    <span class="type">{resource.type}</span>
                                {/if}
                            </div>
                        </li>
                    {/each}
                </ul>
            {/if}

            {#if filteredAnnotationResources.length > 0}
                <h2>Web Citations</h2>
                <ul>
                    {#each filteredAnnotationResources as resource}
                        <li>
                            <div class="link-line">
                                <a href={resource.url} target="_blank" rel="noopener">
                                    {resource.title || resource.url}
                                </a>
                                <span class="domain">({getDomain(resource.url)})</span>
                                <button class="copy-button" on:click={() => copyToClipboard(resource.url)}>📋</button>
                            </div>
                            {#if resource.summary}
                                <p>{resource.summary}</p>
                            {:else}
                                <p>[No summary provided]</p>
                            {/if}
                            <div class="meta">
                                {#if resource.author}
                                    <span class="author">{resource.author}</span>
                                {/if}
                                {#if resource.date}
                                    <span class="date">{resource.date}</span>
                                {/if}
                                {#if resource.type}
                                    <span class="type">{resource.type}</span>
                                {/if}
                            </div>
                        </li>
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
    .meta {
        font-size: 0.75rem;
        color: #888;
        display: flex;
        gap: 0.5rem;
        margin-top: 0.25rem;
    }

    h2 {
        font-size: 1.1rem;
        margin-top: 1.5rem;
        margin-bottom: 0.5rem;
        color: #4a9;
    }
</style>
