<script lang="ts">
  import MenuBar from './MenuBar.svelte';
  import History from './History.svelte';
  import Conversation from './Conversation.svelte';
    import type { Config, ConversationData } from './lib/types';
    import { loadConfig, saveConfig } from './lib/storage';
    import { generateID } from './lib/util';
  
  let config : Config = loadConfig();
  let isDragging = false;
  let splitContainer: HTMLDivElement;
  let currentConversation : ConversationData = {
    id: generateID(),
    title: 'New Conversation',
    messages: [],
    created: new Date().valueOf(),
    updated: new Date().valueOf()
  };

  function startDrag() {
    isDragging = true;
  }
  
  function stopDrag() {
    isDragging = false;
  }
  
  function handleDrag(e: MouseEvent) {
    if (isDragging) {
      let x = e.clientX - splitContainer.getBoundingClientRect().x;
      config.historyWidth = Math.max(100, x);
      saveConfig(config);
      config = config; // Trigger reactivity
    }
  }

  function newConversation() {
    currentConversation = {
      id: generateID(),
      title: 'New Conversation',
      messages: [],
      created: new Date().valueOf(),
      updated: new Date().valueOf()
    };
  }
</script>

<main>
  <MenuBar bind:config={config} {newConversation} />
  <!-- svelte-ignore a11y-click-events-have-key-events a11y_no_noninteractive_element_interactions -->
  <div class="split-container" bind:this={splitContainer} on:mousemove={handleDrag} on:mouseup={stopDrag} on:mouseleave={stopDrag} role="main">
    <div class="history-container" style="width: {config.historyWidth}px">
      <History {config} />
    </div>
    <div class="resize-handle" on:mousedown={startDrag} role="slider" tabindex="0" aria-valuenow={config.historyWidth}></div>
    <div class="conversation-container">
      <Conversation bind:currentConversation={currentConversation} {config} />
    </div>
  </div>
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100%;
  }
  .split-container {
    display: flex;
    height: calc(100vh - 50px); /* Adjust based on menu bar height */
    width: 100%;
  }
  
  .history-container {
    height: 100%;
    overflow: hidden;
  }
  
  .resize-handle {
    width: 5px;
    background-color: #ccc;
    cursor: col-resize;
    height: 100%;
  }
  
  .resize-handle:hover {
    background-color: #646cff;
  }
  
  .conversation-container {
    flex: 1;
    height: 100%;
    width: 100%;
    overflow: hidden;
  }
  

</style>
