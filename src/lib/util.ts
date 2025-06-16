import type { Annotation, ConversationData, Resource } from "./types";

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


