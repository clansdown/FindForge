<script lang="ts">
    export let pushed = false;
    export let title: string;
</script>

<button class="push-button" class:pressed={pushed} on:click={() => pushed = !pushed} aria-pressed={pushed} title={title}>
    <slot></slot>
</button>

<style>
    .push-button {
        position: relative;
        padding: .3rem 0.5em;
        background-color: #222;
        color: #eee;
        border: 1px solid #ccc;
        border-radius: 6px;
        cursor: pointer;
        font-family: inherit;
        font-size: inherit;
        box-shadow: 
            inset 3px 3px 3px rgba(252, 236, 40, 0.6),
            inset -3px -3px 3px rgba(128, 128, 20, 0.8);
        transition: all 0.1s ease;
    }

    .push-button.pressed {
        background-color: #000;
        border: 1px solid #ccc;
        box-shadow: 
            inset 3px 3px 3px rgba(128, 128, 20, 0.8),
            inset -3px -3px 3px rgba(252, 236, 40, 0.7);
        transform: translateY(1px);
    }

    .push-button:hover {
        background-color: #3a3a3a;
    }

    .push-button:focus {
        outline: none;
    }
    .push-button:active {
        outline: none;
    }
</style>
