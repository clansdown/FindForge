// In-memory paper cache, persists for the full page session.
// arXiv ↔ bioRxiv ↔ general PDF results are cached by normalized document ID
// so the LLM never re-fetches the same paper in a conversation.

interface CachedPaper {
    timestamp: number;
    content: string;
    format: 'html' | 'markdown';
}

interface CachedCrossrefMeta {
    timestamp: number;
    item: Record<string, unknown>;
}

const paperCache = new Map<string, CachedPaper>();
const crossrefMetaCache = new Map<string, CachedCrossrefMeta>();

export function getCachedPaper(documentId: string): { format: 'html' | 'markdown'; content: string } | null {
    const key = documentId.toLowerCase().trim();
    const cached = paperCache.get(key);
    if (cached) return { format: cached.format, content: cached.content };
    return null;
}

export function setCachedPaper(documentId: string, result: { format: 'html' | 'markdown'; content: string }): void {
    const key = documentId.toLowerCase().trim();
    paperCache.set(key, { ...result, timestamp: Date.now() });
}

export function getCachedCrossrefMeta(doiOrId: string): Record<string, unknown> | null {
    const key = doiOrId.toLowerCase().trim();
    const cached = crossrefMetaCache.get(key);
    if (cached) return cached.item;
    return null;
}

export function setCachedCrossrefMeta(doiOrId: string, item: Record<string, unknown>): void {
    const key = doiOrId.toLowerCase().trim();
    crossrefMetaCache.set(key, { timestamp: Date.now(), item });
}
