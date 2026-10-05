<script lang="ts">
  /** The short form of the edit-conflict choice, for writes where a
   *  per-field picker doesn't fit: a drag, a status button, a count. Shows
   *  what is on the farm now and offers Keep my change or Reload. */
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
  import { fmt } from '$lib/prefsState.svelte';
  import type { EditConflictBody } from '$lib/edits/conflict';
  import { editFieldLabel, formatEditValue, type EditDisplayContext } from '$lib/edits/display';

  interface Props {
    conflict: EditConflictBody;
    names?: Omit<EditDisplayContext, 'locale' | 'day'>;
    busy?: boolean;
    onKeepMine: () => void | Promise<void>;
    onReload: () => void | Promise<void>;
  }

  const { conflict, names = {}, busy = false, onKeepMine, onReload }: Props = $props();

  const uid = $props.id();
  const locale = $derived(page.data?.locale);
  const tr = $derived(createT(locale));
  const ctx = $derived<EditDisplayContext>({ ...names, locale, day: (ms) => fmt.day(ms) });
</script>

<section
  class="stale"
  role="alert"
  aria-labelledby="{uid}-h"
  data-testid="stale-edit"
  data-target={conflict.target}
>
  <h3 id="{uid}-h">{tr('recui.stale.heading')}</h3>
  <p class="lede">{conflict.error}</p>
  <ul class="now">
    {#each conflict.fields as f (f.field)}
      <li>
        <strong>{editFieldLabel(f.field, locale)}</strong>
        {tr('recui.stale.now', { value: formatEditValue(f.field, f.theirs, ctx) })}
      </li>
    {/each}
  </ul>
  <div class="actions">
    <button type="button" class="primary" disabled={busy} onclick={() => onKeepMine()}
      >{tr('recui.stale.keepMine')}</button
    >
    <button type="button" class="secondary" disabled={busy} onclick={() => onReload()}
      >{tr('recui.stale.reload')}</button
    >
  </div>
</section>

<style>
  .stale {
    border: 1px solid #e6c97a;
    background: #fffaf0;
    border-radius: 8px;
    padding: 0.75rem;
    margin: 0.5rem 0;
    max-width: 100%;
    box-sizing: border-box;
  }
  h3 {
    margin: 0 0 0.25rem;
    font-size: 1.05rem;
  }
  .lede {
    margin: 0 0 0.5rem;
    color: #444;
  }
  .now {
    margin: 0 0 0.5rem;
    padding-left: 1.1rem;
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .actions button {
    min-height: 48px;
    flex: 1 1 140px;
    border-radius: 6px;
    padding: 0.6rem 1rem;
    font-weight: 600;
    cursor: pointer;
  }
  .primary {
    background: #1f5e3a;
    color: white;
    border: none;
  }
  .primary:disabled {
    background: #999;
    cursor: not-allowed;
  }
  .secondary {
    background: white;
    color: #1f5e3a;
    border: 1px solid #1f5e3a;
  }
</style>
