import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { initAuth } from './auth'
import { getOPFSHandle, readLocalFile } from './lib/opfs'
import { initCloudSync, setSyncReloadCallback } from './cloudSync'
import { loadConfig, loadConversations } from './lib/storage'

async function init(): Promise<void> {
    // 1. Clerk auth
    await initAuth();

    // 2. Ensure OPFS is namespaced and migrated
    await getOPFSHandle();

    // 3. Load local state before cloud sync runs
    await Promise.all([
        loadConfig().catch(err => console.error('Failed to load config:', err)),
        loadConversations().catch(err => console.error('Failed to load conversations:', err))
    ]);

    // 4. Register reload callback before initCloudSync so sync-triggered reloads work
    setSyncReloadCallback(async (changedPaths: string[]) => {
        for (const path of changedPaths) {
            if (path.startsWith('credentials/')) {
                // Credential changed — reload config to pick up new API key
                try {
                    const newConfig = await loadConfig();
                    // Dispatch event so App.svelte can pick up the new config
                    document.dispatchEvent(new CustomEvent('configUpdated', { detail: newConfig }));
                } catch (err) {
                    console.error('Failed to reload config after credential sync:', err);
                }
            } else if (path.startsWith('preferences/')) {
                // Preferences changed — reload config
                try {
                    const newConfig = await loadConfig();
                    document.dispatchEvent(new CustomEvent('configUpdated', { detail: newConfig }));
                } catch (err) {
                    console.error('Failed to reload config after preference sync:', err);
                }
            } else if (path.startsWith('conversations/')) {
                // Conversation changed — reload and notify
                try {
                    const content = await readLocalFile(path);
                    if (content) {
                        const conv = JSON.parse(content);
                        document.dispatchEvent(new CustomEvent('conversationUpdated', { detail: conv }));
                    }
                } catch (err) {
                    console.error('Failed to reload conversation after sync:', err);
                }
            }
        }
    });

    // 5. Cloud sync — initialize (may be a no-op if not enabled/signed in)
    try {
        await initCloudSync();
    } catch (err) {
        console.error('Failed to init cloud sync:', err);
    }
}

init().then(() => {
    mount(App, {
        target: document.getElementById('app')!,
    });
});
