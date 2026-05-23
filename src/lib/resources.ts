import type { Resource } from "./types";
import { RESOURCE_INSTRUCTIONS } from "./prompts";

export const resourceInstructions = RESOURCE_INSTRUCTIONS;

export function parseResourcesFromContent(content: string): Resource[] {
    const resources: Resource[] = [];
    const resourceRegex = /<RESOURCE>(.*?)<\/RESOURCE>/gs;
    let resourceMatch;
    let matchCount = 0;
    while ((resourceMatch = resourceRegex.exec(content)) !== null) {
        matchCount++;
        const resourceBlock = resourceMatch[1];
        const urlMatch = /<URL>(.*?)<\/URL>/s.exec(resourceBlock);
        const titleMatch = /<TITLE>(.*?)<\/TITLE>/s.exec(resourceBlock);
        const authorMatch = /<AUTHOR>(.*?)<\/AUTHOR>/s.exec(resourceBlock);
        const dateMatch = /<DATE>(.*?)<\/DATE>/s.exec(resourceBlock);
        const typeMatch = /<TYPE>(.*?)<\/TYPE>/s.exec(resourceBlock);
        const purposeMatch = /<PURPOSE>(.*?)<\/PURPOSE>/s.exec(resourceBlock);
        const summaryMatch = /<SUMMARY>(.*?)<\/SUMMARY>/s.exec(resourceBlock);

        console.log('[resources] parseResourcesFromContent match #' + matchCount + ':', {
            rawBlock: resourceBlock.slice(0, 500),
            urlFull: urlMatch?.[1]?.trim(),
            title: titleMatch?.[1]?.trim(),
        });

        if (urlMatch && urlMatch[1]) {
            const resource: Resource = {
                url: urlMatch[1].trim(),
                title: titleMatch && titleMatch[1] ? titleMatch[1].trim() : undefined,
                author: authorMatch && authorMatch[1] ? authorMatch[1].trim() : undefined,
                date: dateMatch && dateMatch[1] ? dateMatch[1].trim() : undefined,
                type: typeMatch && typeMatch[1] ? typeMatch[1].trim() : undefined,
                purpose: purposeMatch && purposeMatch[1] ? purposeMatch[1].trim() : undefined,
                summary: summaryMatch && summaryMatch[1] ? summaryMatch[1].trim() : undefined
            };
            resources.push(resource);
        }
    }
    console.log('[resources] parseResourcesFromContent:', {
        contentLength: content.length,
        containsResourcesSection: content.includes('<RESOURCES>'),
        containsResourceTag: content.includes('<RESOURCE>'),
        matchCount,
        extractedCount: resources.length,
        resources: resources.map(r => ({ url: r.url, title: r.title })),
        contentTail: content.slice(-2000),
    });
    return resources;
}
