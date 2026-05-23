import { evaluate } from 'mathjs';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import type { ToolDefinition, ToolCall, ToolExecutionContext, ToolExecutor } from './types';
import { getClerkToken } from '../auth';

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
    ? 'http://localhost:8788'
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
    ];

    for (const tool of tools) {
        if (enabledToolNames.includes(tool.definition.function.name)) {
            registry.register(tool.definition, tool.executor);
        }
    }

    return registry;
}
