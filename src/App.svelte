<script lang="ts">
  import MenuBar from './lib/MenuBar.svelte';
  import History from './lib/History.svelte';
  import Conversation from './lib/Conversation.svelte';
  
  let historyWidth = 400; // Increased initial width
  let isDragging = false;
  
  function startDrag() {
    isDragging = true;
  }
  
  function stopDrag() {
    isDragging = false;
  }
  
  function handleDrag(e: MouseEvent) {
    if (isDragging) {
      historyWidth = Math.max(100, Math.min(e.clientX, window.innerWidth - 100));
    }
  }
</script>

<main>
  <MenuBar />
  <div class="split-container" on:mousemove={handleDrag} on:mouseup={stopDrag} on:mouseleave={stopDrag}>
    <div class="history-container" style="width: {historyWidth}px">
      <History />
    </div>
    <div class="resize-handle" on:mousedown={startDrag} />
    <div class="conversation-container">
      <Conversation />
    </div>
  </div>
</main>

<style>
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
    overflow: hidden;
  }
  
  /* Existing styles remain unchanged */
  .logo {
    height: 6em;
    padding: 1.5em;
    will-change: filter;
    transition: filter 300ms;
  }
  .logo:hover {
    filter: drop-shadow(0 0 2em #646cffaa);
  }
  .logo.svelte:hover {
    filter: drop-shadow(0 0 2em #ff3e00aa);
  }
  .read-the-docs {
    color: #888;
  }
</style>
