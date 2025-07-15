<script lang="ts">
  import type { Config, ConversationData } from './lib/types';
  export let config: Config;
  export let conversations: ConversationData[];
  export let setCurrentConversation: (conversation: ConversationData) => void;
  export let removeConversation: (conversation: ConversationData) => void;

  let filter = '';
  $: filteredConversations = (filter
    ? conversations.filter(convo => 
        convo.title.toLowerCase().includes(filter.toLowerCase()) ||
        convo.messages[0]?.content?.toLowerCase().includes(filter.toLowerCase())
      )
    : conversations
  ).sort((a, b) => b.updated - a.updated);
</script>

<div class="history">
  <h2>History</h2>
  <div class="filter-container">
    <input type="text" placeholder="Filter..." bind:value={filter} class="filter-input" />
    {#if filter}
      <button class="clear-button" on:click={() => filter = ''}>✕</button>
    {/if}
  </div>
  <ul>
    {#each filteredConversations as conversation}
      <li>
        <div class="conversation-header">
          <h3><button on:click={() => setCurrentConversation(conversation)}>{conversation.title}</button></h3>
          <button class="delete-button" on:click|stopPropagation={() => removeConversation(conversation)}>✕</button>
        </div>
        <button class="conversation" on:click={() => setCurrentConversation(conversation)}>
          <p>{conversation.messages ? conversation.messages[0]?.content?.substring(0, 100) || 'No messages' : ''}</p>
          <div style="text-align: right;"><small>{new Date(conversation.updated).toLocaleString()}</small></div>
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
  .filter-container {
    position: relative;
    width: 90%;
    margin-bottom: 0.5rem;
    margin-right: 1rem;
  }
  .filter-input {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    box-sizing: border-box;
  }
  .clear-button {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    cursor: pointer;
    color: #ccc;
    width: 2rem;
  }
  .clear-button:hover {
    color: #fff;
  }
  ul {
    border-top: 1px solid #fff;
    list-style: none;
    padding: 0 .1rem;
  }
  li {
    padding: 0.5rem;
    border-bottom: 1px solid #ccc;
    cursor: pointer;
  }
  .conversation-header {
    display: flex;
    justify-content: space-between;
    align-items: top;
  }
  .delete-button {
    background: none;
    border: none;
    color: #aaa;
    cursor: pointer;
    padding: 0;
    width: 1.5rem;
    height: 1.5rem;
    font-size: 1rem;
    margin-top: 0.6rem;
  }
  .delete-button:hover {
    color: #fff;
    background-color: #ff0000;
    border-radius: 50%;
  }
  button.conversation {
    background: none;
    border: none;
    width: 100%;
    text-align: left;
    padding: 4px;
    margin-top: 0;
  }
  button.conversation:hover {
    background-color: #999;
  }
  button.conversation:focus {
    outline: none;
  }
  button.conversation:active {
    border: none;
    outline: none;
  }
  button.conversation p {
    margin: 0.2rem 0;
    font-size: 0.9rem;
    color: #fff;
  }
  h2 {
    margin: .5rem 0;
  }
  h3 {
    padding: 0;
    margin-top: 0.5rem;
    margin-bottom: 0;
    font-size: 1rem;
  }
  h3 button {
    background: none;
    border: none;
    color: #fff;
    cursor: pointer;
    padding: .2rem;
    text-align: left;
  }
  small {
    font-size: .7rem;
    color: #ccc;
  }
  p {
    margin: 0;
    padding: 0;
    font-size: .8rem;
  }
</style>
