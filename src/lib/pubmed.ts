const WEB_PROXY_BASE_URL = import.meta.env.DEV
    ? '/web-proxy'
    : 'https://findforge-web-proxy.chris-f57.workers.dev';

export async function pmidToPmcid(pmid: string, token: string): Promise<string | null> {
    const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${encodeURIComponent(pmid)}&retmode=json`;

    const tryFetch = async (useProxy: boolean): Promise<string | null> => {
        const resp = await (useProxy
            ? fetch(WEB_PROXY_BASE_URL + '/', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                  body: JSON.stringify({ url }),
                  signal: AbortSignal.timeout(15000),
              })
            : fetch(url, { signal: AbortSignal.timeout(15000) })
        );
        if (!resp.ok) return null;
        const data = await resp.json();
        const entry = (data.result?.[pmid]?.articleids || []).find(
            (id: { idtype: string }) => id.idtype === 'pmc' || id.idtype === 'pmcid'
        );
        return entry?.value?.replace(/^PMC/i, '') || null;
    };

    try {
        const result = await tryFetch(false);
        if (result !== null) return result;
    } catch { /* fall through to proxy */ }

    try { return await tryFetch(true); } catch { return null; }
}

export function normalizePmcid(pmcid: string): string {
    return pmcid.replace(/^PMC/i, '');
}

export async function fetchPmcXml(pmcid: string, token: string): Promise<string> {
    const normalized = normalizePmcid(pmcid);
    const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=${encodeURIComponent(normalized)}&retmode=xml`;

    const MAX_ATTEMPTS = 3;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
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

            if (res.status === 429) {
                const retryAfter = parseInt(res.headers.get('Retry-After') || '60', 10);
                console.log(`[pubmed] Rate limited for PMC ${pmcid}, retry ${attempt + 1}/${MAX_ATTEMPTS} after ${retryAfter}s`);
                await new Promise(r => setTimeout(r, retryAfter * 1000));
                continue;
            }

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
    return 'Error: PubMed Central rate limit exceeded. Max retries reached.';
}
