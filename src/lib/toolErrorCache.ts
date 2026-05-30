export type ErrorCategory = 'transient' | 'permanent';

const TRANSIENT_TTL_MS = 5 * 60 * 1000;
const PERMANENT_TTL_MS = 48 * 60 * 60 * 1000;
const TTL: Record<ErrorCategory, number> = {
    transient: TRANSIENT_TTL_MS,
    permanent: PERMANENT_TTL_MS,
};

class ToolErrorCache {
    private cache = new Map<string, { error: string; expiresAt: number }>();

    /** Returns cached error string, or null if not found / expired. */
    get(key: string): string | null {
        const entry = this.cache.get(key);
        if (!entry) return null;
        if (Date.now() >= entry.expiresAt) {
            this.cache.delete(key);
            return null;
        }
        return entry.error;
    }

    /** Store an error with a definite category. */
    set(key: string, error: string, category: ErrorCategory): void {
        this.cache.set(key, { error, expiresAt: Date.now() + TTL[category] });
    }

    /** Remove all cached errors (e.g. on research start). */
    clear(): void {
        this.cache.clear();
    }
}

export const toolErrorCache = new ToolErrorCache();
