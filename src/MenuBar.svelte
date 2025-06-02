<script lang="ts">
  import type { Config } from './lib/types';
  import Settings from './Settings.svelte';
  
  export let config: Config;
  export let newConversation: () => void;
  
  let activeMenu: string | null = null;
  let showSettings = false;
  
  function toggleMenu(menu: string) {
    activeMenu = activeMenu === menu ? null : menu;
  }

  function closeMenu() {
    activeMenu = null;
  }
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
        <button on:click={closeMenu}>History</button>
      </div>
    {/if}
  </div>
  
  <div class="menu-item">
    <button on:click={() => toggleMenu('help')}>Help</button>
    {#if activeMenu === 'help'}
      <div class="dropdown">
        <button on:click={closeMenu}>About</button>
      </div>
    {/if}
  </div>
</div>

<Settings bind:config bind:isOpen={showSettings} />

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
</style>
