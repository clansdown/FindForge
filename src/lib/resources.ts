import type { Resource } from "./types";

export const resourceInstructions = `After you are done with that, add a section that begins with <RESOURCES> and ends with </RESOURCES>. Inside of the RESOURCES section, provide a list of the resources you used to gather information. Each resource should begin with <RESOURCE> and end with </RESOURCE>. The resource should begin with the URL wrapped in <URL> and </URL> tags. Include relevant information from the resource such as the title (wrapped in <TITLE> </TITLE> tags), author or authors (wrapped in <AUTHOR> </AUTHOR> tags), and date (wrapped in <DATE> </DATE> tags). Also give a description of the kind of resource it is (e.g. journal article, scientific study, personal blog post, professional blog post, corporate blog post, news article, etc.) wrapped in <TYPE> and </TYPE> tags. Indicate why the resource was written and published, especially if it is meant to persuade, educate, get business, advertise, provide SEO chum, etc. wrapped in <PURPOSE> and </PURPOSE> tags. Include a two to four sentence rich and descriptive summary of the resource wrapped in <SUMMARY> and </SUMMARY> tags.`;

export function parseResourcesFromContent(content: string): Resource[] {
    const resources: Resource[] = [];
    const resourceRegex = /<RESOURCE>(.*?)<\/RESOURCE>/gs;
    let resourceMatch;
    while ((resourceMatch = resourceRegex.exec(content)) !== null) {
        const resourceBlock = resourceMatch[1];
        const urlMatch = /<URL>(.*?)<\/URL>/s.exec(resourceBlock);
        const titleMatch = /<TITLE>(.*?)<\/TITLE>/s.exec(resourceBlock);
        const authorMatch = /<AUTHOR>(.*?)<\/AUTHOR>/s.exec(resourceBlock);
        const dateMatch = /<DATE>(.*?)<\/DATE>/s.exec(resourceBlock);
        const typeMatch = /<TYPE>(.*?)<\/TYPE>/s.exec(resourceBlock);
        const purposeMatch = /<PURPOSE>(.*?)<\/PURPOSE>/s.exec(resourceBlock);
        const summaryMatch = /<SUMMARY>(.*?)<\/SUMMARY>/s.exec(resourceBlock);

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
    return resources;
}
