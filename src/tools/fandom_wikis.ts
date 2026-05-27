import type { ToolDefinition, ToolExecutionContext } from '../lib/types';

const API_TIMEOUT_MS = 10000;
const COMMUNITY_API = 'https://community.fandom.com/api.php';

export const FANDOM_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'fandom_search',
        description:
            'Search Fandom wikis for information on games, movies, TV shows, books, and other entertainment topics. ' +
            'Use findWiki mode to discover which wiki covers a topic, searchWiki to find pages within a known wiki, ' +
            'and fetchPage to retrieve the full article text of a specific page.',
        parameters: {
            type: 'object',
            properties: {
                mode: {
                    type: 'string',
                    enum: ['findWiki', 'searchWiki', 'fetchPage'],
                    description:
                        '"findWiki" — search all Fandom wikis for a topic. ' +
                        '"searchWiki" — search for pages within a specific wiki (requires wiki_name). ' +
                        '"fetchPage" — get the full text of a specific page (requires wiki_name).',
                },
                query: {
                    type: 'string',
                    description:
                        'Search terms or page title. For findWiki: the topic to find wikis for. ' +
                        'For searchWiki and fetchPage: the page title or search query within the wiki.',
                },
                wiki_name: {
                    type: 'string',
                    description:
                        'Required for searchWiki and fetchPage. The wiki subdomain name (e.g. "fallout", "wookieepedia"), ' +
                        'or a full Fandom URL (e.g. "https://fallout.fandom.com").',
                },
            },
            required: ['mode', 'query'],
        },
    },
    displayName: 'Fandom Wiki Search',
    formatArgs(args) {
        const mode = (args.mode as string) || '';
        if (mode === 'findWiki') return (args.query as string) || '';
        const wiki = (args.wiki_name as string) || '';
        const query = (args.query as string) || '';
        return wiki ? `${wiki}: ${query}` : query;
    },
    formatResult(result) {
        if (result.startsWith('Error:')) return result;
        if (result.startsWith('<!-- fetched from')) {
            const titleMatch = result.match(/^# (.+)/m);
            const title = titleMatch ? titleMatch[1].slice(0, 50) : 'Article';
            const size = result.length;
            const sizeStr = size > 1000 ? `${(size / 1000).toFixed(1)}k` : `${size}b`;
            return `${title} (${sizeStr})`;
        }
        const wikiCount = (result.match(/^\*\*/gm) || []).length;
        if (wikiCount > 0) return `Found ${wikiCount} results`;
        const pageCount = (result.match(/^<\/?ul>/gm) || []).length;
        return 'Got results';
    },
};

// ── Helpers ──

function cleanWikiName(raw: string): string {
    return raw
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/\.fandom\.com\/?$/i, '')
        .replace(/[^a-z0-9-]/g, '')
        .trim();
}

function wikiSlugFromTitle(title: string): string {
    return title
        .toLowerCase()
        .replace(/\s+wiki$/i, '')
        .replace(/[^a-z0-9]/g, '');
}

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

// ── Mode handlers ──

async function findWiki(query: string): Promise<string> {
    const url = `${COMMUNITY_API}?action=query&list=search&srsearch=${encodeURIComponent(query + ' wiki')}&format=json&origin=*&srlimit=5`;
    const data = await fetchJson(url);
    if (!data) return 'Error: Could not reach Fandom community hub.';

    const search = (data.query as Record<string, unknown> | undefined)?.search as Array<Record<string, unknown>> | undefined;
    if (!search || search.length === 0) return `No wikis found for "${query}".`;

    const results: string[] = [];
    for (const r of search) {
        const title = (r.title as string) || 'Unknown Wiki';
        const rawSnippet = (r.snippet as string) || '';
        const snippet = rawSnippet.replace(/<[^>]+>/g, '');
        const slug = wikiSlugFromTitle(title);
        results.push(`**${title}**\n${snippet}\nhttps://${slug}.fandom.com`);
    }

    return `Wikis found for "${query}":\n\n${results.join('\n\n')}`;
}

async function searchWiki(wikiName: string, query: string): Promise<string> {
    const cleanName = cleanWikiName(wikiName);
    if (!cleanName) return `Error: Invalid wiki_name "${wikiName}".`;

    const url = `https://${cleanName}.fandom.com/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=10&format=json&origin=*`;
    const data = await fetchJson(url);
    if (!data) return `Error: Could not reach wiki "${wikiName}". Verify the wiki name is correct.`;

    const titles = (data as unknown as Array<unknown>)[1] as string[] | undefined;
    const links = (data as unknown as Array<unknown>)[3] as string[] | undefined;

    if (!titles || titles.length === 0) return `No pages found for "${query}" on ${cleanName}.fandom.com.`;

    const results = titles.map((t, i) => `**${t}**\n${links?.[i] || ''}`);
    return `Pages found on ${cleanName}.fandom.com for "${query}":\n\n${results.join('\n\n')}`;
}

async function fetchPage(wikiName: string, pageTitle: string): Promise<string> {
    const cleanName = cleanWikiName(wikiName);
    if (!cleanName) return `Error: Invalid wiki_name "${wikiName}".`;

    const url = `https://${cleanName}.fandom.com/api.php?action=query&prop=extracts&explaintext=true&titles=${encodeURIComponent(pageTitle)}&format=json&origin=*`;
    const data = await fetchJson(url);
    if (!data) return `Error: Could not reach wiki "${wikiName}". Verify the wiki name is correct.`;

    const pages = (data.query as Record<string, unknown> | undefined)?.pages as Record<string, unknown> | undefined;
    if (!pages) return `Error: Could not find page "${pageTitle}" on ${cleanName}.fandom.com.`;

    const pageIds = Object.keys(pages);
    if (pageIds.length === 0 || pageIds[0] === '-1') {
        return `Error: Page "${pageTitle}" not found on ${cleanName}.fandom.com.`;
    }

    const page = pages[pageIds[0]] as Record<string, unknown>;
    const title = (page.title as string) || pageTitle;
    const extract = (page.extract as string) || '';

    if (!extract) return `Error: Page "${pageTitle}" exists but has no extractable content.`;

    return `<!-- fetched from ${cleanName}.fandom.com: ${title} -->\n\n# ${title}\n\n${extract}`;
}

// ── Executor ──

export async function executeFandomSearch(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<string> {
    const mode = (args.mode as string) || '';
    const query = (args.query as string || '').trim();
    const wikiName = (args.wiki_name as string || '').trim();

    if (!query) return 'Error: No search query provided.';

    if (mode === 'findWiki') {
        ctx.onStatus?.('Searching Fandom wikis...');
        return findWiki(query);
    }

    if (mode === 'searchWiki') {
        if (!wikiName) return 'Error: wiki_name is required for searchWiki mode.';
        ctx.onStatus?.('Searching wiki...');
        return searchWiki(wikiName, query);
    }

    if (mode === 'fetchPage') {
        if (!wikiName) return 'Error: wiki_name is required for fetchPage mode.';
        ctx.onStatus?.('Fetching article...');
        return fetchPage(wikiName, query);
    }

    return 'Error: Mode must be "findWiki", "searchWiki", or "fetchPage".';
}
