<script lang="ts">
    import ModalDialog from './lib/ModalDialog.svelte';
    export let isOpen: boolean = false;
    export let onClose: () => void;
</script>

{#if isOpen}
    <ModalDialog {isOpen} onClose={onClose}>
        <div class="about-content">
            <h1>MachineLearner</h1>
            <p>Version 0.1.0</p>
            <p>MachineLearner is an AI research assistant written by Christopher Lansdown to use the power of Large Language Models to help you research topics.
                </p>
            <p>Source code: <a href="https://github.com/clansdown/MachineLearner" target="_blank">GitHub</a></p>
        </div>
        <div class="text-end">
            <button on:click={onClose}>Close</button>
        </div>
    </ModalDialog>
{/if}

<style>
    .about-content {
        padding: 1rem;
    }
    h1 {
        margin-top: 0;
    }
    p {
        margin: 0.5rem 0;
    }
    a {
        color: #4a9ae9;
    }
</style>
