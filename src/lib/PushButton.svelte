<script lang="ts">
    export let pushed = false;
    export let title: string;
    export let disabled : boolean = false;
</script>

<button class="push-button" class:pressed={pushed} on:click={() => pushed = !pushed} aria-pressed={pushed} title={title} {disabled}>
    <slot></slot>
</button>

<style>
    .push-button {
        position: relative;
        padding: .3rem 0.5em;
        background-color: #333;
        color: #eee;
        border: 1px solid #bbb;
        border-radius: 6px;
        cursor: pointer;
        font-family: inherit;
        font-size: inherit;
        box-shadow: 
            inset 3px 3px 3px rgba(211, 211, 207, 0.6),
            inset -3px -3px 3px rgba(138, 138, 40, 0.8);
        transition: all 0.1s ease;
    }

    .push-button.pressed {
        background-color: #000;
        border: 1px solid #ccc;
        box-shadow: 
            inset 3px 3px 3px rgba(118, 118, 20, 0.8),
            inset -2px -2px 2px rgba(232, 226, 80, 0.7);
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

    .push-button:disabled {
        background-color: #444;
        border-color: #999;
        cursor: not-allowed;
        box-shadow: none;
        filter: grayscale(100%);
        opacity: 0.8;
    }
</style>
