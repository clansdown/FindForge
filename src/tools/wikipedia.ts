import type { ToolDefinition, ToolExecutionContext } from '../lib/types';

export const WIKIPEDIA_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'wikipedia',
        description:
            'Find information on a topic from Wikipedia, the online encyclopedia. ' +
            'This is a great place to gain general information on a subject before diving deeper. ' +
            'You can search for articles by keyword or fetch the full content of a specific article. ' +
            'Use search mode to find articles by keyword and get summaries. ' +
            'Use fetch mode to retrieve the complete content of a known article.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description:
                        'Search keywords or topic name. If provided without "mode" it implies search mode.',
                },
                title: {
                    type: 'string',
                    description:
                        'The exact article title (e.g. "Quantum mechanics", "Turing machine"). ' +
                        'If provided without "mode" it implies fetch mode. ' +
                        'Also accepts a full Wikipedia URL (e.g. "https://en.wikipedia.org/wiki/Quantum_mechanics").',
                },
                mode: {
                    type: 'string',
                    enum: ['search', 'fetch'],
                    description:
                        '"search" — find articles matching your query and return summaries. ' +
                        '"fetch" — retrieve the full text of a specific article by title. ' +
                        'If omitted, inferred from whether "query" (→ search) or "title" (→ fetch) is present.',
                },
                limit: {
                    type: 'integer',
                    description: 'Number of results (default 10, max 100). Only used in search mode.',
                    default: 10,
                },
            },
        },
    },
    displayName: 'Wikipedia',
    formatArgs(args) {
        const mode = (args.mode as string) || (args.query ? 'search' : args.title ? 'fetch' : '');
        if (mode === 'search') return `Searching for ${args.query as string}`;
        if (mode === 'fetch') return (args.title as string) || '';
        return mode;
    },
    formatResult(result) {
        if (result.startsWith('Error:')) return result;
        const searchMatch = result.match(/Search results for "([^"]+)"/);
        if (searchMatch) {
            const count = (result.match(/^\*\*/gm) || []).length;
            return `Found ${count} results for "${searchMatch[1]}"`;
        }
        if (result.startsWith('<!-- fetched from Wikipedia')) {
            const titleMatch = result.match(/^# (.+)/m);
            const title = titleMatch ? titleMatch[1].slice(0, 50) : 'Article';
            const size = result.length;
            const sizeStr = size > 1000 ? `${(size / 1000).toFixed(1)}k` : `${size}b`;
            return `${title} (${sizeStr})`;
        }
        const count = (result.match(/^\*\*/gm) || []).length;
        return count > 0 ? `Got ${count} results` : 'No results';
    },
    isCacheable: true,
    cacheTTLMs: 300_000,
    resourceMapper(args, result) {
        if (result.startsWith('Error:')) return null;
        const mode = (args.mode as string) || (args.query ? 'search' : args.title ? 'fetch' : '');
        if (mode !== 'fetch') return null;
        const titleMatch = result.match(/^<!-- fetched from Wikipedia: ([^ ]+) -->/);
        const title = titleMatch ? decodeURIComponent(titleMatch[1]) : (args.title as string || 'Unknown');
        return {
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
            title,
            type: 'wikipedia',
        };
    },
};

// ── Helpers ──

function extractTitleFromUrl(raw: string): string | null {
    const match = raw.match(/^https?:\/\/([a-z]{2,3})\.wikipedia\.org\/wiki\/([^#?/]+)/);
    if (!match) return null;
    return decodeURIComponent(match[2].replace(/_/g, ' '));
}

// ── Search mode ──

async function searchArticles(query: string, limit: number): Promise<string> {
    const safeLimit = Math.min(limit, 100);
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=${safeLimit}`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();
    const results = searchData.query?.search || [];

    if (results.length === 0) {
        console.log('[wikipedia] No search results', { query, limit });
        return `No Wikipedia results for "${query}".`;
    }

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
    if (!summaries.length) {
        console.log('[wikipedia] No detailed results from summaries', { query });
        return `No detailed results for "${query}".`;
    }
    return `${summaries.join('\n\n')}\n\nSearch results for "${query}"`;
}

// ── Fetch mode ──

async function fetchArticle(rawTitle: string): Promise<string> {
    let title: string;
    const urlTitle = extractTitleFromUrl(rawTitle);
    if (urlTitle) {
        title = urlTitle;
    } else {
        title = rawTitle.trim();
        if (!title) {
            console.error('[wikipedia] No article title provided');
            return 'Error: No article title provided.';
        }
    }

    const htmlUrl = `https://en.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(title)}`;
    const res = await fetch(htmlUrl);
    if (!res.ok) {
        if (res.status === 404) {
            console.log('[wikipedia] Page not found', { title });
            return `Error: Wikipedia page "${title}" not found.`;
        }
        console.error('[wikipedia] Failed to fetch page', { title, status: res.status });
        return `Error: Failed to fetch Wikipedia page "${title}" (HTTP ${res.status}).`;
    }

    const html = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Extract the page title from the HTML
    const titleEl = doc.querySelector('h1.firstHeading, h1#firstHeading');
    const pageTitle = titleEl ? titleEl.textContent?.trim() || title : title;

    // Strip scripts, styles, nav, footer, etc.
    doc.querySelectorAll('script, style, nav, footer, header, .mw-jump-link, .mw-footer, .mw-header, .noprint')
        .forEach(el => el.remove());

    // Find the main content
    const content = doc.querySelector('#mw-content-text, .mw-parser-output') || doc.body;

    const cleanedHtml = content.innerHTML.trim();

    if (!cleanedHtml) {
        console.log('[wikipedia] No content in page', { title });
        return `Error: No content available for "${title}".`;
    }

    return `<!-- fetched from Wikipedia: ${encodeURIComponent(pageTitle)} -->\n\n${cleanedHtml}`;
}

// ── Executor ──

export async function executeWikipedia(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<string> {
    const mode = (args.mode as string) || (args.query ? 'search' : args.title ? 'fetch' : '');

    if (mode === 'search') {
        const query = (args.query as string || '').trim();
        if (!query) {
            console.error('[wikipedia] No query for search mode');
            return 'Error: No search query provided.';
        }
        const limit = (args.limit as number) || 10;
        return searchArticles(query, limit);
    }

    if (mode === 'fetch') {
        const title = (args.title as string || '').trim();
        if (!title) {
            console.error('[wikipedia] No title for fetch mode');
            return 'Error: No article title provided.';
        }
        return fetchArticle(title);
    }

    console.error('[wikipedia] Unknown mode', { mode });
    return 'Error: Mode must be "search" or "fetch".';
}
