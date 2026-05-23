<script lang="ts">
  import { escapeHtml } from './util';

  export let thinking: string = '';
  export let lines: number = 10;
</script>

<div class="d-flex flex-column-reverse overflow-hidden text-secondary small border border-secondary rounded p-2 mb-2 bg-dark"
  style="height: {lines * 1.5}em;">
  <div class="mt-auto" style="white-space: pre-line; word-break: break-word;">
    {@html escapeHtml(thinking)}
  </div>
</div>
