<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { generateID } from './lib/util';
  import { saveProject } from './lib/storage';
  import type { ProjectData, ProjectType } from './lib/types';
  import ModalDialog from './lib/ModalDialog.svelte';

  const dispatch = createEventDispatcher();

  export let isOpen = false;

  let name = '';
  let type: ProjectType = 'research';
  let saving = false;
  let error = '';

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) {
      error = 'Please enter a project name.';
      return;
    }
    saving = true;
    error = '';
    try {
      const project: ProjectData = {
        id: generateID(),
        name: trimmed,
        type,
        created: Date.now(),
        updated: Date.now(),
      };
      await saveProject(project);
      dispatch('create', project);
    } catch (err) {
      console.error('Failed to create project:', err);
      error = 'Failed to create project. Check console for details.';
    }
    saving = false;
  }

  function close() {
    if (!saving) {
      name = '';
      type = 'research';
      error = '';
      dispatch('close');
    }
  }
</script>

<ModalDialog {isOpen} on:close={close}>
  <h2>New Project</h2>
  {#if error}
    <div class="error">{error}</div>
  {/if}
  <div class="form-group">
    <label for="project-name">Name:</label>
    <input type="text" id="project-name" bind:value={name} placeholder="My Project" disabled={saving} />
  </div>
  <div class="form-group">
    <label for="project-type">Type:</label>
    <select id="project-type" bind:value={type} disabled={saving}>
      <option value="research">Research</option>
      <option value="brainstorming">Brainstorming</option>
    </select>
  </div>
  <div class="button-group">
    <button on:click={close} disabled={saving}>Cancel</button>
    <button on:click={create} disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
  </div>
</ModalDialog>

<style>
  .form-group {
    margin-bottom: 1rem;
  }
  .form-group label {
    display: block;
    margin-bottom: 0.5rem;
    font-weight: bold;
  }
  .form-group input,
  .form-group select {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid #ddd;
    border-radius: 4px;
    box-sizing: border-box;
  }
  .button-group {
    display: flex;
    justify-content: flex-end;
    gap: 1rem;
    margin-top: 1rem;
  }
  .error {
    color: #ff6b6b;
    margin-bottom: 1rem;
  }
</style>
