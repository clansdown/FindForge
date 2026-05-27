<script lang="ts">
  import type { ApplicationMode, Config } from './lib/types';
  import Settings from './Settings.svelte';
  import About from './About.svelte';
  import GettingStarted from './GettingStarted.svelte';
  import ToolsHelp from './ToolsHelp.svelte';
  import ModalDialog from './lib/ModalDialog.svelte';
  import { onMount } from 'svelte';
  import type { Writable } from 'svelte/store';
  import { creditStore } from './lib/creditStore';
  import { cloudSyncStore, triggerManualSync, enableCloudSync, isSignedIn, getClerk } from './cloudSync';

  export let config: Config;

  function copyConfig() {
    const configCopy = JSON.parse(JSON.stringify(config));
    configCopy.apiKey = '[redacted]';
    navigator.clipboard.writeText(JSON.stringify(configCopy, null, 2));
  }

  export let showHistory: boolean;
  export let newConversation: () => void;
  export let applicationMode: Writable<ApplicationMode>;

  let activeMenu: string | null = null;
  let showSettings = false;
  let showAbout = false;
  let showGettingStarted = false;
  let showTools = false;
  let signedIn = isSignedIn();

  function toggleMenu(menu: string) {
    activeMenu = activeMenu === menu ? null : menu;
  }

  function closeMenu() {
    activeMenu = null;
  }

  function handleManualSync() {
    if (!syncState.enabled) {
      enableCloudSync().catch(err => console.error('Failed to enable cloud sync:', err));
      return;
    }
    triggerManualSync().catch(err => console.error('Manual sync failed:', err));
  }

  function handleSignIn() {
    const clerk = getClerk();
    if (clerk) clerk.openSignIn();
  }

  function handleSignOut() {
    const clerk = getClerk();
    if (clerk) clerk.signOut();
  }

  onMount(() => {
    const handleOpenSettings = () => {
      showSettings = true;
    };

    document.addEventListener('openSettings', handleOpenSettings);

    const clerk = getClerk();
    if (clerk) {
      clerk.addListener(() => {
        signedIn = isSignedIn();
      });
    }

    return () => {
      document.removeEventListener('openSettings', handleOpenSettings);
    };
  });

  $: syncState = $cloudSyncStore;
</script>

<div class="menu-bar" role="navigation" aria-label="Main menu" on:mouseleave={closeMenu}>
  <div class="menu-item">
    <button on:click={() => toggleMenu('file')}>App</button>
    {#if activeMenu === 'file'}
      <div class="dropdown">
        <button on:click={() => { newConversation(); closeMenu(); }}>New Topic</button>
        <div class="menu-separator"></div>
        <button on:click={() => { $applicationMode = 'research';  }}>
          {#if $applicationMode === 'research'}✓{:else}&nbsp;&nbsp;&nbsp;{/if} Research
        </button>
        <button on:click={() => { $applicationMode = 'brainstorming';  }}>
          {#if $applicationMode === 'brainstorming'}✓{:else}&nbsp;&nbsp;&nbsp;{/if} Brainstorming
        </button>
      </div>
    {/if}
  </div>

  <div class="menu-item">
    <button on:click={() => toggleMenu('view')}>View</button>
    {#if activeMenu === 'view'}
      <div class="dropdown">
        <button on:click={() => { showHistory = !showHistory; closeMenu(); }}>
          {#if showHistory}✓{/if} History
        </button>
        <div class="menu-separator"></div>
        <button on:click={() => { showSettings = true; closeMenu(); }}>
          Settings
        </button>
      </div>
    {/if}
  </div>

  <div class="menu-item">
    <button on:click={() => toggleMenu('help')}>Help</button>
    {#if activeMenu === 'help'}
      <div class="dropdown">
        <button on:click={() => { showGettingStarted = true; closeMenu(); }}>Getting Started</button>
        <button on:click={() => { showTools = true; closeMenu(); }}>Tools</button>
        <button on:click={() => { showAbout = true; closeMenu(); }}>About</button>
        <button on:click={() => { copyConfig(); closeMenu(); }}>Copy Config</button>
        <button on:click={() => { window.open('https://github.com/clansdown/FindForge', '_blank'); closeMenu(); }}>Source Code</button>
      </div>
    {/if}
  </div>

  <div class="spacer"></div>

  {#if getClerk()}
    <button class="auth-btn" on:click={signedIn ? handleSignOut : handleSignIn}>
      {signedIn ? 'Sign Out' : 'Sign In'}
    </button>
  {/if}

  {#if signedIn}
  <button class="sync-btn" on:click={handleManualSync} title={syncState.enabled
    ? (syncState.lastSyncTime
      ? 'Last synced: ' + new Date(syncState.lastSyncTime).toLocaleString()
      : 'Sync now')
    : 'Enable cloud sync in Settings'}>
    {#if syncState.isSyncing}
      Syncing...
    {:else if syncState.lastSyncError}
      <span class="sync-error" title={syncState.lastSyncError}>⚠</span>
    {:else}
      ↻
    {/if}
  </button>
  {/if}

  <div class="credits" title="Available balance">
    {#if $creditStore.balance != null}
      {#if $creditStore.unit === 'dollars'}
        ${$creditStore.balance.toFixed(2)}
      {:else}
        {$creditStore.balance} credits
      {/if}
    {:else if $creditStore.isLoading}
      ...
    {/if}
  </div>
</div>

{#if config}
<Settings bind:config bind:isOpen={showSettings} />
{/if}
<About bind:isOpen={showAbout} onClose={() => showAbout = false} />
<ModalDialog isOpen={showGettingStarted} onClose={() => showGettingStarted = false}>
  <GettingStarted />
</ModalDialog>
<ModalDialog isOpen={showTools} onClose={() => showTools = false}>
  <ToolsHelp />
</ModalDialog>

<style>
  .menu-bar {
    display: flex;
    padding: 0.5rem;
    border-bottom: 1px solid #ddd;
    align-items: center;
  }

  .menu-item {
    position: relative;
    margin-right: 1rem;
  }

  .menu-item button {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.5rem 1rem;
  }

  .dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    box-shadow: 0 2px 5px rgba(0,0,0.2,0.4);
    display: flex;
    flex-direction: column;
    min-width: 256px;
    z-index: 100;
    background: #000;
  }

  .dropdown button {
    text-align: left;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid #eee;
  }

  .dropdown button:hover {
    background-color: #454545;
  }

  .menu-separator {
    height: 1px;
    background-color: #333;
    margin: 4px 0;
  }

  .spacer {
    flex: 1;
  }

  .sync-btn {
    background: none;
    border: 1px solid #444;
    border-radius: 4px;
    cursor: pointer;
    padding: 0.25rem 0.75rem;
    margin-right: 1rem;
    color: #888;
    font-size: 0.9rem;
  }

  .sync-btn:hover {
    border-color: #646cff;
    color: #646cff;
  }

  .auth-btn {
    background: none;
    border: 1px solid #444;
    border-radius: 4px;
    cursor: pointer;
    padding: 0.25rem 0.75rem;
    margin-right: 1rem;
    color: #888;
    font-size: 0.9rem;
  }

  .auth-btn:hover {
    border-color: #646cff;
    color: #646cff;
  }

  .sync-error {
    color: #ff6b6b;
  }

  .credits {
    padding: 0.5rem 1rem;
    font-size: 0.8rem;
    color: #888;
    align-self: center;
  }
</style>
