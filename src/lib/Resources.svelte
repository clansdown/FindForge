<script lang="ts">
    import ModalDialog from "./ModalDialog.svelte";
    import type { Resource, Annotation } from "./types";

    export let resources: Resource[] = [];
    export let annotations: Annotation[] = [];
    export let onClose: () => void;

    let filterResources = '';
    let mergedResources: Resource[] = [];
    let mergedAnnotations: Annotation[] = [];
    let filterAnnotations = '';
    let resourceSort: 'unsorted' | 'type' | 'purpose' | 'author' | 'domain' | 'date' | 'title' = 'unsorted';
    let activeTab: 'resources' | 'annotations' = resources.length > 0 ? 'resources' : 'annotations';

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
        ) == true;
    }

    function annotationMatches(annotation: Annotation, filterStr: string): boolean {
        if (annotation.type !== 'url_citation') return false;
        const uc = annotation.url_citation;
        filterStr = filterStr.toLowerCase();
        return (
            (uc.url && uc.url.toLowerCase().includes(filterStr)) ||
            (uc.title && uc.title.toLowerCase().includes(filterStr)) ||
            (uc.content && uc.content.toLowerCase().includes(filterStr))
        ) == true;
    }

    function sortResources(resources: Resource[], criteria: typeof resourceSort): Resource[] {
        if (criteria === 'unsorted') {
            return [...resources];
        }
        return [...resources].sort((a, b) => {
            switch (criteria) {
                case 'type': return (a.type || '').localeCompare(b.type || '');
                case 'purpose': return (a.purpose || '').localeCompare(b.purpose || '');
                case 'author': return (a.author || '').localeCompare(b.author || '');
                case 'domain': return getDomain(a.url).localeCompare(getDomain(b.url));
                case 'date': return (a.date || '').localeCompare(b.date || '');
                case 'title': return (a.title || '').localeCompare(b.title || '');
                default: return 0;
            }
        });
    }

    function mergeResources(input: Resource[]): Resource[] {
        const urlMap = new Map<string, Resource>();
        for (const resource of input) {
            const existing = urlMap.get(resource.url);
            if (!existing) {
                urlMap.set(resource.url, {...resource});
                continue;
            }

            // Merge properties
            if (resource.title && (!existing.title || resource.title.length > existing.title.length)) {
                existing.title = resource.title;
            }
            if (resource.author && !existing.author?.includes(resource.author)) {
                existing.author = existing.author 
                    ? `${existing.author}, ${resource.author}`
                    : resource.author;
            }
            if (resource.purpose) {
                existing.purpose = existing.purpose 
                    ? `${existing.purpose} / ${resource.purpose}`
                    : resource.purpose;
            }
            if (resource.summary) {
                existing.summary = existing.summary 
                    ? `${existing.summary}... ${resource.summary}`
                    : resource.summary;
            }
            // Keep earliest date if exists
            if (resource.date && (!existing.date || resource.date < existing.date)) {
                existing.date = resource.date;
            }
            if (resource.type && !existing.type?.includes(resource.type)) {
                existing.type = existing.type 
                    ? `${existing.type}, ${resource.type}`
                    : resource.type;
            }
        }
        return Array.from(urlMap.values());
    }

    function mergeAnnotations(input: Annotation[]): Annotation[] {
        const urlMap = new Map<string, Annotation>();
        for (const annotation of input) {
            if (annotation.type !== 'url_citation') continue;
            
            const url = annotation.url_citation.url;
            const existing = urlMap.get(url);
            if (!existing) {
                urlMap.set(url, {...annotation});
                continue;
            }
            console.log(`Merging annotation for ${url}`, existing, annotation);

            // Merge properties
            if (annotation.url_citation.title && (
                !existing.url_citation.title || 
                annotation.url_citation.title.length > existing.url_citation.title.length
            )) {
                existing.url_citation.title = annotation.url_citation.title;
            }
            const originalContent = existing.url_citation.content || '';
            const additionalContent = annotation.url_citation.content || '';
            
            if (originalContent.includes(additionalContent)) {
                // Existing content already contains the new content - keep original
                existing.url_citation.content = originalContent;
            } else if (additionalContent.includes(originalContent)) {
                // New content contains existing content - replace
                existing.url_citation.content = additionalContent;
            } else {
                // Neither contains the other - concatenate
                existing.url_citation.content = originalContent 
                    ? `${originalContent}... ${additionalContent}`
                    : additionalContent;
            }
        }
        return Array.from(urlMap.values());
    }

    $: mergedResources = mergeResources(resources);
    $: mergedAnnotations = mergeAnnotations(annotations);
    $: filteredResources = filterResources ? mergedResources.filter(r => resourceMatches(r, filterResources)) : mergedResources;
    $: sortedResources = sortResources(filteredResources, resourceSort);
    $: filteredAnnotations = filterAnnotations ? mergedAnnotations.filter(a => annotationMatches(a, filterAnnotations)) : mergedAnnotations;
</script>

<ModalDialog isOpen={true} scrollOverflow={false} onClose={onClose}>
    <div class="resources">
        <div class="tabs">
            {#if resources.length > 0}
                <button class:active={activeTab === 'resources'} on:click={() => activeTab = 'resources'}>Resources Used</button>
            {/if}
            {#if annotations.length > 0}
                <button class:active={activeTab === 'annotations'} on:click={() => activeTab = 'annotations'}>Annotations</button>
            {/if}
        </div>

        {#if resources.length === 0 && annotations.length === 0}
            <p>No resources found</p>
        {:else}
            {#if activeTab === 'resources' && resources.length > 0}
                <div class="tab-panel">
                    <div class="search-container">
                        <input 
                            type="text" 
                            placeholder="Filter resources..." 
                            bind:value={filterResources}
                            class="search-input"
                        />
                        <select bind:value={resourceSort} class="sort-select">
                            <option value="unsorted">Unsorted</option>
                            <option value="type">Type</option>
                            <option value="purpose">Purpose</option>
                            <option value="author">Author</option>
                            <option value="domain">Domain</option>
                            <option value="date">Date</option>
                            <option value="title">Title</option>
                        </select>
                    </div>
                    {#if sortedResources.length > 0}
                        <div class="resource-list">
                            <ul class="resource-list">
                                {#each sortedResources as resource}
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
                        </div>
                    {/if}
                </div>
            {:else if activeTab === 'annotations' && annotations.length > 0}
                <div class="tab-panel">
                    <div class="search-container sticky">
                        <input 
                            type="text" 
                            placeholder="Filter web citations..." 
                            bind:value={filterAnnotations}
                            class="search-input"
                        />
                    </div>
                    {#if filteredAnnotations.length > 0}
                        <div class="resource-list">
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
                                            <p>{annotation.url_citation.content}</p>
                                        </li>
                                    {/if}
                                {/each}
                            </ul>
                        </div>
                    {/if}
                </div>
            {/if}

            <div class="close-button-container">
                <button on:click={onClose}>Close</button>
            </div>
        {/if}
    </div>
</ModalDialog>

<style>
    .resources {
        max-height: 80vh;
        overflow: hidden;
        padding: 1rem 0 ;
    }
    .tabs {
        display: flex;
        border-bottom: 1px solid #444;
        margin-bottom: 1rem;
    }
    .tabs button {
        padding: 0.5rem 1rem;
        background: none;
        border: none;
        color: #ccc;
        cursor: pointer;
        border-bottom: 2px solid transparent;
    }
    .tabs button.active {
        color: #4a9;
        border-bottom: 2px solid #4a9;
    }
    .tab-panel {
        height: 100%;
    }
    .search-container {
        display: flex;
        gap: 0.5rem;
        margin-bottom: .1rem;
        margin-right: 24px;
    }
    .search-input {
        flex: 1;
    }
    .sort-select {
        background-color: #222;
        color: #eee;
        border: 1px solid #444;
        border-radius: 4px;
        padding: 0.5rem;
    }
    .search-container.sticky {
        position: sticky;
        top: 0;
        background-color: #222;
        z-index: 1;
        padding-top: 0.5rem;
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
    div.resource-list {
        max-height: 68vh;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 0 18px 0 0;
    }
</style>
