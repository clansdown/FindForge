<script lang="ts">
  import type { Config } from './lib/types';
  export let config: Config;

  let conversationDiv: HTMLDivElement;
  let totalCost: number = 0;

</script>

<div class="conversation">
  <h2>Conversation</h2>
  <!-- Toolbar goes here -->
  

  <!-- Conversation content will go here -->
  <div bind:this={conversationDiv} class="conversation-content">
    <!-- This is where the conversation messages will be dynamically inserted -->


  </div>

  <!-- Total Cost goes here -->

  <!-- Chat Input goes here -->

</div>




<style>
  .conversation {
    height: 100%;
    padding: 1rem;
  }
  .conversation-content {
    overflow-y: auto;
    height: 100%;
    width: 100%;
  }
</style>
