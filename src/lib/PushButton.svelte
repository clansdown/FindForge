<script lang="ts">
    export let pushed = false;
</script>

<button class="push-button" class:pressed={pushed} on:click={() => pushed = !pushed} aria-pressed={pushed}>
    <slot></slot>
</button>

<style>
    .push-button {
        position: relative;
        padding: 0.5em 1em;
        background-color: #e0e0e0;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-family: inherit;
        font-size: inherit;
        box-shadow: 
            inset -2px -2px 4px rgba(0,0,0,0.1),
            inset 2px 2px 4px rgba(255,255,255,0.7);
        transition: all 0.1s ease;
    }

    .push-button.pressed {
        box-shadow: 
            inset 2px 2px 4px rgba(0,0,0,0.1),
            inset -2px -2px 4px rgba(255,255,255,0.7);
    }

    .push-button:focus {
        outline: none;
    }
</style>
