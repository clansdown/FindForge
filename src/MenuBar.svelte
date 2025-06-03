<script lang="ts">
  import type { Config, OpenRouterCredits } from './lib/types';
  import Settings from './Settings.svelte';
  import { onMount } from 'svelte';
  
  export let config: Config;
  export let showHistory: boolean;
  export let newConversation: () => void;
  export let credits: OpenRouterCredits | undefined;
  
  let activeMenu: string | null = null;
  let showSettings = false;
  
  function toggleMenu(menu: string) {
    activeMenu = activeMenu === menu ? null : menu;
  }

  function closeMenu() {
    activeMenu = null;
  }

  onMount(() => {
    const handleOpenSettings = () => {
      showSettings = true;
    };

    document.addEventListener('openSettings', handleOpenSettings);

    return () => {
      document.removeEventListener('openSettings', handleOpenSettings);
    };
  });
</script>

<div class="menu-bar" on:mouseleave={closeMenu}>
  <div class="menu-item">
    <button on:click={() => toggleMenu('file')}>File</button>
    {#if activeMenu === 'file'}
      <div class="dropdown">
        <button on:click={() => { newConversation(); closeMenu(); }}>New Conversation</button>
        <button on:click={() => { showSettings = true; closeMenu(); }}>
          Settings
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
      </div>
    {/if}
  </div>
  
  <div class="menu-item">
    <button on:click={() => toggleMenu('help')}>Help</button>
    {#if activeMenu === 'help'}
      <div class="dropdown">
        <button on:click={() => { window.open('https://github.com/clansdown/MachineLearner', '_blank'); closeMenu(); }}>Source Code</button>
        <button on:click={closeMenu}>About</button>
      </div>
    {/if}
  </div>
  
  <div class="credits" title="Available OpenRouter Credits">
    {#if credits}
      Available: ${(credits.total_credits - credits.total_usage).toFixed(2)}
    {/if}
  </div>
</div>

<Settings bind:config bind:isOpen={showSettings} {credits} />

<style>
  .menu-bar {
    display: flex;
    padding: 0.5rem;
    border-bottom: 1px solid #ddd;
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
    box-shadow: 0 2px 5px rgba(0,0,0,0.2);
    display: flex;
    flex-direction: column;
    min-width: 150px;
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
  
  .credits {
    margin-left: auto;
    padding: 0.5rem 1rem;
    font-size: 0.8rem;
    color: #888;
    align-self: center;
  }
</style>
