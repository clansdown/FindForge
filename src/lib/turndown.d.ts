declare module 'turndown' {
    interface TurndownOptions {
        headingStyle?: 'atx' | 'setext';
        codeBlockStyle?: 'fenced' | 'indented';
        emDelimiter?: '_' | '*';
        strongDelimiter?: '**' | '__';
        bulletListMarker?: '-' | '*' | '+';
        linkStyle?: 'inlined' | 'referenced';
        linkReferenceStyle?: 'full' | 'collapsed' | 'shortcut';
    }

    interface TurndownRule {
        filter: string | string[] | ((node: Node, options: TurndownOptions) => boolean);
        replacement: (content: string, node: Node, options: TurndownOptions) => string;
    }

    class TurndownService {
        constructor(options?: TurndownOptions);
        turndown(html: string | Node): string;
        addRule(key: string, rule: TurndownRule): this;
        keep(filter: string | string[]): this;
        remove(filter: string | string[]): this;
        use(plugin: (service: TurndownService) => void): this;
    }

    export default TurndownService;
}
