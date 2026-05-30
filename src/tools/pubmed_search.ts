import type { ToolDefinition, ToolExecutionContext } from '../lib/types';
import { fetchUrl } from './web_fetch';
import { getClerkToken } from '../auth';

export const PUBMED_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'pubmed_search',
        description:
            'Search PubMed for biomedical and life sciences research papers. Returns formatted citations with titles, authors, journal info, DOIs, and links to PubMed Central for full text of papers when available.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search query. Supports PubMed syntax: boolean operators (AND, OR, NOT), field tags ([tiab], [au], [dp]), and MeSH terms.' },
                max_results: { type: 'number', description: 'Number of results to return (1-10, default 5).' },
            },
            required: ['query'],
        },
    },
    displayName: 'PubMed Search',
    formatArgs(args) { return (args.query as string) || ''; },
    formatResult(result) {
        if (result.startsWith('Error:')) return result;
        const count = (result.match(/^### /gm) || []).length;
        return count > 0 ? `Got ${count} results` : 'No results';
    },
    isCacheable: true,
    cacheTTLMs: 600_000,
};

export async function executePubMed(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<string> {
    const query = args.query as string;
    const maxResults = Math.min(Number(args.max_results) || 5, 10);
    if (!query) {
        console.error('[pubmed_search] No query provided');
        return 'Error: No query provided.';
    }

    const token = await getClerkToken();
    if (!token) {
        console.error('[pubmed_search] No auth token');
        return 'Error: Sign in to enable PubMed search (CORS proxy requires authentication).';
    }

    try {
        const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=${maxResults}&term=${encodeURIComponent(query)}`;
        const searchBody = await fetchUrl(searchUrl, token);
        const searchData = JSON.parse(searchBody);
        const pmids = searchData.esearchresult?.idlist || [];
        if (!pmids.length) {
            console.log('[pubmed_search] No results found', { query, maxResults });
            return 'No PubMed results found.';
        }

        const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmids.join(',')}&retmode=json`;
        const summaryBody = await fetchUrl(summaryUrl, token);
        const summaryData = JSON.parse(summaryBody);

        const uids: string[] = summaryData.result?.uids || [];
        let output = '';
        for (const uid of uids) {
            const doc = summaryData.result[uid];
            if (!doc) continue;
            const title = doc.title || 'Untitled';
            const authors = (doc.authors || []).map((a: { name: string }) => a.name).join(', ');
            const journal = doc.source || '';
            const pubdate = doc.pubdate || '';
            const doi = (doc.articleids || []).find((id: { idtype: string }) => id.idtype === 'doi')?.value || '';
            const pmcid = (doc.articleids || []).find((id: { idtype: string }) => id.idtype === 'pmc' || id.idtype === 'pmcid')?.value || '';

            output += `### ${title}\n`;
            if (authors) output += `**Authors:** ${authors}\n`;
            if (journal || pubdate) output += `**Published:** ${[journal, pubdate].filter(Boolean).join(', ')}\n`;
            output += `**PMID:** [${uid}](https://pubmed.ncbi.nlm.nih.gov/${uid}/)`;
            if (doi) output += ` | **DOI:** [${doi}](https://doi.org/${doi})`;
            if (pmcid) output += ` | **PMC:** [${pmcid}](https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcid}/)`;
            output += '\n\n';
        }
        return output || 'No results to display.';
    } catch (e) {
        console.error('[pubmed_search] Search failed', { query, error: e instanceof Error ? e.message : String(e) });
        return `PubMed search failed: ${e instanceof Error ? e.message : String(e)}`;
    }
}
