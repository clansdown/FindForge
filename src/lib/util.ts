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

