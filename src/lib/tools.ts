import { evaluate } from 'mathjs';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import type { ToolDefinition, ToolCall, ToolExecutionContext, ToolExecutor } from './types';
import { getClerkToken } from '../auth';
import { pmidToPmcid, normalizePmcid, fetchPmcXml } from './pubmed';

export const TOOL_DISPLAY_NAMES: Record<string, string> = {
    'scientific_calculator': 'Scientific Calculator',
    'wikipedia_search': 'Wikipedia Search',
    'catholic_encyclopedia_search': 'Catholic Encyclopedia Search',
    'web_fetch': 'Web Fetch',
    'pubmed_search': 'PubMed Search',
    'arxiv_search': 'arXiv Search',
    'pubmed_fetch': 'PubMed Full-Text Fetch',
};

// ── Tool Definitions (OpenAI-compatible JSON Schema) ──

export const CALCULATOR_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'scientific_calculator',
        description:
            'Evaluate mathematical expressions safely. Supports basic arithmetic, trig functions (sin, cos, tan, asin, acos, atan), logarithms (log, log10, ln), exponents, square roots (sqrt), and constants (pi, e). Use for any numerical computation.',
        parameters: {
            type: 'object',
            properties: {
                expression: {
                    type: 'string',
                    description: "Math expression to evaluate, e.g. 'sqrt(2) * pi', 'log10(1000)', 'sin(pi/2) + cos(0)', '2^10'",
                },
            },
            required: ['expression'],
        },
    },
};

export const WIKIPEDIA_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'wikipedia_search',
        description:
            'Search Wikipedia for information on a topic. Returns summaries, key facts, and links. Ideal for general knowledge, history, science, and current events.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search query or topic name',
                },
                limit: {
                    type: 'integer',
                    description: 'Number of results (default 3, max 5)',
                    default: 3,
                },
            },
            required: ['query'],
        },
    },
};

export const CATHOLIC_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'catholic_encyclopedia_search',
        description:
            'Search the Catholic Encyclopedia for authoritative information on Catholic doctrine, history, saints, liturgy, and theology.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: "Search term or topic, e.g. 'Transubstantiation', 'Council of Trent'",
                },
                limit: {
                    type: 'integer',
                    description: 'Number of results (default 3, max 5)',
                    default: 3,
                },
            },
            required: ['query'],
        },
    },
};

export const WEB_FETCH_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'web_fetch',
        description:
            'Fetch a web page and extract its main content as clean markdown. Use this after getting search results to read the full text of specific pages. Returns the page title and cleaned markdown content.',
        parameters: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'The URL of the web page to fetch',
                },
            },
            required: ['url'],
        },
    },
};

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
};

export const ARXIV_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'arxiv_search',
        description:
            'Search arXiv for scientific preprints in physics, mathematics, computer science, and related fields. Returns formatted citations with titles, authors, abstracts, and direct PDF links.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search query. Prefix with field codes: ti: (title), au: (author), abs: (abstract), cat: (category), or all: (all fields). Example: "ti:transformer + attention".' },
                max_results: { type: 'number', description: 'Number of results to return (1-10, default 5).' },
            },
            required: ['query'],
        },
    },
};

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
};

// ── Tool Executors ──

async function executeCalculator(args: Record<string, unknown>): Promise<string> {
    const expression = args.expression as string;
    if (!expression || typeof expression !== 'string') {
        return 'Error: No expression provided.';
    }
    try {
        const result = evaluate(expression);
        return String(result);
    } catch (e) {
        return `Error evaluating expression: ${e instanceof Error ? e.message : String(e)}`;
    }
}

async function executeWikipedia(args: Record<string, unknown>): Promise<string> {
    const query = args.query as string;
    const limit = Math.min((args.limit as number) || 3, 5);
    if (!query) return 'Error: No search query provided.';

    try {
        const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=${limit}`;
        const searchRes = await fetch(searchUrl);
        const searchData = await searchRes.json();
        const results = searchData.query?.search || [];

        if (results.length === 0) return `No Wikipedia results for "${query}".`;

        const summaries: string[] = [];
        for (const r of results) {
            const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(r.title)}`;
            try {
                const sumRes = await fetch(summaryUrl);
                if (!sumRes.ok) continue;
                const sumData = await sumRes.json();
                summaries.push(
                    `**${sumData.title}**\n${sumData.extract?.slice(0, 500) || 'No summary available.'}\n${sumData.content_urls?.desktop?.page || ''}`,
                );
            } catch {
                summaries.push(`**${r.title}** — https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`);
            }
        }
        return summaries.join('\n\n') || `No detailed results for "${query}".`;
    } catch (e) {
        return `Wikipedia search failed: ${e instanceof Error ? e.message : String(e)}`;
    }
}

async function executeCatholicEncyclopedia(args: Record<string, unknown>): Promise<string> {
    const query = args.query as string;
    const limit = Math.min((args.limit as number) || 3, 5);
    if (!query) return 'Error: No search query provided.';

    try {
        const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query + ' site:newadvent.org/cathen')}&format=json&origin=*&srlimit=${limit}`;
        const searchRes = await fetch(searchUrl);
        const searchData = await searchRes.json();
        const results = searchData.query?.search || [];

        if (results.length === 0) return `No Catholic Encyclopedia results for "${query}".`;

        const entries: string[] = [];
        for (const r of results) {
            entries.push(
                `**${r.title.replace(/ - Wikipedia$/, '')}**\n${r.snippet.replace(/<[^>]+>/g, '')}\nhttps://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
            );
        }
        return entries.join('\n\n') || `No detailed results for "${query}".`;
    } catch (e) {
        return `Catholic Encyclopedia search failed: ${e instanceof Error ? e.message : String(e)}`;
    }
}

// ── Carve-out infrastructure for CORS-friendly fetches ──

interface WebFetchCarveOut {
    canHandle: (url: string) => boolean;
    handle: (url: string) => Promise<string>;
}

const WEB_PROXY_BASE_URL = import.meta.env.DEV
    ? '/web-proxy'
    : 'https://findforge-web-proxy.chris-f57.workers.dev';

async function fetchWikipediaPage(url: string): Promise<string> {
    const match = url.match(/^https?:\/\/([a-z]{2,3})(?:\.m)?\.wikipedia\.org\/wiki\/([^#?/]+)/);
    if (!match) {
        return 'Error: Invalid Wikipedia URL.';
    }
    const lang = match[1];
    const title = decodeURIComponent(match[2].replace(/_/g, ' '));
    const apiUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(title)}`;
    try {
        const res = await fetch(apiUrl, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) return `Error: Wikipedia API returned HTTP ${res.status}`;
        const html = await res.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        doc.querySelectorAll('.mw-editsection, #toc, .toc, nav, .sidebar, .footer, .noprint').forEach(el => el.remove());
        const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
        const markdown = turndownService.turndown(doc.body.innerHTML);
        return `# Wikipedia: ${title}\n\n` + markdown.trim();
    } catch (e) {
        console.warn('[web_fetch] Wikipedia API error:', url, e);
        return `Error: Could not fetch Wikipedia page via API: ${e instanceof Error ? e.message : String(e)}`;
    }
}

const WEB_FETCH_CARVE_OUTS: WebFetchCarveOut[] = [
    {
        canHandle: (url) => /^https?:\/\/([a-z]{2,3})(?:\.m)?\.wikipedia\.org\/wiki\//.test(url),
        handle: fetchWikipediaPage,
    },
];

async function executeWebFetch(args: Record<string, unknown>): Promise<string> {
    const url = args.url as string;
    if (!url) return 'Error: No URL provided.';

    for (const carveOut of WEB_FETCH_CARVE_OUTS) {
        if (carveOut.canHandle(url)) {
            return carveOut.handle(url);
        }
    }

    const token = await getClerkToken();
    if (!token) {
        return `Error: Sign in to enable web fetching (CORS proxy requires authentication).`;
    }

    return fetchViaProxy(url, token);
}

async function fetchViaProxy(url: string, token: string): Promise<string> {
    try {
        const res = await fetch(WEB_PROXY_BASE_URL + '/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token,
            },
            body: JSON.stringify({ url }),
            signal: AbortSignal.timeout(15000),
        });

        if (res.ok) {
            const html = await res.text();
            console.log('[resources] fetchViaProxy success:', { url, htmlLength: html.length });
            return extractContentFromHtml(html, url);
        }

        const body = await res.json().catch(() => ({}));
        const code = body?.code as string | undefined;

        if (res.status === 401) {
            console.log('[resources] fetchViaProxy 401:', { url, code });
            const freshToken = await getClerkToken({ skipCache: true });
            if (freshToken) {
                const retryRes = await fetch(WEB_PROXY_BASE_URL + '/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + freshToken,
                    },
                    body: JSON.stringify({ url }),
                    signal: AbortSignal.timeout(15000),
                });
                if (retryRes.ok) {
                    const html = await retryRes.text();
                    return extractContentFromHtml(html, url);
                }
                return `Error: Proxy returned HTTP ${retryRes.status} (${code || 'unknown'}) for ${url}`;
            }
            return `Error: Session expired — please sign in again.`;
        }

        if (res.status === 429) {
            const retryAfter = res.headers.get('Retry-After') || '60';
            return `Error: Rate limited. Retry after ${retryAfter} seconds.`;
        }

        if (res.status === 502) {
            console.log('[resources] fetchViaProxy 502:', { url });
            return `Error: Could not reach ${url}`;
        }

        console.log('[resources] fetchViaProxy unexpected status:', { url, status: res.status, code });
        return `Error: Proxy returned HTTP ${res.status} (${code || 'unknown'}) for ${url}`;
    } catch (e) {
        if (e instanceof DOMException && e.name === 'TimeoutError') {
            console.log('[resources] fetchViaProxy timeout:', { url });
            return `Error: Request timed out for ${url}`;
        }
        console.log('[resources] fetchViaProxy network error:', { url, error: e instanceof Error ? e.message : String(e) });
        return `Error: Proxy request failed for ${url}: ${e instanceof Error ? e.message : String(e)}`;
    }
}

async function extractContentFromHtml(html: string, url: string): Promise<string> {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        doc.querySelectorAll('script, style, nav, footer, header, aside, iframe, noscript, svg, form, .sidebar, .footer, .header')
            .forEach(el => el.remove());

        const reader = new Readability(doc);
        const article = reader.parse();

        if (!article || !article.content || (article.textContent?.trim().length ?? 0) < 100) {
            console.warn('[web_fetch] Possible SPA detected — page has minimal content, may require JavaScript:', url);
        }

        if (!article || !article.content) {
            return `Error: Could not extract content from ${url}. The page may require JavaScript.`;
        }

        const turndownService = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced',
        });
        const markdown = turndownService.turndown(article.content);
        const title = article.title ? `# ${article.title}\n\n` : '';
        return (title + markdown).trim();
    } catch (e) {
        return `Error processing ${url}: ${e instanceof Error ? e.message : String(e)}`;
    }
}

async function executePubMed(args: Record<string, unknown>): Promise<string> {
    const query = args.query as string;
    const maxResults = Math.min(Number(args.max_results) || 5, 10);
    if (!query) return 'Error: No query provided.';

    try {
        const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=${maxResults}&term=${encodeURIComponent(query)}`;
        const searchResp = await fetch(searchUrl);
        if (!searchResp.ok) return `PubMed search failed: HTTP ${searchResp.status}`;
        const searchData = await searchResp.json();
        const pmids = searchData.esearchresult?.idlist || [];
        if (!pmids.length) return 'No PubMed results found.';

        const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmids.join(',')}&retmode=json`;
        const summaryResp = await fetch(summaryUrl);
        if (!summaryResp.ok) return `PubMed summary fetch failed: HTTP ${summaryResp.status}`;
        const summaryData = await summaryResp.json();

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
        return `PubMed search failed: ${e instanceof Error ? e.message : String(e)}`;
    }
}

async function executeArxiv(args: Record<string, unknown>): Promise<string> {
    const query = args.query as string;
    const maxResults = Math.min(Number(args.max_results) || 5, 10);
    if (!query) return 'Error: No query provided.';

    const token = await getClerkToken();
    if (!token) return 'Error: Sign in to enable arXiv search (CORS proxy requires authentication).';

    try {
        const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=${maxResults}`;
        const xmlText = await fetchViaProxy(url, token);

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        const parserError = xmlDoc.querySelector('parsererror');
        if (parserError) return 'Error: Failed to parse arXiv response.';

        const entries = xmlDoc.querySelectorAll('entry');
        if (!entries.length) return 'No arXiv results found.';

        let output = '';
        for (const entry of entries) {
            const title = entry.querySelector('title')?.textContent?.trim() || 'Untitled';
            const authors = [...entry.querySelectorAll('author name')].map(n => n.textContent?.trim()).filter(Boolean).join(', ');
            const summary = entry.querySelector('summary')?.textContent?.trim() || '';
            const published = entry.querySelector('published')?.textContent?.trim() || '';
            const idUrl = entry.querySelector('id')?.textContent?.trim() || '';
            const arxivId = idUrl.replace(/^https?:\/\/arxiv\.org\/abs\//, '');

            output += `### ${title}\n`;
            if (authors) output += `**Authors:** ${authors}\n`;
            if (published) output += `**Published:** ${published.substring(0, 10)}\n`;
            if (summary) output += `**Abstract:** ${summary.substring(0, 500)}${summary.length > 500 ? '...' : ''}\n`;
            if (arxivId) output += `**arXiv:** [${arxivId}](https://arxiv.org/abs/${arxivId})\n`;
            output += '\n';
        }
        return output || 'No results to display.';
    } catch (e) {
        return `arXiv search failed: ${e instanceof Error ? e.message : String(e)}`;
    }
}

async function executePubMedFetch(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<string> {
    const pmcid = args.pmcid as string | undefined;
    const pmid = args.pmid as string | undefined;
    const doi = args.doi as string | undefined;

    if (!pmcid && !pmid && !doi) {
        return 'Error: Provide at least one of pmcid, pmid, or doi.';
    }

    const token = await getClerkToken();
    if (!token) {
        return 'Error: Sign in to enable PubMed full-text fetching (CORS proxy requires authentication).';
    }

    let resolvedPmcid: string | null = null;
    if (pmcid) {
        resolvedPmcid = normalizePmcid(pmcid);
    } else if (pmid) {
        try { resolvedPmcid = await pmidToPmcid(pmid); }
        catch { /* fall through to DOI path */ }
    }

    if (resolvedPmcid) {
        const xml = await fetchPmcXml(resolvedPmcid, token);
        if (!xml.startsWith('Error')) {
            return `<PMCID>PMC${resolvedPmcid}</PMCID>\n\n` + xml;
        }
        if (!doi) return xml;
    }

    if (doi) {
        try {
            const unpaywallUrl = `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=machinelearner@findforge.app`;
            const proxyRes = await fetch(WEB_PROXY_BASE_URL + '/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify({ url: unpaywallUrl }),
                signal: AbortSignal.timeout(15000),
            });
            if (!proxyRes.ok) return `Error: Unpaywall proxy returned HTTP ${proxyRes.status}.`;
            const data = await proxyRes.json();
            if (data.is_oa && data.best_oa_location) {
                const loc = data.best_oa_location;
                const parts: string[] = [];
                if (loc.url_for_pdf) parts.push(`PDF: ${loc.url_for_pdf}`);
                if (loc.url_for_landing_page) parts.push(`Landing Page: ${loc.url_for_landing_page}`);
                parts.push(`License: ${loc.license || 'unknown'}`);
                parts.push(`Host: ${loc.host_type || 'unknown'}`);
                return `Open Access article found for DOI ${doi}:\n\n${parts.join('\n')}\n\nUse web_fetch on the URL to retrieve the full text.`;
            }
            return `DOI ${doi} is not open access (is_oa: ${data.is_oa}).`;
        } catch (e) {
            return `Error: Unpaywall lookup failed for DOI ${doi}: ${e instanceof Error ? e.message : String(e)}`;
        }
    }

    return 'Error: Could not fetch the article.';
}

// ── Tool Registry ──

export class ToolRegistry {
    private definitions: Map<string, ToolDefinition> = new Map();
    private executors: Map<string, ToolExecutor> = new Map();

    register(definition: ToolDefinition, executor: ToolExecutor): void {
        const name = definition.function.name;
        this.definitions.set(name, definition);
        this.executors.set(name, executor);
    }

    getDefinitions(): ToolDefinition[] {
        return [...this.definitions.values()];
    }

    async execute(name: string, argsJson: string, ctx: ToolExecutionContext): Promise<string> {
        const executor = this.executors.get(name);
        if (!executor) return `Unknown tool: ${name}`;
        let args: Record<string, unknown>;
        try {
            args = JSON.parse(argsJson);
        } catch {
            return `Invalid arguments for tool ${name}: ${argsJson}`;
        }
        return executor(args, ctx);
    }

    async executeAll(toolCalls: ToolCall[], ctx: ToolExecutionContext): Promise<Array<{ tool_call_id: string; role: 'tool'; content: string }>> {
        const results = await Promise.all(
            toolCalls.map(async (tc) => {
                const content = await this.execute(tc.function.name, tc.function.arguments, ctx);
                return {
                    tool_call_id: tc.id,
                    role: 'tool' as const,
                    content,
                };
            }),
        );
        return results;
    }
}

// ── Factory ──

export function createToolRegistry(enabledToolNames: string[]): ToolRegistry {
    const registry = new ToolRegistry();

    const tools: Array<{ definition: ToolDefinition; executor: ToolExecutor }> = [
        { definition: CALCULATOR_TOOL, executor: executeCalculator },
        { definition: WIKIPEDIA_TOOL, executor: executeWikipedia },
        { definition: CATHOLIC_TOOL, executor: executeCatholicEncyclopedia },
        { definition: WEB_FETCH_TOOL, executor: executeWebFetch },
        { definition: PUBMED_TOOL, executor: executePubMed },
        { definition: ARXIV_TOOL, executor: executeArxiv },
        { definition: PUBMED_FETCH_TOOL, executor: executePubMedFetch },
    ];

    for (const tool of tools) {
        if (enabledToolNames.includes(tool.definition.function.name)) {
            registry.register(tool.definition, tool.executor);
        }
    }

    return registry;
}
