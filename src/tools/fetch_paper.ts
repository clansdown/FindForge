import type { ToolDefinition, ToolExecutionContext } from '../lib/types';
import { getClerkToken } from '../auth';
import { getCachedPaper, setCachedPaper, getCachedCrossrefMeta, setCachedCrossrefMeta } from '../lib/paperCache';
import Extract2MDConverter from 'extract2md';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { WEB_PROXY_BASE_URL } from './web_fetch';
import { getFromCache, addToCache } from '../lib/docCache';
import { CROSSREF_MAILTO } from '../lib/http';
import { executeWikipedia } from './wikipedia';

// ── Identifier Pattern Detection ──

const ARXIV_ID_REGEX = /^(\d{4}\.\d{4,5})(v\d+)?$/i;
const DOI_REGEX = /^10\.\d{4,9}\//;
const ARXIV_URL_REGEX = /arxiv\.org\/(?:abs|html|pdf)\/(\d{4}\.\d{4,5})(v\d+)?/i;
const BIORXIV_URL_REGEX = /biorxiv\.org\/content\/(10\.\d{4,9}\/[^?#\s]+)/i;
const MEDRXIV_URL_REGEX = /medrxiv\.org\/content\/(10\.\d{4,9}\/[^?#\s]+)/i;
const DOI_URL_REGEX = /(?:doi\.org|dx\.doi\.org)\/(10\.\d{4,9}\/[^?#\s]+)/i;
const URL_REGEX = /^https?:\/\//i;
const WIKIPEDIA_URL_REGEX = /^https?:\/\/([a-z]{2,3})\.wikipedia\.org\/wiki\/([^#?/]+)/i;

// ── Tool Definition ──

export const FETCH_PAPER_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'fetch_paper',
        description:
            'Use this to retrieve the full text of any academic or scientific paper for analysis. ' +
            'Provide a DOI (e.g. 10.1038/s41586-023-...), arXiv ID (e.g. 2402.08954), or direct URL. ' +
            'Best for: reading paper contents, extracting methods/results, checking citations, or ' +
            'understanding a paper before citing it yourself.',
        parameters: {
            type: 'object',
            properties: {
                document_id: {
                    type: 'string',
                    description:
                        'DOI (e.g. 10.1038/s41586-023-...), arXiv ID (e.g. 2402.08954), or URL to a paper ' +
                        '(arxiv.org, biorxiv.org, medrxiv.org, doi.org, or any publisher page).',
                },
                force_refetch: {
                    type: 'boolean',
                    description: 'If true, bypass in-memory cache and re-fetch.',
                    default: false,
                },
            },
            required: ['document_id'],
        },
    },
    displayName: 'Fetch Full Paper',
    formatArgs(args) {
        return (args.document_id as string) || '';
    },
    formatResult(result) {
        if (result.startsWith('Error:')) return result;
        if (result.includes('arXiv HTML')) return 'Got from arXiv';
        if (result.includes('bioRxiv full-text')) return 'Got from bioRxiv';
        if (result.includes('extracted from PDF')) {
            const size = result.length;
            const sizeStr = size > 1000 ? `${(size / 1000).toFixed(1)}k` : `${size}b`;
            return `Got paper (${sizeStr})`;
        }
        if (result.includes('via Readability')) {
            const size = result.length;
            const sizeStr = size > 1000 ? `${(size / 1000).toFixed(1)}k` : `${size}b`;
            return `Got page (${sizeStr})`;
        }
        return `Got result (${result.length}b)`;
    },
    isCacheable: true,
    cacheTTLMs: 300_000,
    resourceMapper(args, result) {
        if (result.startsWith('Error:')) return null;
        const id = args.document_id as string;
        if (!id) return null;
        const titleMatch = result.match(/^# (.+)/m);
        const title = titleMatch ? titleMatch[1].trim() : undefined;
        let url = id;
        if (!url.startsWith('http')) {
            if (/^\d{4}\.\d{4,5}/.test(id)) url = `https://arxiv.org/abs/${id}`;
            else if (/^10\./.test(id)) url = `https://doi.org/${id}`;
        }
        return { url, title, type: 'paper' };
    },
};

// ── Identifier Extraction (maximum-flexibility parser) ──

interface ExtractedId {
    type: 'doi' | 'arxiv' | 'wikipedia' | 'url';
    value: string;
    cacheKey: string;
}

function extractIdentifier(raw: string): ExtractedId {
    const s = raw.trim();

    if (URL_REGEX.test(s)) {
        const arxivMatch = s.match(ARXIV_URL_REGEX);
        if (arxivMatch) return { type: 'arxiv', value: arxivMatch[1], cacheKey: arxivMatch[0] };

        const biorxivMatch = s.match(BIORXIV_URL_REGEX) || s.match(MEDRXIV_URL_REGEX);
        if (biorxivMatch) {
            const doi = biorxivMatch[1].replace(/\.full$/, '').replace(/v\d+$/, '');
            return { type: 'doi', value: doi, cacheKey: biorxivMatch[0] };
        }

        const doiUrlMatch = s.match(DOI_URL_REGEX);
        if (doiUrlMatch) return { type: 'doi', value: doiUrlMatch[1], cacheKey: s };

        const wikiMatch = s.match(WIKIPEDIA_URL_REGEX);
        if (wikiMatch) {
            const title = decodeURIComponent(wikiMatch[2].replace(/_/g, ' '));
            return { type: 'wikipedia', value: title, cacheKey: s };
        }

        return { type: 'url', value: s, cacheKey: s };
    }

    const cleanForArxiv = s.replace(/^(arxiv:|arXiv:)/, '').trim();
    if (ARXIV_ID_REGEX.test(cleanForArxiv)) {
        return { type: 'arxiv', value: cleanForArxiv.replace(/v\d+$/, ''), cacheKey: s };
    }

    if (DOI_REGEX.test(s)) return { type: 'doi', value: s, cacheKey: s };

    return { type: 'arxiv', value: cleanForArxiv, cacheKey: s };
}

// ── Crossref Helpers ──

async function resolveDoiViaCrossref(doi: string): Promise<Record<string, unknown> | null> {
    const cached = getCachedCrossrefMeta(doi);
    if (cached) return cached;
    try {
        const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}?mailto=${CROSSREF_MAILTO}`;
        const resp = await fetch(url);
        if (!resp.ok) {
            console.warn('[fetch_paper] Crossref resolution failed:', { doi, status: resp.status });
            return null;
        }
        const data = await resp.json();
        const item = data.message || null;
        if (item) setCachedCrossrefMeta(doi, item);
        return item;
    } catch (e) {
        console.warn('[fetch_paper] Crossref resolution error:', { doi, error: e instanceof Error ? e.message : String(e) });
        return null;
    }
}

async function resolveArxivViaCrossref(arxivId: string): Promise<Record<string, unknown> | null> {
    const cacheKey = `arXiv:${arxivId}`;
    const cached = getCachedCrossrefMeta(cacheKey);
    if (cached) return cached;
    try {
        const url = `https://api.crossref.org/works?filter=doi:10.48550/arXiv.${arxivId}&mailto=${CROSSREF_MAILTO}`;
        const resp = await fetch(url);
        if (!resp.ok) {
            console.warn('[fetch_paper] Crossref arXiv resolution failed:', { arxivId, status: resp.status });
            return null;
        }
        const data = await resp.json();
        const items = data.message?.items || [];
        if (!items.length) {
            console.warn('[fetch_paper] Crossref arXiv resolution returned no results:', { arxivId });
            return null;
        }
        const item = items[0] as Record<string, unknown>;
        setCachedCrossrefMeta(cacheKey, item);
        return item;
    } catch (e) {
        console.warn('[fetch_paper] Crossref arXiv resolution error:', { arxivId, error: e instanceof Error ? e.message : String(e) });
        return null;
    }
}

// ── HTML → Markdown ──

function stripArxivHtmlToMd(html: string): string {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        doc.querySelectorAll(
            'nav, header, footer, #arxiv-header, .ltx_navbar, .ltx_footer, ' +
            '.ltx_role_author, .ltx_role_creation, .ltx_role_dates, ' +
            '#comments, .ltx_banner, .ltx_abs, .ltx_keywords, ' +
            '[class*="sidebar"], [class*="header"], [class*="nav"], ' +
            '.arxiv-title, .arxiv-authors, .arxiv-doi, .arxiv-history'
        ).forEach(el => el.remove());
        const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
        return turndownService.turndown(doc.body.innerHTML).trim();
    } catch { return html; }
}

async function fetchViaProxy(url: string, token: string): Promise<string> {
    try {
        const res = await fetch(WEB_PROXY_BASE_URL + '/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ url }),
            signal: AbortSignal.timeout(15000),
        });
        if (res.ok) return await res.text();
        const body = await res.json().catch(() => ({}));
        const code = body?.code as string | undefined;
        console.warn('[fetch_paper] Proxy response:', { status: res.status, url, code: code || 'none' });

        if (res.status === 401) {
            console.warn('[fetch_paper] Session expired, retrying with fresh token');
            const freshToken = await getClerkToken({ skipCache: true });
            if (freshToken) {
                const retryRes = await fetch(WEB_PROXY_BASE_URL + '/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + freshToken },
                    body: JSON.stringify({ url }),
                    signal: AbortSignal.timeout(15000),
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
            console.warn('[fetch_paper] Proxy 502 — upstream unreachable:', { url });
            return `Error: Could not reach ${url}`;
        }
        return `Error: Proxy returned HTTP ${res.status} (${code || 'unknown'}) for ${url}`;
    } catch (e) {
        if (e instanceof DOMException && e.name === 'TimeoutError') {
            console.warn('[fetch_paper] Proxy request timed out:', { url });
            return `Error: Request timed out for ${url}`;
        }
        console.warn('[fetch_paper] Proxy network error:', { url, error: e instanceof Error ? e.message : String(e) });
        return `Error: Proxy request failed for ${url}: ${e instanceof Error ? e.message : String(e)}`;
    }
}

async function fetchAndReadability(url: string, token: string): Promise<string> {
    const html = await fetchViaProxy(url, token);
    if (html.startsWith('Error:')) return html;
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const article = new Readability(doc).parse();
        if (article && article.textContent && article.textContent.trim().length > 100) {
            return `# ${article.title || 'Paper'}\n\n${article.textContent.trim()}`;
        }
        doc.querySelectorAll('nav, header, footer, script, style, iframe, [class*="sidebar"], [class*="nav"], [class*="header"]')
            .forEach(el => el.remove());
        const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
        return turndownService.turndown(doc.body.innerHTML).trim();
    } catch { return html.substring(0, 100000); }
}

// ── Executor ──

export async function executeFetchPaper(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<string> {
    const rawInput = (args.document_id as string || '').trim();
    const forceRefetch = args.force_refetch === true;
    if (!rawInput) return 'Error: No document_id provided.';

    const extracted = extractIdentifier(rawInput);
    const cacheKey = extracted.cacheKey;

    if (!forceRefetch) {
        const cached = getCachedPaper(cacheKey);
        if (cached) return `<!-- fetched (cached ${cached.format} → Markdown) -->\n\n${cached.content}`;
    }

    const token = await getClerkToken();

    if (extracted.type === 'wikipedia') {
        ctx.onStatus?.('Delegating to Wikipedia...');
        return executeWikipedia({ mode: 'fetch', title: extracted.value }, ctx);
    }

    if (extracted.type === 'url') {
        if (!token) return 'Error: Sign in to enable paper fetching (CORS proxy requires authentication).';
        const cached = await getFromCache(extracted.value);
        if (cached) {
            ctx.onStatus?.('');
            const text = await cached.text();
            setCachedPaper(cacheKey, { format: 'html', content: text });
            return `<!-- fetched from cache -->\n\n${text}`;
        }
        ctx.onStatus?.('Fetching page content...');
        const content = await fetchAndReadability(extracted.value, token);
        if (content.startsWith('Error:')) return content;
        addToCache(extracted.value, content, 'text/html').catch(() => {});
        setCachedPaper(cacheKey, { format: 'html', content });
        return `<!-- fetched from ${extracted.value} via Readability -->\n\n${content}`;
    }

    if (extracted.type === 'arxiv') {
        ctx.onStatus?.('Resolving document identifier...');
        const crossrefItem = await resolveArxivViaCrossref(extracted.value);
        const title = ((crossrefItem?.title as string[])?.[0]) || 'arXiv Paper';
        const htmlUrl = `https://arxiv.org/html/${extracted.value}`;
        if (!token) return 'Error: Sign in to enable paper fetching (CORS proxy requires authentication).';
        const cached = await getFromCache(htmlUrl);
        if (cached) {
            ctx.onStatus?.('');
            const html = await cached.text();
            const md = stripArxivHtmlToMd(html);
            setCachedPaper(cacheKey, { format: 'html', content: md });
            return `<!-- fetched from cache -->\n\n# ${title}\n\n${md}`;
        }
        ctx.onStatus?.('Fetching paper from arXiv...');
        const htmlText = await fetchViaProxy(htmlUrl, token);
        if (htmlText.startsWith('Error:')) return htmlText;
        addToCache(htmlUrl, htmlText, 'text/html').catch(() => {});
        const md = stripArxivHtmlToMd(htmlText);
        setCachedPaper(cacheKey, { format: 'html', content: md });
        return `<!-- fetched from arXiv HTML and converted to Markdown -->\n\n# ${title}\n\n${md}`;
    }

    if (extracted.type === 'doi') {
        ctx.onStatus?.('Resolving document identifier...');
        const crossrefItem = await resolveDoiViaCrossref(extracted.value);
        if (!crossrefItem) {
            console.warn('[fetch_paper] DOI not resolved:', { doi: extracted.value });
            return `Error: Could not resolve DOI "${extracted.value}" via Crossref.`;
        }
        const resolvedDoi = (crossrefItem.DOI as string) || extracted.value;
        const title = ((crossrefItem.title as string[])?.[0]) || 'Untitled';

        if (resolvedDoi.toLowerCase().includes('arxiv') || ((crossrefItem.publisher as string) || '').toLowerCase().includes('arxiv')) {
            const arxivNum = (resolvedDoi.match(/arxiv\.(\d{4}\.\d{4,5})/i) || [])[1];
            if (arxivNum) {
                if (!token) return 'Error: Sign in to enable paper fetching (CORS proxy requires authentication).';
                const arxivUrl = `https://arxiv.org/html/${arxivNum}`;
                const cached = await getFromCache(arxivUrl);
                if (cached) {
                    ctx.onStatus?.('');
                    const html = await cached.text();
                    const md = stripArxivHtmlToMd(html);
                    setCachedPaper(cacheKey, { format: 'html', content: md });
                    return `<!-- fetched from cache -->\n\n# ${title}\n\n${md}`;
                }
                ctx.onStatus?.('Fetching paper from arXiv...');
                const htmlText = await fetchViaProxy(arxivUrl, token);
                if (htmlText.startsWith('Error:')) return htmlText;
                addToCache(arxivUrl, htmlText, 'text/html').catch(() => {});
                const md = stripArxivHtmlToMd(htmlText);
                setCachedPaper(cacheKey, { format: 'html', content: md });
                return `<!-- fetched from arXiv HTML and converted to Markdown -->\n\n# ${title}\n\n${md}`;
            }
        }

        if (resolvedDoi.toLowerCase().includes('10.1101/')) {
            if (!token) return 'Error: Sign in to enable paper fetching (CORS proxy requires authentication).';
            const fullUrl = `https://www.biorxiv.org/content/${resolvedDoi}.full`;
            const cached = await getFromCache(fullUrl);
            if (cached) {
                ctx.onStatus?.('');
                const htmlText = await cached.text();
                let cleanContent = htmlText;
                try {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(htmlText, 'text/html');
                    doc.querySelectorAll(
                        'nav, header, footer, .c-article__sidebar, .c-article__information, ' +
                        '[class*="navbar"], [class*="breadcrumb"], .c-article-metrics, .c-article-actions'
                    ).forEach(el => el.remove());
                    const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
                    cleanContent = turndownService.turndown(doc.body.innerHTML).trim();
                } catch { /* fall through */ }
                setCachedPaper(cacheKey, { format: 'html', content: cleanContent });
                return `<!-- fetched from cache -->\n\n# ${title}\n\n${cleanContent}`;
            }
            ctx.onStatus?.('Downloading paper...');
            const htmlText = await fetchViaProxy(fullUrl, token);
            if (htmlText.startsWith('Error:')) return htmlText;
            addToCache(fullUrl, htmlText, 'text/html').catch(() => {});
            let cleanContent = htmlText;
            try {
                const parser = new DOMParser();
                const doc = parser.parseFromString(htmlText, 'text/html');
                doc.querySelectorAll(
                    'nav, header, footer, .c-article__sidebar, .c-article__information, ' +
                    '[class*="navbar"], [class*="breadcrumb"], .c-article-metrics, .c-article-actions'
                ).forEach(el => el.remove());
                const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
                cleanContent = turndownService.turndown(doc.body.innerHTML).trim();
            } catch { /* fall through */ }
            setCachedPaper(cacheKey, { format: 'html', content: cleanContent });
            return `<!-- fetched from bioRxiv full-text HTML and converted to Markdown -->\n\n# ${title}\n\n${cleanContent}`;
        }

        if (!token) return 'Error: Sign in to enable paper fetching (CORS proxy requires authentication).';
        const linkArray = (crossrefItem.link as Array<Record<string, unknown>>) || [];
        const pdfLink = linkArray.find((l: any) => l['content-type'] === 'application/pdf');
        const pdfUrl: string = pdfLink?.URL as string || `https://doi.org/${resolvedDoi}`;

        // Check for previously extracted markdown first
        const extractKey = `extracted:${cacheKey}`;
        const cachedMd = await getFromCache(extractKey);
        if (cachedMd) {
            ctx.onStatus?.('');
            const text = await cachedMd.text();
            setCachedPaper(cacheKey, { format: 'markdown', content: text });
            return `<!-- extracted from PDF via extract2md (cached) -->\n\n# ${title}\n\n${text}`;
        }

        // Check for cached PDF
        const cachedPdf = await getFromCache(pdfUrl);
        if (cachedPdf) {
            ctx.onStatus?.('Converting PDF...');
            const pdfFile = new File([cachedPdf], 'paper.pdf', { type: 'application/pdf' });
            try {
                const quickResult = await Extract2MDConverter.quickConvertOnly(pdfFile);
                const useFull = quickResult.length < pdfFile.size * 0.01;
                const markdownText = useFull
                    ? await Extract2MDConverter.combinedConvertWithLLM(pdfFile)
                    : quickResult;
                setCachedPaper(cacheKey, { format: 'markdown', content: markdownText });
                addToCache(extractKey, markdownText, 'text/markdown').catch(() => {});
                return `<!-- extracted from PDF via extract2md (${useFull ? 'combined+LLM' : 'quick'}) -->\n\n# ${title}\n\n${markdownText}`;
            } catch (e) {
                return `Error: PDF-to-Markdown conversion failed: ${e instanceof Error ? e.message : String(e)}`;
            }
        }

        ctx.onStatus?.('Downloading paper...');
        console.log('[fetch_paper] Fetching PDF:', { pdfUrl, resolvedDoi });
        const pdfRes = await fetch(WEB_PROXY_BASE_URL + '/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ url: pdfUrl }),
            signal: AbortSignal.timeout(30000),
        });
        if (!pdfRes.ok) {
            console.warn('[fetch_paper] PDF proxy non-OK:', { status: pdfRes.status, pdfUrl, resolvedDoi });
            if (pdfRes.status === 403) {
                console.warn('[fetch_paper] Falling back to DOI landing page (403):', { resolvedDoi });
                const fallbackHtml = await fetchViaProxy(`https://doi.org/${resolvedDoi}`, token);
                if (!fallbackHtml.startsWith('Error:')) {
                    try {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(fallbackHtml, 'text/html');
                        doc.querySelectorAll('nav, header, footer, script, style, iframe, [class*="sidebar"], [class*="nav"]')
                            .forEach(el => el.remove());
                        const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
                        const md = turndownService.turndown(doc.body.innerHTML).trim();
                        const result = `<!-- PDF blocked by publisher — fell back to DOI landing page -->\n\n# ${title}\n\n${md}`;
                        setCachedPaper(cacheKey, { format: 'html', content: result });
                        addToCache(cacheKey, result, 'text/markdown').catch(() => {});
                        return result;
                    } catch { /* fall through to error */ }
                }
                console.warn('[fetch_paper] DOI landing page also failed:', { fallbackHtml: fallbackHtml.slice(0, 200) });
            }
            return `Error: PDF proxy returned HTTP ${pdfRes.status} for ${pdfUrl}.`;
        }

        const pdfBlob = await pdfRes.blob();
        addToCache(pdfUrl, pdfBlob, 'application/pdf').catch(() => {});
        const pdfFile = new File([pdfBlob], 'paper.pdf', { type: 'application/pdf' });
        try {
            ctx.onStatus?.('Converting PDF...');
            const quickResult = await Extract2MDConverter.quickConvertOnly(pdfFile);
            const useFull = quickResult.length < pdfBlob.size * 0.01;
            const markdownText = useFull
                ? await Extract2MDConverter.combinedConvertWithLLM(pdfFile)
                : quickResult;
            setCachedPaper(cacheKey, { format: 'markdown', content: markdownText });
            addToCache(extractKey, markdownText, 'text/markdown').catch(() => {});
            return `<!-- extracted from PDF via extract2md (${useFull ? 'combined+LLM' : 'quick'}) -->\n\n# ${title}\n\n${markdownText}`;
        } catch (e) {
            return `Error: PDF-to-Markdown conversion failed: ${e instanceof Error ? e.message : String(e)}`;
        }
    }

    return 'Error: Could not interpret document identifier.';
}
