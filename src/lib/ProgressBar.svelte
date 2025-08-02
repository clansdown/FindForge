<script lang="ts">
    export let percentComplete: number;
    
    // Ensure the percentage is between 0 and 100
    $: clampedPercent = Math.min(100, Math.max(0, percentComplete));
    $: percentageText = `${Math.round(clampedPercent)}%`;
</script>

<div class="progress-container">
    <div class="progress-bar" style={`width: ${clampedPercent}%`}>
        <span class="progress-text">{percentageText}</span>
    </div>
</div>

<style>
    .progress-container {
        width: 100%;
        height: 24px;
        background-color: #e9ecef;
        border-radius: 4px;
        overflow: hidden;
        position: relative;
    }
    
    .progress-bar {
        height: 100%;
        background-color: #4CAF50;
        transition: width 0.3s ease;
    }
    
    .progress-text {
        position: absolute;
        left: 0;
        right: 0;
        top: 50%;
        transform: translateY(-50%);
        text-align: center;
        color: #495057;
        font-weight: bold;
        pointer-events: none;
    }
</style>
