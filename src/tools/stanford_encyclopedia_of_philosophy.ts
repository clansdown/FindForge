import type { ToolDefinition, ToolExecutionContext } from '../lib/types';
import { getClerkToken } from '../auth';
import TurndownService from 'turndown';
import { WEB_PROXY_BASE_URL } from './web_fetch';

const MAX_SEARCH_RESULTS = 5;
const PROXY_TIMEOUT_MS = 15000;

export const SEP_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'sep_search',
        description:
            'Search the Stanford Encyclopedia of Philosophy for articles on a topic, or fetch the full text of a specific entry by topic ID. ' +
            'For search mode, provide a query string. For fetch mode, provide the topic_id (e.g. "descartes", "freewill", "causality-medieval").',
        parameters: {
            type: 'object',
            properties: {
                mode: {
                    type: 'string',
                    enum: ['search', 'fetch'],
                    description: '"search" to find entries by keyword, "fetch" to retrieve the full article text for a topic_id.',
                },
                query: {
                    type: 'string',
                    description: 'Required when mode="search". The search query to find SEP entries.',
                },
                topic_id: {
                    type: 'string',
                    description:
                        'Required when mode="fetch". The entry slug (e.g. "descartes", "freewill", "causality-medieval"). ' +
                        'Also accepts a full plato.stanford.edu URL.',
                },
            },
            required: ['mode'],
        },
    },
    displayName: 'Stanford Encyclopedia Search',
    formatArgs(args) {
        const mode = (args.mode as string) || '';
        if (mode === 'search') return (args.query as string) || '';
        if (mode === 'fetch') return (args.topic_id as string) || '';
        return mode;
    },
    formatResult(result) {
        if (result.startsWith('Error:')) return result;
        if (result.startsWith('<!-- fetched from SEP')) {
            const titleMatch = result.match(/^# (.+)/m);
            const title = titleMatch ? titleMatch[1].slice(0, 50) : 'Article';
            const size = result.length;
            const sizeStr = size > 1000 ? `${(size / 1000).toFixed(1)}k` : `${size}b`;
            return `${title} (${sizeStr})`;
        }
        const count = (result.match(/^\* /gm) || []).length;
        return count > 0 ? `Found ${count} results` : 'No results';
    },
};

// ── Helpers ──

function normalizeSlug(raw: string): string {
    return raw.toLowerCase().replace(/[^a-z0-9-]/g, '').trim();
}

function extractSlugFromUrl(url: string): string | null {
    const match = url.match(/plato\.stanford\.edu\/entries\/([^/#?]+)/);
    return match ? match[1] : null;
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
            signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
        });
        if (res.ok) return await res.text();

        const respBody = await res.json().catch(() => ({}));
        const code = respBody?.code as string | undefined;

        if (res.status === 401) {
            const freshToken = await getClerkToken({ skipCache: true });
            if (freshToken) {
                const retryRes = await fetch(WEB_PROXY_BASE_URL + '/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + freshToken,
                    },
                    body: JSON.stringify({ url }),
                    signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
                });
                if (retryRes.ok) return await retryRes.text();
                return `Error: Proxy returned HTTP ${retryRes.status} (${code || 'unknown'}) for ${url}`;
            }
            return 'Error: Session expired — please sign in again.';
        }

        if (res.status === 429) {
            const retryAfter = res.headers.get('Retry-After') || '60';
            return `Error: Rate limited. Retry after ${retryAfter} seconds.`;
        }

        if (res.status === 502) {
            return `Error: Could not reach ${url}`;
        }

        return `Error: Proxy returned HTTP ${res.status} (${code || 'unknown'}) for ${url}`;
    } catch (e) {
        if (e instanceof DOMException && e.name === 'TimeoutError') {
            return `Error: Request timed out for ${url}`;
        }
        return `Error: Proxy request failed for ${url}: ${e instanceof Error ? e.message : String(e)}`;
    }
}

function stripHtmlToMarkdown(html: string): { title: string; markdown: string } {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Extract title
    const titleEl = doc.querySelector('#entry-title h1, #aupl-entry-title h1');
    const title = titleEl ? titleEl.textContent?.trim() || 'Untitled Entry' : 'Untitled Entry';

    // Strip navigation, scripts, styles
    doc.querySelectorAll('script, style, div#aupl-header, nav, header, footer, iframe, noscript')
        .forEach(el => el.remove());

    // Find main content container
    const mainContent = doc.querySelector('#aupl-main-content') || doc.querySelector('#main-text');

    if (!mainContent) {
        // Fallback: use body with Readability-style stripping
        doc.querySelectorAll('[class*="sidebar"], [class*="nav"], [class*="header"], [class*="footer"]')
            .forEach(el => el.remove());
        const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
        const markdown = turndownService.turndown(doc.body.innerHTML).trim();
        return { title, markdown: markdown.substring(0, 200000) };
    }

    const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
    const markdown = turndownService.turndown(mainContent.innerHTML).trim();
    return { title, markdown };
}

// ── Search mode ──

async function searchEntries(query: string, token: string): Promise<string> {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent('site:plato.stanford.edu ' + query)}`;
    const html = await fetchViaProxy(searchUrl, token);
    if (html.startsWith('Error:')) return html;

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const results: string[] = [];

    const resultLinks = doc.querySelectorAll('.result__a');
    for (const link of resultLinks) {
        if (results.length >= MAX_SEARCH_RESULTS) break;

        const href = (link as HTMLAnchorElement).href;
        if (!href || !href.includes('plato.stanford.edu/entries/')) continue;

        const title = link.textContent?.trim() || 'Untitled';
        const resultEl = link.closest('.result') || link.closest('.result__body');
        const snippetEl = resultEl?.querySelector('.result__snippet');
        const snippet = snippetEl ? snippetEl.textContent?.trim() || '' : '';

        let line = `* **[${title}](${href})**`;
        if (snippet) line += `\n  ${snippet}`;
        results.push(line);
    }

    if (results.length === 0) {
        // Fallback: look for any plato.stanford.edu links in the page
        const allLinks = doc.querySelectorAll('a[href*="plato.stanford.edu/entries/"]');
        for (const link of allLinks) {
            if (results.length >= MAX_SEARCH_RESULTS) break;
            const href = (link as HTMLAnchorElement).href;
            const title = link.textContent?.trim() || 'Untitled';
            const line = `* **[${title}](${href})**`;
            if (!results.includes(line)) results.push(line);
        }
    }

    if (results.length === 0) return `No SEP entries found for "${query}".`;

    return `Search results for "${query}" on the Stanford Encyclopedia of Philosophy:\n\n${results.join('\n\n')}`;
}

// ── Fetch mode ──

async function fetchEntry(rawTopicId: string, token: string): Promise<string> {
    let slug: string;
    const urlSlug = extractSlugFromUrl(rawTopicId);
    if (urlSlug) {
        slug = urlSlug;
    } else {
        slug = normalizeSlug(rawTopicId);
        if (!slug) return 'Error: Invalid topic_id.';
    }

    const targetUrl = `https://plato.stanford.edu/entries/${slug}/`;
    const html = await fetchViaProxy(targetUrl, token);
    if (html.startsWith('Error:')) return html;

    const { title, markdown } = stripHtmlToMarkdown(html);

    if (!markdown) return `Error: Could not extract content from entry "${slug}".`;

    return `<!-- fetched from SEP: ${slug} -->\n\n# ${title}\n\n${markdown}`;
}

// ── Executor ──

export async function executeSepSearch(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<string> {
    const mode = (args.mode as string) || '';
    if (!mode || (mode !== 'search' && mode !== 'fetch')) {
        return 'Error: Mode must be "search" or "fetch".';
    }

    if (mode === 'search') {
        const query = (args.query as string || '').trim();
        if (!query) return 'Error: No search query provided.';
        const token = await getClerkToken();
        if (!token) return 'Error: Sign in to enable SEP search (CORS proxy requires authentication).';
        ctx.onStatus?.('Searching Stanford Encyclopedia...');
        return searchEntries(query, token);
    }

    if (mode === 'fetch') {
        const topicId = (args.topic_id as string || '').trim();
        if (!topicId) return 'Error: No topic_id provided.';
        const token = await getClerkToken();
        if (!token) return 'Error: Sign in to enable SEP search (CORS proxy requires authentication).';
        ctx.onStatus?.('Fetching article...');
        return fetchEntry(topicId, token);
    }

    return 'Error: Unknown mode.';
}
