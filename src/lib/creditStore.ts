import { writable } from 'svelte/store';
import type { Config } from './types';
import { fetchOpenRouterCredits } from './models';
import { getClerkToken } from '../auth';

const USERS_WORKER_URL = import.meta.env.DEV
    ? '/users-worker'
    : 'https://findforge-users.chris-f57.workers.dev';

export type CreditInfo = {
    balance: number | null;
    unit: 'dollars' | 'credits' | null;
    isLoading: boolean;
};

export const creditStore = writable<CreditInfo>({
    balance: null,
    unit: null,
    isLoading: false,
});

export async function refreshCredits(config: Config): Promise<void> {
    creditStore.set({ balance: null, unit: null, isLoading: true });

    try {
        if (config.apiKey) {
            const openRouterCredits = await fetchOpenRouterCredits(config.apiKey);
            const remaining = openRouterCredits.total_credits - openRouterCredits.total_usage;
            creditStore.set({ balance: remaining, unit: 'dollars', isLoading: false });
        } else {
            const token = await getClerkToken();
            if (!token) {
                creditStore.set({ balance: null, unit: null, isLoading: false });
                return;
            }
            const resp = await fetch(`${USERS_WORKER_URL}/credits`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (resp.ok) {
                const data = await resp.json() as { credits: number };
                creditStore.set({ balance: data.credits, unit: 'credits', isLoading: false });
            } else {
                creditStore.set({ balance: null, unit: null, isLoading: false });
            }
        }
    } catch (e) {
        console.error('Failed to fetch credits:', e);
        creditStore.set({ balance: null, unit: null, isLoading: false });
    }
}
