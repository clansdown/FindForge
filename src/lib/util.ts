export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let idCounter = 0;

export function generateID(): string {                                                                                                                                                                                                              
    return Date.now().toString(36) + (++idCounter).toString(36);
}

export function escapeHtml(unsafe : string) : string {
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