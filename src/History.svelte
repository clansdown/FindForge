<script lang="ts">
  import type { Config, ConversationData } from './types';
  export let config: Config;
  export let conversations: ConversationData[];
  export let setCurrentConversation: (conversation: ConversationData) => void;

  let filter = '';
  $: filteredConversations = filter
    ? conversations.filter(convo => 
        convo.title.toLowerCase().includes(filter.toLowerCase()) ||
        convo.messages[0]?.content?.toLowerCase().includes(filter.toLowerCase())
      )
    : conversations;
</script>

<div class="history">
  <h2>History</h2>
  <input type="text" placeholder="Filter..." bind:value={filter} class="filter-input" />
  <ul>
    {#each filteredConversations as conversation}
      <li>
        <button class="conversation" on:click={() => setCurrentConversation(conversation)}>
        <h3>{conversation.title}</h3>
        <p>{conversation.messages[0]?.content?.substring(0, 100) || 'No messages'}</p>
        <small>{new Date(conversation.created).toLocaleString()}</small>
        </button>
      </li>
    {/each}
  </ul>
</div>

<style>
  .history {
    height: 100%;
    overflow-y: auto;
    padding: .2rem;
  }
  .filter-input {
    width: 90%;
    padding: 0.5rem;
    margin-bottom: 0.5rem;
    margin-right: 1rem;
    border: 1px solid #ccc;
    border-radius: 4px;
  }
  ul {
    border-top: 1px solid #fff;
    list-style: none;
    padding: 0;
  }
  li {
    padding: 0.5rem;
    border-bottom: 1px solid #ccc;
    cursor: pointer;
  }
  li:hover {
    background-color: #999;
  }
  button.conversation {
    background: none;
    border: none;
    width: 100%;
    text-align: left;
    padding: 4px;
  }
  button.conversation:focus {
    outline: none;
  }
  button.conversation:active {
    border: none;
    outline: none;
  }
</style>
