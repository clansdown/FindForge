import type { ToolDefinition, ToolExecutionContext } from '../lib/types';
import { getFromCache, addToCache } from '../lib/docCache';
import { fetchUrl } from './web_fetch';
import { getClerkToken } from '../auth';

export const DOCUMENT_SEARCH_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'document_search',
        description:
            'Search within a document for specific content. Use this when you have a large ' +
            'document and need to find specific passages or facts rather than reading the ' +
            'whole thing. You can search by plain text (query) or regular expression (regex). ' +
            'If the document has not been fetched yet, it will be retrieved automatically. ' +
            'Each match includes a cursor ID (doc://url/offset) that you can pass as the ' +
            '"next" parameter to read the content around that match — about 1,000 words ' +
            'at a time. Use the offset parameter to page through additional matches, ' +
            'or context_words to control how many surrounding words are shown per match.',
        parameters: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description:
                        'URL or cache key of the document. Accepts web URLs (https://...) and ' +
                        'internal cache keys (tool://...). Internal keys are used when content was ' +
                        'truncated by another tool.',
                },
                query: {
                    type: 'string',
                    description: 'Plain text to search for (case-insensitive). Provide either query or regex.',
                },
                regex: {
                    type: 'string',
                    description: 'Regular expression to match. Provide either query or regex.',
                },
                next: {
                    type: 'string',
                    description:
                        'A document cursor like "doc://url/offset" from a previous search result match. ' +
                        'When provided, ignores query/regex and returns the next portion of the document ' +
                        'starting at the specified offset. Use this to read content around a matched result.',
                },
                context_words: {
                    type: 'integer',
                    description: 'Number of words of surrounding context to include before and after each match (default 50).',
                    default: 50,
                },
                limit: {
                    type: 'integer',
                    description: 'Maximum matches to return, or characters to read when using "next" (default 10 matches, 6000 chars for next).',
                    default: 10,
                },
                offset: {
                    type: 'integer',
                    description: 'Number of matches to skip (for pagination, default 0).',
                    default: 0,
                },
            },
            required: ['url'],
        },
    },
    displayName: 'Document Search',
    formatArgs(args) {
        const n = (args.next as string) || '';
        if (n) return `next: ${n}`;
        const url = (args.url as string) || '';
        const query = (args.query as string) || (args.regex as string) || '';
        return query ? `${url}: ${query}` : url;
    },
    formatResult(result) {
        if (result.startsWith('Error:')) return result;
        const matchCount = (result.match(/^### Match \d+/gm) || []).length;
        return matchCount > 0 ? `Found ${matchCount} matches` : 'No matches found';
    },
    isCacheable: true,
    cacheTTLMs: 300_000,
};

export async function executeDocumentSearch(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<string> {
    const url = (args.url as string || '').trim();
    const query = (args.query as string || '').trim();
    const regexStr = (args.regex as string || '').trim();
    const next = (args.next as string || '').trim();
    const contextWords = (args.context_words as number) || 50;
    const limit = (args.limit as number) || 10;
    const offset = (args.offset as number) || 0;

    if (!url && !next) {
        console.error('[document_search] No URL or cache key provided', { url, query, next, regex: regexStr });
        return 'Error: No URL or cache key provided.';
    }

    // Handle "next" cursor — read content around a previous match
    if (next) {
        const nextMatch = next.match(/^doc:\/\/(.+?)\/(\d+)$/);
        if (!nextMatch) {
            console.error('[document_search] Invalid next cursor', { next });
            return `Error: Invalid next cursor: "${next}". Expected format: doc://url/offset.`;
        }

        const docUrl = decodeURIComponent(nextMatch[1]);
        const startOffset = parseInt(nextMatch[2], 10);
        const charsToRead = Math.min(limit, 500000);

        let fullText: string | null = null;
        const cached = await getFromCache(docUrl);
        if (cached) fullText = await cached.text();
        if (!fullText && /^https?:\/\//i.test(docUrl)) {
            ctx.onStatus?.('Fetching document...');
            const token = await getClerkToken();
            if (!token) {
                console.error('[document_search] No auth token for document fetch', { docUrl });
                return 'Error: Sign in to enable document fetching (CORS proxy requires authentication).';
            }
            const fetched = await fetchUrl(docUrl, token);
            if (fetched.startsWith('Error:')) return fetched;
            await addToCache(docUrl, fetched, 'text/plain').catch(() => {});
            fullText = fetched;
        }
        if (!fullText) {
            console.error('[document_search] Document not found in cache', { docUrl, next });
            return `Error: Document not found in cache: "${docUrl}".`;
        }

        const end = startOffset + charsToRead;
        const slice = fullText.slice(startOffset, end);
        if (end < fullText.length) {
            return slice + `\n\n[Document continues at offset ${end}. Use document_search with next="doc://${encodeURIComponent(docUrl)}/${end}" to read more.]`;
        }
        return slice;
    }

    if (!query && !regexStr) {
        console.error('[document_search] No query or regex provided', { url });
        return 'Error: Provide either a query string or a regular expression.';
    }

    let fullText: string | null = null;

    const cached = await getFromCache(url);
    if (cached) {
        fullText = await cached.text();
    }

    if (!fullText && /^https?:\/\//i.test(url)) {
        ctx.onStatus?.('Fetching document...');
        const token = await getClerkToken();
        if (!token) {
            console.error('[document_search] No auth token for document fetch', { url });
            return 'Error: Sign in to enable document fetching (CORS proxy requires authentication).';
        }
        const fetched = await fetchUrl(url, token);
        if (fetched.startsWith('Error:')) return fetched;
        await addToCache(url, fetched, 'text/plain').catch(() => {});
        fullText = fetched;
    }

    if (!fullText) {
        console.error('[document_search] Document not found in cache and not fetchable', { url });
        return `Error: Document not found in cache and could not be fetched: "${url}". If this is an internal cache key, fetch the document first using web_fetch.`;
    }

    let re: RegExp;
    try {
        re = regexStr ? new RegExp(regexStr, 'gi') : new RegExp(escapeRegExp(query), 'gi');
    } catch (e) {
        console.error('[document_search] Invalid regular expression', { regex: regexStr, error: e instanceof Error ? e.message : String(e) });
        return `Error: Invalid regular expression: ${e instanceof Error ? e.message : String(e)}`;
    }

    const matches: Array<{ index: number; match: string; before: string; after: string }> = [];
    let match: RegExpExecArray | null;
    while ((match = re.exec(fullText)) !== null) {
        const beforeText = wordsBefore(fullText, match.index, contextWords);
        const afterText = wordsAfter(fullText, match.index + match[0].length, contextWords);
        matches.push({
            index: match.index,
            match: match[0],
            before: beforeText,
            after: afterText,
        });
        if (match.index === re.lastIndex) re.lastIndex++;
    }

    if (matches.length === 0) {
        return `No matches found for "${query || regexStr}" in the document.`;
    }

    const paginated = matches.slice(offset, offset + limit);
    if (paginated.length === 0) {
        return `No more matches. ${matches.length} total matches found; requested offset ${offset}.`;
    }

    const encodedUrl = encodeURIComponent(url);
    let output = `Found ${matches.length} match(es) for "${query || regexStr}". Showing ${paginated.length} (offset ${offset}):\n\n`;
    for (let i = 0; i < paginated.length; i++) {
        const m = paginated[i];
        output += `### Match ${offset + i + 1} (id: doc://${encodedUrl}/${m.index})\n`;
        if (m.before) output += `...${m.before}`;
        output += `**${m.match}**`;
        if (m.after) output += `${m.after}...`;
        output += '\n\n';
    }

    if (offset + limit < matches.length) {
        output += `[${matches.length - offset - limit} more matches remain. Use offset=${offset + limit} to retrieve more.]`;
    }

    return output.trim();
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordsBefore(text: string, endIndex: number, count: number): string {
    const before = text.slice(0, endIndex);
    const words = before.split(/\s+/).filter(Boolean);
    return words.slice(-count).join(' ');
}

function wordsAfter(text: string, startIndex: number, count: number): string {
    const after = text.slice(startIndex);
    const words = after.split(/\s+/).filter(Boolean);
    return words.slice(0, count).join(' ');
}
