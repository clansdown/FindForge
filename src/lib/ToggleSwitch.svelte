<script lang="ts">
    import { generateID } from './util';
    export let checked: boolean = false;
    export let id: string = generateID();
    export let disabled=false;
    export let title : string;
</script>

<div class="form-check form-switch d-flex align-items-center" {title}>
    <slot name="front" />
    <input
        type="checkbox"
        class="form-check-input"
        {id}
        bind:checked
        role="switch"
        {disabled}
    />
    <label class="form-check-label" for={id}>
        <slot />
    </label>
</div>

<style>
    .form-check-input {
        width: 2em; /* Wider to create toggle shape */
        margin-left: -2.5em; /* Aligns with label */
        background-image: none; /* Removes default checkbox image */
        background-color: var(--bs-border-color); /* Gray background for track */
        border-radius: 2em; /* Rounded track */
        transition: background-color 0.15s ease-in-out, border-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out;
    }

    .form-check-input:checked {
        background-color: var(--bs-primary); /* Usually #0d6efd (blue) */
        border-color: var(--bs-primary);
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
        top: 0.125em;
        left: 0.125em;
        transition: transform 0.15s ease-in-out; /* Smooth sliding effect */
    }
    .form-check-input:focus {
        box-shadow: 0 0 0 0.25rem rgba(var(--bs-primary-rgb), 0.25); /* Blue focus ring */
        background-image: none;
    }
    .form-switch .form-check-input:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

</style>
