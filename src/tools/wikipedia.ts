import type { ToolDefinition, ToolExecutionContext } from '../lib/types';

export const WIKIPEDIA_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'wikipedia_search',
        description:
            'Search Wikipedia for information on a topic. Returns summaries, key facts, and links. Ideal for general knowledge, history, science, and current events.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search query or topic name',
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
    displayName: 'Wikipedia Search',
    formatArgs(args) { return (args.query as string) || ''; },
    formatResult(result) {
        if (result.startsWith('Error:')) return result;
        const count = (result.match(/^\*\*/gm) || []).length;
        return count > 0 ? `Got ${count} results` : 'No results';
    },
};

export async function executeWikipedia(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<string> {
    const query = args.query as string;
    const limit = Math.min((args.limit as number) || 3, 5);
    if (!query) return 'Error: No search query provided.';

    try {
        const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=${limit}`;
        const searchRes = await fetch(searchUrl);
        const searchData = await searchRes.json();
        const results = searchData.query?.search || [];

        if (results.length === 0) return `No Wikipedia results for "${query}".`;

        const summaries: string[] = [];
        for (const r of results) {
            const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(r.title)}`;
            try {
                const sumRes = await fetch(summaryUrl);
                if (!sumRes.ok) continue;
                const sumData = await sumRes.json();
                summaries.push(
                    `**${sumData.title}**\n${sumData.extract?.slice(0, 500) || 'No summary available.'}\n${sumData.content_urls?.desktop?.page || ''}`,
                );
            } catch {
                summaries.push(`**${r.title}** — https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`);
            }
        }
        return summaries.join('\n\n') || `No detailed results for "${query}".`;
    } catch (e) {
        return `Wikipedia search failed: ${e instanceof Error ? e.message : String(e)}`;
    }
}
