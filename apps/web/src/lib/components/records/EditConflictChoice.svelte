<script lang="ts">
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
  import { fmt } from '$lib/prefsState.svelte';
  import type { EditConflictBody, EditField } from '$lib/edits/conflict';
  import { mergeComplete, type ConflictChoice } from '$lib/edits/resolve';
  import { editFieldLabel, formatEditValue, type EditDisplayContext } from '$lib/edits/display';

  interface Props {
    conflict: EditConflictBody;
    /** What was edited, e.g. the planting's crop name. */
    label: string;
    /** Names for ids and keys in the values. */
    names?: Omit<EditDisplayContext, 'locale' | 'day'>;
    busy?: boolean;
    onResolve: (choice: ConflictChoice) => void | Promise<void>;
  }

  const { conflict, label, names = {}, busy = false, onResolve }: Props = $props();

  const uid = $props.id();
  const locale = $derived(page.data?.locale);
  const tr = $derived(createT(locale));
  const ctx = $derived<EditDisplayContext>({ ...names, locale, day: (ms) => fmt.day(ms) });

  let merging = $state(false);
  let merge = $state<Partial<Record<EditField, 'mine' | 'theirs'>>>({});
  const canSave = $derived(mergeComplete(conflict, merge));

  function pick(field: EditField, side: 'mine' | 'theirs') {
    merge = { ...merge, [field]: side };
  }
</script>

<section class="conflict" aria-labelledby="{uid}-h" data-testid="edit-conflict">
  <h3 id="{uid}-h">{tr('recui.conflict.heading', { label })}</h3>
  <p class="lede">
    {conflict.target === 'task'
      ? tr('recui.conflict.lede.task')
      : conflict.target === 'stock'
        ? tr('recui.conflict.lede.stock')
        : tr('recui.conflict.lede.planting')}
  </p>
  <ul class="fields">
    {#each conflict.fields as f (f.field)}
      <li class="field" data-field={f.field}>
        <p class="name">{editFieldLabel(f.field, locale)}</p>
        {#if merging}
          <fieldset class="pick">
            <legend class="sr-only">{editFieldLabel(f.field, locale)}</legend>
            <label class="side" class:chosen={merge[f.field] === 'mine'}>
              <input
                type="radio"
                name="{uid}-{f.field}"
                checked={merge[f.field] === 'mine'}
                onchange={() => pick(f.field, 'mine')}
                disabled={busy}
              />
              <span class="col">{tr('recui.conflict.yours')}</span>
              <span class="val">{formatEditValue(f.field, f.mine, ctx)}</span>
            </label>
            <label class="side" class:chosen={merge[f.field] === 'theirs'}>
              <input
                type="radio"
                name="{uid}-{f.field}"
                checked={merge[f.field] === 'theirs'}
                onchange={() => pick(f.field, 'theirs')}
                disabled={busy}
              />
              <span class="col">{tr('recui.conflict.theirs')}</span>
              <span class="val">{formatEditValue(f.field, f.theirs, ctx)}</span>
            </label>
          </fieldset>
        {:else}
          <dl class="pair">
            <div class="side">
              <dt class="col">{tr('recui.conflict.yours')}</dt>
              <dd class="val">{formatEditValue(f.field, f.mine, ctx)}</dd>
            </div>
            <div class="side">
              <dt class="col">{tr('recui.conflict.theirs')}</dt>
              <dd class="val">{formatEditValue(f.field, f.theirs, ctx)}</dd>
            </div>
          </dl>
        {/if}
      </li>
    {/each}
  </ul>
  {#if merging}
    <p class="hint">{tr('recui.conflict.pickHint')}</p>
    <div class="actions">
      <button
        type="button"
        class="primary"
        disabled={busy || !canSave}
        onclick={() => onResolve({ merge: { ...merge } })}>{tr('recui.conflict.save')}</button
      >
      <button
        type="button"
        class="secondary"
        disabled={busy}
        onclick={() => {
          merging = false;
          merge = {};
        }}>{tr('recui.conflict.back')}</button
      >
    </div>
  {:else}
    <div class="actions">
      <button type="button" class="primary" disabled={busy} onclick={() => onResolve('mine')}
        >{tr('recui.conflict.keepMine')}</button
      >
      <button type="button" class="secondary" disabled={busy} onclick={() => onResolve('theirs')}
        >{tr('recui.conflict.keepTheirs')}</button
      >
      <button
        type="button"
        class="secondary"
        disabled={busy}
        onclick={() => {
          merging = true;
          merge = {};
        }}>{tr('recui.conflict.chooseEach')}</button
      >
    </div>
  {/if}
</section>

<style>
  .conflict {
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
    overflow-wrap: anywhere;
  }
  .lede,
  .hint {
    margin: 0 0 0.5rem;
    color: #444;
  }
  .fields {
    list-style: none;
    padding: 0;
    margin: 0 0 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .field {
    background: white;
    border: 1px solid #ddd;
    border-radius: 6px;
    padding: 0.5rem;
  }
  .name {
    margin: 0 0 0.35rem;
    font-weight: 700;
  }
  .pair,
  .pick {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 0.5rem;
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.4rem 0.5rem;
    border-radius: 6px;
    background: #f6f6f2;
    min-width: 0;
  }
  label.side {
    min-height: 48px;
    cursor: pointer;
    border: 2px solid transparent;
    position: relative;
    padding-left: 2.25rem;
    justify-content: center;
  }
  label.side input {
    position: absolute;
    left: 0.6rem;
    top: 50%;
    transform: translateY(-50%);
    width: 1.25rem;
    height: 1.25rem;
    margin: 0;
  }
  label.side.chosen {
    border-color: #1f5e3a;
    background: #e6f2ea;
  }
  .col {
    font-size: 0.8rem;
    color: #555;
    font-weight: 600;
  }
  .val {
    margin: 0;
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
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
