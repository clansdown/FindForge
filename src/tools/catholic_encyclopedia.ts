import type { ToolDefinition, ToolExecutionContext } from '../lib/types';

export const CATHOLIC_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'catholic_encyclopedia_search',
        description:
            'Search the Catholic Encyclopedia for authoritative information on Catholic doctrine, history, saints, liturgy, and theology.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: "Search term or topic, e.g. 'Transubstantiation', 'Council of Trent'",
                },
                limit: {
                    type: 'integer',
                    description: 'Number of results (default 3, max 5)',
                    default: 3,
                },
            },
            required: ['query'],
        },
    },
    displayName: 'Catholic Encyclopedia Search',
    formatArgs(args) { return (args.query as string) || ''; },
    formatResult(result) {
        if (result.startsWith('Error:')) return result;
        const count = (result.match(/^\*\*/gm) || []).length;
        return count > 0 ? `Got ${count} results` : 'No results';
    },
};

export async function executeCatholicEncyclopedia(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<string> {
    const query = args.query as string;
    const limit = Math.min((args.limit as number) || 3, 5);
    if (!query) return 'Error: No search query provided.';

    try {
        const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query + ' site:newadvent.org/cathen')}&format=json&origin=*&srlimit=${limit}`;
        const searchRes = await fetch(searchUrl);
        const searchData = await searchRes.json();
        const results = searchData.query?.search || [];

        if (results.length === 0) return `No Catholic Encyclopedia results for "${query}".`;

        const entries: string[] = [];
        for (const r of results) {
            entries.push(
                `**${r.title.replace(/ - Wikipedia$/, '')}**\n${r.snippet.replace(/<[^>]+>/g, '')}\nhttps://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
            );
        }
        return entries.join('\n\n') || `No detailed results for "${query}".`;
    } catch (e) {
        return `Catholic Encyclopedia search failed: ${e instanceof Error ? e.message : String(e)}`;
    }
}
