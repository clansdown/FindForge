export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let idCounter = 0;

export function generateID(): string {                                                                                                                                                                                                              
    return Date.now().toString(36) + (++idCounter).toString(36);
}