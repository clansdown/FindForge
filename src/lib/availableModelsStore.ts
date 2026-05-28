import { writable } from 'svelte/store';
export const availableModelsStore = writable<string[]>([]);
