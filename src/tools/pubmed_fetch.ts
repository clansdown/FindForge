import type { ToolDefinition, ToolExecutionContext } from '../lib/types';
import { getClerkToken } from '../auth';
import { pmidToPmcid, normalizePmcid, fetchPmcXml } from '../lib/pubmed';
import { WEB_PROXY_BASE_URL } from './web_fetch';
import { UNPAYWALL_EMAIL } from '../lib/http';

export const PUBMED_FETCH_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'pubmed_fetch',
        description:
            'Fetch the full text of an open-access biomedical article from PubMed Central (PMC) or resolve a DOI to its open-access location. Provide a PMCID, PMID, or DOI. For PMCID/PMID, returns the full article in structured NLM XML suitable for LLM consumption. For DOIs, returns the best available open-access URL (use web_fetch on it to retrieve the content).',
        parameters: {
            type: 'object',
            properties: {
                pmcid: { type: 'string', description: 'PubMed Central ID, e.g. "PMC6345070" or "6345070"' },
                pmid: { type: 'string', description: 'PubMed ID, e.g. "30646276"' },
                doi: { type: 'string', description: 'Digital Object Identifier, e.g. "10.1186/s12859-019-2613-z"' },
            },
        },
    },
    displayName: 'PubMed Full-Text Fetch',
    formatArgs(args) {
        return (args.pmcid as string) || (args.pmid as string) || (args.doi as string) || '';
    },
    formatResult(result) {
        if (result.startsWith('Error:')) return result;
        if (result.startsWith('<PMCID>')) {
            const size = result.length;
            const sizeStr = size > 1000 ? `${(size / 1000).toFixed(1)}k` : `${size}b`;
            return `Got article (${sizeStr})`;
        }
        if (result.includes('Open Access article')) return 'Got OA link';
        return `Got result (${result.length}b)`;
    },
    isCacheable: true,
    cacheTTLMs: 600_000,
};

export async function executePubMedFetch(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<string> {
    const pmcid = args.pmcid as string | undefined;
    const pmid = args.pmid as string | undefined;
    const doi = args.doi as string | undefined;

    console.log('[pubmed_fetch] called with:', { pmcid, pmid, doi });

    if (!pmcid && !pmid && !doi) {
        console.warn('[pubmed_fetch] no identifier provided');
        return 'Error: Provide at least one of pmcid, pmid, or doi.';
    }

    const token = await getClerkToken();
    if (!token) {
        console.error('[pubmed_fetch] no auth token available');
        return 'Error: Sign in to enable PubMed full-text fetching (CORS proxy requires authentication).';
    }

    let resolvedPmcid: string | null = null;
    if (pmcid) {
        resolvedPmcid = normalizePmcid(pmcid);
        console.log('[pubmed_fetch] normalized pmcid:', resolvedPmcid);
    } else if (pmid) {
        console.log('[pubmed_fetch] resolving pmid to pmcid:', pmid);
        try {
            resolvedPmcid = await pmidToPmcid(pmid, token);
            console.log('[pubmed_fetch] pmid resolved to pmcid:', resolvedPmcid);
        } catch (e) {
            console.error('[pubmed_fetch] pmidToPmcid failed:', e);
        }
    }

    if (resolvedPmcid) {
        console.log('[pubmed_fetch] fetching PMC XML for pmcid:', resolvedPmcid);
        const xml = await fetchPmcXml(resolvedPmcid, token);
        if (!xml.startsWith('Error')) {
            console.log('[pubmed_fetch] PMC XML fetched successfully, length:', xml.length);
            return `<PMCID>PMC${resolvedPmcid}</PMCID>\n\n` + xml;
        }
        console.error('[pubmed_fetch] fetchPmcXml returned error:', xml);
        if (!doi) return xml;
    } else {
        console.log('[pubmed_fetch] no pmcid resolved, falling through');
    }

    if (doi) {
        console.log('[pubmed_fetch] trying Unpaywall DOI lookup:', doi);
        try {
            const unpaywallUrl = `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${UNPAYWALL_EMAIL}`;
            const proxyRes = await fetch(WEB_PROXY_BASE_URL + '/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify({ url: unpaywallUrl }),
                signal: AbortSignal.timeout(15000),
            });
            if (!proxyRes.ok) {
                console.error('[pubmed_fetch] Unpaywall proxy returned HTTP', proxyRes.status);
                return `Error: Unpaywall proxy returned HTTP ${proxyRes.status}.`;
            }
            const data = await proxyRes.json();
            console.log('[pubmed_fetch] Unpaywall response:', { is_oa: data.is_oa, has_location: !!data.best_oa_location });
            if (data.is_oa && data.best_oa_location) {
                const loc = data.best_oa_location;
                const parts: string[] = [];
                if (loc.url_for_pdf) parts.push(`PDF: ${loc.url_for_pdf}`);
                if (loc.url_for_landing_page) parts.push(`Landing Page: ${loc.url_for_landing_page}`);
                parts.push(`License: ${loc.license || 'unknown'}`);
                parts.push(`Host: ${loc.host_type || 'unknown'}`);
                return `Open Access article found for DOI ${doi}:\n\n${parts.join('\n')}\n\nUse web_fetch on the URL to retrieve the full text.`;
            }
            console.log('[pubmed_fetch] DOI not open access:', data.is_oa);
            return `DOI ${doi} is not open access (is_oa: ${data.is_oa}).`;
        } catch (e) {
            console.error('[pubmed_fetch] Unpaywall lookup failed:', e);
            return `Error: Unpaywall lookup failed for DOI ${doi}: ${e instanceof Error ? e.message : String(e)}`;
        }
    }

    console.error('[pubmed_fetch] all paths exhausted:', { pmcid, pmid, doi, resolvedPmcid });
    return 'Error: Could not fetch the article.';
}
