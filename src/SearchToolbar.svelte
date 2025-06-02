<script lang="ts">
  export let position: { top: number, left: number };
  export let selectedText: string;
  export let onInternalSearch: (text: string) => void;
  export let searchEngine: string;

  function searchWikipedia() {
    const url = `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(selectedText)}`;
    window.open(url, '_blank');
  }

  function searchWeb() {
    let url;
    switch (searchEngine) {
      case 'duckduckgo':
        url = `https://duckduckgo.com/?q=${encodeURIComponent(selectedText)}`;
        break;
      case 'google':
        url = `https://www.google.com/search?q=${encodeURIComponent(selectedText)}`;
        break;
      default:
        url = `https://duckduckgo.com/?q=${encodeURIComponent(selectedText)}`;
    }
    window.open(url, '_blank');
  }
</script>

<div class="search-toolbar" style="top: {position.top}px; left: {position.left}px">
  <button on:click={() => onInternalSearch(selectedText)} title="Internal Search">🔍</button>
  <button on:click={searchWikipedia} title="Search Wikipedia">W</button>
  <button on:click={searchWeb} title="Web Search">🌐</button>
</div>

<style>
  .search-toolbar {
    position: absolute;
    display: flex;
    background: #333;
    border-radius: 4px;
    padding: 4px;
    z-index: 1000;
    box-shadow: 0 2px 5px rgba(0,0,0,0.2);
  }
  .search-toolbar button {
    background: none;
    border: none;
    color: white;
    cursor: pointer;
    margin: 0 2px;
    padding: 4px 8px;
  }
  .search-toolbar button:hover {
    background: #555;
  }
</style>
