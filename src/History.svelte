<script lang="ts">
  import type { Config, ConversationData } from './types';
  export let config: Config;
  export let conversations: ConversationData[];
  export let setCurrentConversation: (conversation: ConversationData) => void;
</script>

<div class="history">
  <h2>History</h2>
  <ul>
    {#each conversations as conversation}
      <li on:click={() => setCurrentConversation(conversation)}>
        <h3>{conversation.title}</h3>
        <p>{conversation.messages[0]?.content?.substring(0, 100) || 'No messages'}</p>
        <small>{new Date(conversation.created).toLocaleString()}</small>
      </li>
    {/each}
  </ul>
</div>

<style>
  .history {
    height: 100%;
    overflow-y: auto;
    padding: 1rem;
  }
  ul {
    list-style: none;
    padding: 0;
  }
  li {
    padding: 0.5rem;
    border-bottom: 1px solid #ccc;
    cursor: pointer;
  }
  li:hover {
    background-color: #f0f0f0;
  }
</style>
