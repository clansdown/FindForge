import type { ToolDefinition, ToolCall, ToolExecutionContext, ToolExecutor, ToolCallRecord } from '../lib/types';
import { ToolCallDeduplicator } from './toolCallDeduplicator';
import { CALCULATOR_TOOL, executeCalculator } from './calculator';
import { WIKIPEDIA_TOOL, executeWikipedia } from './wikipedia';
import { CATHOLIC_TOOL, executeCatholicEncyclopedia } from './catholic_encyclopedia';
import { WEB_FETCH_TOOL, executeWebFetch } from './web_fetch';
import { PUBMED_TOOL, executePubMed } from './pubmed_search';
import { CROSSREF_TOOL, executeCrossrefSearch } from './crossref_search';
import { PUBMED_FETCH_TOOL, executePubMedFetch } from './pubmed_fetch';
import { FETCH_PAPER_TOOL, executeFetchPaper } from './fetch_paper';
import { SEP_TOOL, executeSepSearch } from './stanford_encyclopedia_of_philosophy';
import { FANDOM_TOOL, executeFandomSearch } from './fandom_wikis';
import { DOCUMENT_SEARCH_TOOL, executeDocumentSearch } from './document_search';

export class ToolRegistry {
    private definitions: Map<string, ToolDefinition> = new Map();
    private executors: Map<string, ToolExecutor> = new Map();
    /** Deduplicates identical in-flight tool calls (shared across threads). */
    private deduplicator = new ToolCallDeduplicator();

    register(definition: ToolDefinition, executor: ToolExecutor): void {
        const name = definition.function.name;
        this.definitions.set(name, definition);
        this.executors.set(name, executor);
    }

    getDefinition(name: string): ToolDefinition | undefined {
        return this.definitions.get(name);
    }

    getDefinitions(): ToolDefinition[] {
        return [...this.definitions.values()];
    }

    async execute(name: string, argsJson: string, ctx: ToolExecutionContext): Promise<string> {
        const executor = this.executors.get(name);
        if (!executor) return `Unknown tool: ${name}`;
        let args: Record<string, unknown>;
        try {
            args = JSON.parse(argsJson);
        } catch {
            return `Invalid arguments for tool ${name}: ${argsJson}`;
        }
        return executor(args, ctx);
    }

    async executeAll(toolCalls: ToolCall[], ctx: ToolExecutionContext): Promise<Array<{ tool_call_id: string; role: 'tool'; content: string }>> {
        return Promise.all(
            toolCalls.map(async (tc) => {
                const content = await this.executeWithCache(tc, ctx);
                return { tool_call_id: tc.id, role: 'tool' as const, content };
            }),
        );
    }

    private async executeWithCache(tc: ToolCall, ctx: ToolExecutionContext): Promise<string> {
        const def = this.definitions.get(tc.function.name);
        const args = tc.function.arguments;

        if (def?.isCacheable && ctx.previousToolCalls) {
            const hit = findCacheHit(tc.function.name, args, def, ctx.previousToolCalls);
            if (hit) {
                console.log(`[ToolCache] hit for ${tc.function.name}: reusing cached result (${hit.result.length}b, age=${Date.now() - hit.startTimeMs}ms)`);
                return hit.result;
            }
        }

        try {
            return await this.deduplicator.deduplicate(
                tc.function.name,
                tc.function.arguments,
                (signal) => this.execute(tc.function.name, tc.function.arguments, { ...ctx, signal }),
                ctx.signal,
            );
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`[${tc.function.name}] Execution threw:`, { args: tc.function.arguments, error: msg });
            return `Error: ${tc.function.name} failed: ${msg}`;
        }
    }
}

function findCacheHit(
    name: string,
    argsJson: string,
    def: ToolDefinition,
    previous: ToolCallRecord[],
): ToolCallRecord | undefined {
    for (const prev of previous) {
        if (prev.name !== name) continue;
        if (JSON.stringify(prev.arguments) !== argsJson) continue;
        if (def.cacheTTLMs && def.cacheTTLMs > 0) {
            const age = Date.now() - prev.startTimeMs;
            if (age > def.cacheTTLMs) continue;
        }
        return prev;
    }
    return undefined;
}

export function createToolRegistry(enabledToolNames: string[]): ToolRegistry {
    const registry = new ToolRegistry();

    const tools: Array<{ definition: ToolDefinition; executor: ToolExecutor }> = [
        { definition: CALCULATOR_TOOL, executor: executeCalculator },
        { definition: WIKIPEDIA_TOOL, executor: executeWikipedia },
        { definition: CATHOLIC_TOOL, executor: executeCatholicEncyclopedia },
        { definition: WEB_FETCH_TOOL, executor: executeWebFetch },
        { definition: PUBMED_TOOL, executor: executePubMed },
        { definition: PUBMED_FETCH_TOOL, executor: executePubMedFetch },
        { definition: CROSSREF_TOOL, executor: executeCrossrefSearch },
        { definition: FETCH_PAPER_TOOL, executor: executeFetchPaper },
        { definition: SEP_TOOL, executor: executeSepSearch },
        { definition: FANDOM_TOOL, executor: executeFandomSearch },
        { definition: DOCUMENT_SEARCH_TOOL, executor: executeDocumentSearch },
    ];

    for (const tool of tools) {
        if (enabledToolNames.includes(tool.definition.function.name)) {
            registry.register(tool.definition, tool.executor);
        }
    }

    return registry;
}
