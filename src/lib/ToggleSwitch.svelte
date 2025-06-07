<script lang="ts">
    import { generateID } from './util';

    export let checked: boolean;
    export let disabled=false;
    export let title : string|undefined = undefined;

    let id: string = generateID();
</script>

<div class="switch" {title}>
    <slot name="front" />
    <div class="switch-button">
    <input
        type="checkbox"
        class="form-check-input"
        {id}
        bind:checked
        role="switch"
        {disabled}
    />
    </div>
    <label class="form-check-label" for={id}>
        <slot />
    </label>
</div>

<style>
    .switch {
        display: inline-flex;
        flex-wrap: nowrap;
        align-items: center;
        position: relative;
        user-select: none;
    }
    .switch-button {
        position: relative;
        display: inline-block;
        width: 2em; /* Width of the toggle switch */
        height: 1.5em; /* Height of the toggle switch */
        margin-right: 0.5em; /* Space between switch and label */
        margin-left: 0.25em;
    }
    .form-check-input {
        height: 1.05em;
        margin-top: 0.25em;
        vertical-align: top;
        appearance: none; /* Removes default checkbox appearance */
        background-color: var(--bs-form-check-bg); /* Usually #fff */
        background-repeat: no-repeat;
        background-position: center;
        background-size: contain;
        border: 1px solid #ccc; /* 1px solid #dee2e6 */
        cursor: pointer;
        width: 2.1em; /* Wider to create toggle shape */
        
        background-image: none; /* Removes default checkbox image */
        background-color: #333; /* Gray background for track */
        border-radius: 2em; /* Rounded track */
        transition: background-color 0.15s ease-in-out, border-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out;
    }

    .form-check-input:checked {
        
    }
    .form-check-input:checked::before {
        transform: translateX(1em); /* Moves the toggle knob to the right */
    }
    .form-check-input::before {
        content: "";
        position: absolute;
        width: 0.875em; /* Knob size */
        height: 0.875em;
        background-color: #fff; /* White knob */
        border-radius: 50%; /* Circular knob */
        top: 0.32em;
        left: 0.32em;
        transition: transform 0.15s ease-in-out; /* Smooth sliding effect */
    }
    .form-check-input:focus {
        box-shadow: 0 0 0 0.25rem rgba(var(--bs-primary-rgb), 0.25); /* Blue focus ring */
        background-image: none;
    }
    .form-check-input:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
    .form-check-label {
        margin-bottom: 0; /* Removes default margin */
        color: #fff; /* White text for label */
    }

</style>
