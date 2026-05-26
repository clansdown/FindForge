const WEB_PROXY_BASE_URL = import.meta.env.DEV
    ? '/web-proxy'
    : 'https://findforge-web-proxy.chris-f57.workers.dev';

export async function pmidToPmcid(pmid: string): Promise<string | null> {
    const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${encodeURIComponent(pmid)}&retmode=json`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    const doc = data.result?.[pmid];
    if (!doc) return null;
    const entry = (doc.articleids || []).find(
        (id: { idtype: string }) => id.idtype === 'pmc' || id.idtype === 'pmcid'
    );
    return entry?.value?.replace(/^PMC/i, '') || null;
}

export function normalizePmcid(pmcid: string): string {
    return pmcid.replace(/^PMC/i, '');
}

export async function fetchPmcXml(pmcid: string, token: string): Promise<string> {
    const normalized = normalizePmcid(pmcid);
    const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=${encodeURIComponent(normalized)}&retmode=xml`;

    try {
        const res = await fetch(WEB_PROXY_BASE_URL + '/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token,
            },
            body: JSON.stringify({ url }),
            signal: AbortSignal.timeout(20000),
        });

        if (res.ok) return await res.text();

        if (res.status === 401) {
            const { getClerkToken } = await import('../auth');
            const freshToken = await getClerkToken({ skipCache: true });
            if (freshToken) {
                const retryRes = await fetch(WEB_PROXY_BASE_URL + '/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + freshToken,
                    },
                    body: JSON.stringify({ url }),
                    signal: AbortSignal.timeout(20000),
                });
                if (retryRes.ok) return await retryRes.text();
                return `Error: PMC XML proxy returned HTTP ${retryRes.status} after token refresh.`;
            }
            return 'Error: Session expired — please sign in again.';
        }

        if (res.status === 429) {
            const retryAfter = res.headers.get('Retry-After') || '60';
            return `Error: Rate limited. Retry after ${retryAfter} seconds.`;
        }

        if (res.status === 502) {
            return 'Error: Could not reach PubMed Central (proxy returned 502).';
        }

        return `Error: PMC XML proxy returned HTTP ${res.status}.`;
    } catch (e) {
        if (e instanceof DOMException && e.name === 'TimeoutError') {
            return `Error: Request timed out fetching PMC XML for ${pmcid}.`;
        }
        return `Error: PMC XML fetch failed: ${e instanceof Error ? e.message : String(e)}`;
    }
}
