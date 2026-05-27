import type { ToolDefinition, ToolExecutionContext } from '../lib/types';
import { CROSSREF_MAILTO } from '../lib/http';

export const CROSSREF_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'crossref_search',
        description:
            'Search Crossref for scientific preprints and papers across all disciplines. Returns titles, authors, posting dates, DOIs, and publication venues. Covers arXiv, bioRxiv, ChemRxiv, and other preprint platforms alongside peer-reviewed research.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search query across titles, abstracts, and authors.' },
                max_results: { type: 'number', description: 'Number of results to return (1-10, default 5).' },
            },
            required: ['query'],
        },
    },
    displayName: 'Crossref Search',
    formatArgs(args) { return (args.query as string) || ''; },
    formatResult(result) {
        if (result.startsWith('Error:')) return result;
        const count = (result.match(/^### /gm) || []).length;
        return count > 0 ? `Got ${count} results` : 'No results';
    },
    isCacheable: true,
    cacheTTLMs: 600_000,
};

export async function executeCrossrefSearch(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<string> {
    const query = args.query as string;
    const maxResults = Math.min(Number(args.max_results) || 5, 10);
    if (!query) return 'Error: No query provided.';

    try {
        const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&filter=type:posted-content&sort=created&rows=${maxResults}&mailto=${CROSSREF_MAILTO}`;
        const resp = await fetch(url);
        if (!resp.ok) return `Crossref search failed: HTTP ${resp.status}`;
        const data = await resp.json();
        const items = data.message?.items || [];
        if (!items.length) return 'No results found on Crossref.';

        let output = '';
        for (const item of items) {
            const title = item.title?.[0] || 'Untitled';
            const authors = (item.author || []).map((a: { given?: string; family?: string }) =>
                [a.given, a.family].filter(Boolean).join(' ')
            ).join(', ');
            const posted = item.posted?.['date-parts']?.[0]?.join('-') || '';
            const container = item['container-title']?.[0] || '';
            const doi = item.DOI || '';

            output += `### ${title}\n`;
            if (authors) output += `**Authors:** ${authors}\n`;
            if (posted) output += `**Posted:** ${posted}\n`;
            if (container) output += `**Published in:** ${container}\n`;
            if (doi) output += `**DOI:** [${doi}](https://doi.org/${doi})\n`;
            output += '\n';
        }
        return output || 'No results to display.';
    } catch (e) {
        return `Crossref search failed: ${e instanceof Error ? e.message : String(e)}`;
    }
}
