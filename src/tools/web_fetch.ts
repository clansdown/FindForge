import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import type { ToolDefinition, ToolExecutionContext } from '../lib/types';
import { getClerkToken } from '../auth';
import { USER_AGENT, CROSSREF_MAILTO } from '../lib/http';
import { getFromCache, addToCache } from '../lib/docCache';
import { toolErrorCache } from '../lib/toolErrorCache';

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
                offset: {
                    type: 'integer',
                    description: 'Character offset to start from (default 0). Use to retrieve portions of a large document.',
                    default: 0,
                },
                limit: {
                    type: 'integer',
                    description: 'Maximum characters to return (default 100000, max 500000).',
                    default: 100000,
                },
            },
            required: ['url'],
        },
    },
    displayName: 'Web Fetch',
    formatArgs(args) {
        const url = (args.url as string) || '';
        return url.length > 80 ? url.slice(0, 77) + '...' : url;
    },
    formatResult(result) {
        if (result.startsWith('Error:')) return result;
        const size = result.length;
        const sizeStr = size > 1000 ? `${(size / 1000).toFixed(1)}k` : `${size}b`;
        return result.includes('Document continues')
            ? `Got page portion (${sizeStr}, more available)`
            : `Got page (${sizeStr})`;
    },
    isCacheable: true,
    cacheTTLMs: 60_000,
};

// ── Shared proxy URL (also used by pubmed_fetch.ts and fetch_paper.ts) ──

export const WEB_PROXY_BASE_URL = import.meta.env.DEV
    ? '/web-proxy'
    : 'https://findforge-web-proxy.chris-f57.workers.dev';

// ── Direct-fetch spec and candidates ──

interface DirectFetchSpec {
    url: string;
    responseType: 'html' | 'json';
    headers?: Record<string, string>;
}

interface DirectFetchCandidate {
    canHandle: (url: string) => boolean;
    tryGetSpec: (url: string) => DirectFetchSpec | null;
}

function tryGetWikipediaSpec(url: string): DirectFetchSpec | null {
    const match = url.match(/^https?:\/\/([a-z]{2,3})(?:\.m)?\.wikipedia\.org\/wiki\/([^#?/]+)/);
    if (!match) return null;
    const lang = match[1];
    const title = decodeURIComponent(match[2].replace(/_/g, ' '));
    return {
        url: `https://${lang}.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(title)}`,
        responseType: 'html',
    };
}

function tryGetCrossrefSpec(url: string): DirectFetchSpec | null {
    if (!/^https?:\/\/api\.crossref\.org\//.test(url)) return null;
    const separator = url.includes('?') ? '&' : '?';
    const finalUrl = url.includes('mailto=') ? url : url + separator + `mailto=${CROSSREF_MAILTO}`;
    return {
        url: finalUrl,
        responseType: 'json',
        headers: { 'User-Agent': USER_AGENT },
    };
}

const DIRECT_FETCH_CANDIDATES: DirectFetchCandidate[] = [
    {
        canHandle: (u) => /^https?:\/\/([a-z]{2,3})(?:\.m)?\.wikipedia\.org\/wiki\//.test(u),
        tryGetSpec: tryGetWikipediaSpec,
    },
    {
        canHandle: (u) => /^https?:\/\/api\.crossref\.org\//.test(u),
        tryGetSpec: tryGetCrossrefSpec,
    },
];

interface FetchOptions {
    headers?: Record<string, string>;
}

export async function fetchUrl(url: string, token: string, options?: FetchOptions): Promise<string> {
    const cachedError = toolErrorCache.get(url);
    if (cachedError) return cachedError;

    let candidateHeaders: Record<string, string> | undefined;
    for (const candidate of DIRECT_FETCH_CANDIDATES) {
        if (candidate.canHandle(url)) {
            const spec = candidate.tryGetSpec(url);
            if (spec) {
                candidateHeaders = spec.headers;
                try {
                    const mergedHeaders = { ...options?.headers, ...spec.headers };
                    const res = await fetch(spec.url, {
                        signal: AbortSignal.timeout(15000),
                        headers: mergedHeaders,
                    });
                    if (res.ok) {
                        const body = await res.text();
                        if (spec.responseType === 'json') return body;
                        return extractContentFromHtml(body, url);
                    }
                } catch {
                    // CORS or network error — fall through to proxy
                }
            }
        }
    }

    const mergedHeaders: Record<string, string> | undefined =
        options?.headers || candidateHeaders
            ? { ...options?.headers, ...candidateHeaders }
            : undefined;
    return fetchViaProxy(url, token, mergedHeaders);
}

export async function executeWebFetch(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<string> {
    const url = (args.url as string || '').trim();
    const offset = (args.offset as number) || 0;
    const limit = Math.min((args.limit as number) || 100000, 500000);
    if (!url) return 'Error: No URL provided.';

    // Check OPFS cache first
    const cached = await getFromCache(url);
    let fullText: string;

    if (cached) {
        fullText = await cached.text();
    } else {
        const token = await getClerkToken();
        if (!token) {
            return 'Error: Sign in to enable web fetching (CORS proxy requires authentication).';
        }
        ctx.onStatus?.('Fetching page...');
        fullText = await fetchUrl(url, token);
        if (fullText.startsWith('Error:')) return fullText;
        await addToCache(url, fullText, 'text/plain').catch(() => {});
    }

    const end = offset + limit;
    const slice = fullText.slice(offset, end);

    if (end < fullText.length) {
        return slice + `\n\n[Document continues at offset ${end}. Use offset=${end} to retrieve more.]`;
    }
    return slice;
}

async function fetchViaProxy(
    url: string,
    token: string,
    extraHeaders?: Record<string, string>,
): Promise<string> {
    const body: Record<string, unknown> = { url };
    if (extraHeaders && Object.keys(extraHeaders).length > 0) body.headers = extraHeaders;

    const MAX_RETRIES = 4;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const res = await fetch(WEB_PROXY_BASE_URL + '/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token,
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(15000),
            });

            if (res.ok) {
                const html = await res.text();
                console.log('[resources] fetchViaProxy success:', { url, htmlLength: html.length });
                return extractContentFromHtml(html, url);
            }

            const respBody = await res.json().catch(() => ({}));
            const code = respBody?.code as string | undefined;

            if (res.status === 429 && attempt < MAX_RETRIES - 1) {
                const retryAfterMs = parseInt(res.headers.get('Retry-After') || '0', 10) * 1000;
                const delay = Math.max(retryAfterMs, Math.min(Math.pow(2, attempt) * 1000, 30000));
                console.log(`[resources] fetchViaProxy 429 (attempt ${attempt + 1}/${MAX_RETRIES}) for ${url}, retrying in ${delay}ms`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }

            if (res.status === 429) {
                const err = `Error: Rate limited. Max retries reached for ${url}`;
                toolErrorCache.set(url, err, 'transient');
                return err;
            }

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
                        body: JSON.stringify(body),
                        signal: AbortSignal.timeout(15000),
                    });
                    if (retryRes.ok) {
                        const html = await retryRes.text();
                        return extractContentFromHtml(html, url);
                    }
                    const err = `Error: Proxy returned HTTP ${retryRes.status} (${code || 'unknown'}) for ${url}`;
                    toolErrorCache.set(url, err, 'permanent');
                    return err;
                }
                const err = 'Error: Session expired — please sign in again.';
                toolErrorCache.set(url, err, 'permanent');
                return err;
            }

            if (res.status === 502) {
                console.log('[resources] fetchViaProxy 502:', { url });
                const err = `Error: Could not reach ${url}`;
                toolErrorCache.set(url, err, 'permanent');
                return err;
            }

            console.log('[resources] fetchViaProxy unexpected status:', { url, status: res.status, code });
            const err = `Error: Proxy returned HTTP ${res.status} (${code || 'unknown'}) for ${url}`;
            const category = res.status === 429 ? 'transient' : 'permanent';
            toolErrorCache.set(url, err, category);
            return err;
        } catch (e) {
            if (e instanceof DOMException && e.name === 'TimeoutError') {
                if (attempt < MAX_RETRIES - 1) {
                    console.log(`[resources] fetchViaProxy timeout (attempt ${attempt + 1}/${MAX_RETRIES}) for ${url}, retrying`);
                    continue;
                }
                console.log('[resources] fetchViaProxy timeout exhausted:', { url });
                const err = `Error: Request timed out for ${url}`;
                toolErrorCache.set(url, err, 'transient');
                return err;
            }
            console.log('[resources] fetchViaProxy network error:', { url, error: e instanceof Error ? e.message : String(e) });
            const err = `Error: Proxy request failed for ${url}: ${e instanceof Error ? e.message : String(e)}`;
            toolErrorCache.set(url, err, 'transient');
            return err;
        }
    }
    const err = `Error: Rate limited. Max retries reached for ${url}`;
    toolErrorCache.set(url, err, 'transient');
    return err;
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
