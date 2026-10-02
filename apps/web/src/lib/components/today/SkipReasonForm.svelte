<script lang="ts">
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  interface Props {
    /** Unique per form on the page, so the label points at its own box. */
    id: string;
    onSave: (reason: string) => void;
    onCancel: () => void;
    busy?: boolean;
  }
  const { id, onSave, onCancel, busy = false }: Props = $props();

  let reason = $state('');
  let box = $state<HTMLTextAreaElement | null>(null);

  $effect(() => {
    box?.focus();
  });

  function save() {
    onSave(reason.trim());
    reason = '';
  }
  const tr = $derived(createT(page.data?.locale));
</script>

<div class="skip-form" role="region" aria-label={tr('today.skip.reasonAria')}>
  <label for={id}>{tr('today.skip.why')}</label>
  <textarea
    {id}
    bind:this={box}
    bind:value={reason}
    rows="2"
    placeholder={tr('today.skip.placeholder')}></textarea>
  <div class="skip-actions">
    <button type="button" class="ghost" onclick={onCancel}>{tr('today.skip.cancel')}</button>
    <button type="button" class="primary" onclick={save} disabled={busy}
      >{tr('today.skip.save')}</button
    >
  </div>
</div>

<style>
  .skip-form {
    margin: 14px 0 0;
    padding: 12px 14px;
    background: var(--color-cream);
    border: 1px solid var(--color-divider);
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 620px;
  }
  label {
    font-size: 12px;
    color: var(--color-ink-muted);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    font-weight: 600;
  }
  textarea {
    font-family: inherit;
    font-size: 13.5px;
    padding: 8px 10px;
    border: 1px solid var(--color-divider);
    border-radius: 4px;
    background: var(--color-paper);
    color: var(--color-ink);
    resize: vertical;
  }
  .skip-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    flex-wrap: wrap;
  }
  button {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    padding: 10px 16px;
    border-radius: var(--radius-input, 6px);
    font-size: 14px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
  }
  .primary {
    background: var(--color-forest);
    color: var(--color-cream);
    border: none;
  }
  .primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ghost {
    background: transparent;
    color: var(--color-forest-deep);
    border: 1px solid var(--color-divider);
  }
</style>
