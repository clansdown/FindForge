<script lang="ts">
  import { onDestroy, createEventDispatcher } from 'svelte';

  export let isOpen: boolean;
  export let onClose: (() => void) | undefined = undefined;
  export let scrollOverflow : boolean = true;
  
  const dispatch = createEventDispatcher();

  function handleBackgroundClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      dispatch('close');
      onClose?.();
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      dispatch('close');
      onClose?.();
      event.preventDefault();
    }
  }

  $: if (isOpen) {
    window.addEventListener('keydown', handleKeydown);
  } else {
    window.removeEventListener('keydown', handleKeydown);
  }

  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown);
  });
</script>

{#if isOpen}
<div class="modal-background" class:overflow={scrollOverflow}
     on:click|stopPropagation={handleBackgroundClick} 
     role="dialog" 
     aria-modal="true" 
     tabindex="0">
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="modal-content" on:click|stopPropagation>
    <slot></slot>
  </div>
</div>
{/if}

<style>
  .modal-background {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0,0,0,0.7);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
  }

  .overflow {
    overflow-y: auto;
  }
  
  .modal-content {
    background: #222;
    color: #fff;
    padding: 0 2rem 2rem 2rem;
    border: 2px solid #ddd;
    border-radius: 18px;
    box-shadow: 0 4px 10px rgba(1,1,1,0.3);
    width: 80%;
    max-width: 860px;
    max-height: 92vh;
  }

  @media (max-width: 600px) {
    .modal-content {
      width: 95%;
      padding: 2rem;
      overflow-y: auto;
    }
  }
</style>
