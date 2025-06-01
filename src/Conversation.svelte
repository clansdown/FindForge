<script lang="ts">
  import type { Config } from './types';
  export let config: Config;
</script>

<div class="conversation">
  <h2>Conversation</h2>
  <!-- Conversation content will go here -->
</div>

<style>
  .conversation {
    height: 100%;
    overflow-y: auto;
    padding: 1rem;
  }
</style>
