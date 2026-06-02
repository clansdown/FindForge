import type { Resource } from "./types";
import { RESOURCE_INSTRUCTIONS } from "./prompts";

export const resourceInstructions = RESOURCE_INSTRUCTIONS;

function parseResourceBlock(block: string): Resource | null {
    const urlMatch = /<URL>(.*?)<\/URL>/si.exec(block);
    if (!urlMatch || !urlMatch[1]) return null;

    const titleMatch = /<TITLE>(.*?)<\/TITLE>/si.exec(block);
    const authorMatch = /<AUTHOR>(.*?)<\/AUTHOR>/si.exec(block);
    const dateMatch = /<DATE>(.*?)<\/DATE>/si.exec(block);
    const typeMatch = /<TYPE>(.*?)<\/TYPE>/si.exec(block);
    const purposeMatch = /<PURPOSE>(.*?)<\/PURPOSE>/si.exec(block);
    const summaryMatch = /<SUMMARY>(.*?)<\/SUMMARY>/si.exec(block);

    return {
        url: urlMatch[1].trim(),
        title: titleMatch?.[1]?.trim(),
        author: authorMatch?.[1]?.trim(),
        date: dateMatch?.[1]?.trim(),
        type: typeMatch?.[1]?.trim(),
        purpose: purposeMatch?.[1]?.trim(),
        summary: summaryMatch?.[1]?.trim(),
    };
}

export function parseResourcesFromContent(content: string): Resource[] {
    const resources: Resource[] = [];
    const resourceRegex = /<RESOURCE>(.*?)<\/RESOURCE>/gsi;
    let resourceMatch;
    let matchCount = 0;
    while ((resourceMatch = resourceRegex.exec(content)) !== null) {
        matchCount++;
        const resourceBlock = resourceMatch[1];
        console.log('[resources] parseResourcesFromContent match #' + matchCount + ':', {
            rawBlock: resourceBlock.slice(0, 500),
        });

        const resource = parseResourceBlock(resourceBlock);
        if (resource) {
            resources.push(resource);
        }
    }

    // Fallback: handle unclosed <RESOURCE> at end of content
    const openMatch = content.match(/<RESOURCE>([\s\S]*)$/i);
    if (openMatch) {
        const resourceBlock = openMatch[1];
        const resource = parseResourceBlock(resourceBlock);
        if (resource) {
            matchCount++;
            console.log('[resources] parseResourcesFromContent unclosed match:', {
                rawBlock: resourceBlock.slice(0, 500),
            });
            resources.push(resource);
        }
    }

    console.log('[resources] parseResourcesFromContent:', {
        contentLength: content.length,
        containsResourcesSection: /<RESOURCES>/i.test(content),
        containsResourceTag: /<RESOURCE>/i.test(content),
        matchCount,
        extractedCount: resources.length,
        resources: resources.map(r => ({ url: r.url, title: r.title })),
        contentTail: content.slice(-2000),
    });
    return resources;
}
