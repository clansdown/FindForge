import type { Annotation, Config, ConversationData, Model, Resource } from "./types";

export async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

let idCounter = 0;

export function generateID(): string {
    return Date.now().toString(36) + (++idCounter).toString(36);
}

export function escapeHtml(unsafe: string): string {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

export function formatModelName(name: string): string {
    const colonIndex = name.indexOf(': ');
    if (colonIndex !== -1) {
        return name.substring(colonIndex + 2);
    }
    return name;
}

export function formatContextLength(tokens: number): string {
    if (tokens >= 1_000_000) {
        return (tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1) + 'M';
    }
    return Math.round(tokens / 1000) + 'K';
}

export function formatModelLabel(model: { name: string; pricing: { prompt: string; completion: string } }): string {
    const inCost = (parseFloat(model.pricing.prompt) * 1_000_000).toFixed(2);
    const outCost = (parseFloat(model.pricing.completion) * 1_000_000).toFixed(2);
    return `${formatModelName(model.name)} ($${inCost}/$${outCost})`;
}

export function extractConversationReferences(conversation: ConversationData): {
    resources: Resource[];
    annotations: Annotation[];
} {
    const results = {
        resources: [] as Resource[],
        annotations: [] as Annotation[]
    };

    for (const message of conversation.messages) {
        if (message.resources) {
            results.resources.push(...message.resources);
        }
        if (message.annotations) {
            results.annotations.push(...message.annotations);
        }
    }

    return results;
}


interface BraveNavigator extends Navigator {
  brave?: { isBrave: () => Promise<boolean> };
}
export async function isBraveOrChromium(): Promise<boolean> {
    const nav = navigator as BraveNavigator;
    // Brave sets window.navigator.brave
    // Chromium-based browsers can be detected by user agent
    console.log("User Agent:", navigator.userAgent);
    return (nav.brave?.isBrave?.() ?? Promise.resolve(false)) ||
           /Chromium/.test(navigator.userAgent);
}

export function extractRatings(content: string): Map<string, number> {
    const ratings = new Map<string, number>();
    const tagRe = /<RATING\s[^>]*\/?>/gi;
    let match;
    while ((match = tagRe.exec(content)) !== null) {
        const id = match[0].match(/(?:tool_call_id|tool|tool_name)="([^"]+)"/i)?.[1];
        const score = parseInt(match[0].match(/score="(\d+)"/i)?.[1] || '0', 10);
        if (id && score >= 1 && score <= 10) ratings.set(id, score);
    }
    return ratings;
}

export function lookupRating(
    ratings: Map<string, number>,
    tcId: string,
    tcName: string,
): number | undefined {
    return ratings.get(tcId) ?? ratings.get(tcName);
}

export function stripRatings(content: string): string {
    return content
        .replace(/<ratings>[\s\S]*?<\/ratings>/gi, '')
        .replace(/<RATING\s[^>]*\/?>/gi, '');
}

export function resolveQuickQuestionModel(config: Config, models: Model[]): string {
    const enabledModels = models.filter(m => m.allowed);
    if (enabledModels.length === 0) return config.defaultModel;

    if (config.quickQuestionModel && enabledModels.some(m => m.id === config.quickQuestionModel)) {
        return config.quickQuestionModel;
    }

    if (config.defaultModel && enabledModels.some(m => m.id === config.defaultModel)) {
        return config.defaultModel;
    }

    const sorted = [...enabledModels].sort((a, b) => {
        return parseFloat(a.pricing.prompt) - parseFloat(b.pricing.prompt);
    });
    return sorted[0].id;
}

/**
 * Roughly estimates how many tokens a string would consume in a language-model
 * context window, using simple heuristics and no external tokenizer.
 *
 * **Heuristic breakdown:**
 *
 * +-----------------------+-------------------+----------------------------------+
 * | Character class       | Tokens per unit   | Notes                            |
 * +-----------------------+-------------------+----------------------------------+
 * | CJK (Han ideographs)  | 1 per character   | Chinese, Japanese kanji,         |
 * |                       |                   | Korean hanja; covers major       |
 * |                       |                   | CJK Unicode blocks.              |
 * | Roman-alphabet words  | 1.33 per group    | A *group* is a run of letters    |
 * | (incl. accented       |                   | (a–z, A–Z, 0–9, `_`, plus       |
 * | Latin: é, ñ, ü, …)   |                   | accented Latin \u{00C0}–\u{024F} |
 * | Single punctuation    | 1 per character   | Every non-CJK, non-whitespace    |
 * |                       |                   | character outside a word group   |
 * |                       |                   | gets its own slot. E.g. `"(foo)"`|
 * |                       |                   | → `(`, `foo`, `)` → 3 groups.   |
 * +-----------------------+-------------------+----------------------------------+
 *
 * CJK characters are **counted first and then stripped**, so a mixed string
 * like `"你好 world"` yields `2 (CJK) + 2 × 1.33 (world, hello) ≈ 5` tokens.
 *
 * The 1.33 multiplier is a common approximation for GPT-family BPE tokenizers
 * on English/European text. The result is `Math.ceil`'d so callers can safely
 * compare against hard context limits without tripping over decimals.
 */
const CJK_RE = /[\u{4E00}-\u{9FFF}\u{3400}-\u{4DBF}\u{F900}-\u{FAFF}\u{2F800}-\u{2FA1F}\u{20000}-\u{2A6DF}]/gu;
const WORD_GROUP_RE = /[a-zA-Z0-9_\u{00C0}-\u{024F}]+|[^\s]/gu;

export function estimateTokenCount(text: string): number {
    const cjkCount = (text.match(CJK_RE) || []).length;
    const nonCjk = text.replace(CJK_RE, '');
    const groups = (nonCjk.match(WORD_GROUP_RE) || []).length;
    return Math.ceil(cjkCount + groups * 1.33);
}

