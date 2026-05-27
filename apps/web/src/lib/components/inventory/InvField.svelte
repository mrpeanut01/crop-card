<script lang="ts">
  import { Lock } from 'lucide-svelte';
  import type { Snippet } from 'svelte';
  import type { FieldChipKind } from '$lib/inventory/types';

  /**
   * Phase 27A primitive (#257). Labeled form field with the
   * REQUIRED / FROM PLUGIN / KERNEL-LOCKED chip taxonomy that
   * `A_InventoryEditForm` (Phase 27D) renders against. The chip is the
   * authoring-source signal — REQUIRED means the operator must fill it,
   * FROM PLUGIN means it pre-filled from the bound plugin (overridable),
   * KERNEL-LOCKED means the safety kernel owns the value and editing
   * routes through `/settings/plugins/[id]/propose-change`.
   *
   * The slot renders the input control — keeps this primitive layout-
   * only so type-specific inputs (numeric, enum, multi-pick) compose
   * without sub-component explosion.
   */
  interface Props {
    label: string;
    chip?: FieldChipKind;
    /** Optional hint text rendered below the input. Use for unit cues,
     *  format requirements, or the "Edit via Settings → Plugins" tooltip
     *  when chip === 'kernel-locked'. */
    hint?: string;
    error?: string;
    /** Form-id, propagated to `<label for>`. The slot must render an
     *  input with `id={id}`. */
    id: string;
    children: Snippet;
  }

  const { label, chip, hint, error, id, children }: Props = $props();
</script>

<div class="inv-field" class:has-error={!!error}>
  <label class="inv-field-label" for={id}>
    {label}
    {#if chip === 'required'}
      <span class="chip chip-required">REQUIRED</span>
    {:else if chip === 'from-plugin'}
      <span class="chip chip-plugin">FROM PLUGIN</span>
    {:else if chip === 'kernel-locked'}
      <span class="chip chip-locked">
        <Lock size={10} strokeWidth={2} aria-hidden="true" />
        KERNEL-LOCKED
      </span>
    {/if}
  </label>
  <div class="inv-field-control">{@render children()}</div>
  {#if error}
    <p class="inv-field-error" role="alert">{error}</p>
  {:else if hint}
    <p class="inv-field-hint">{hint}</p>
  {/if}
</div>

<style>
  .inv-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .inv-field-label {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--color-forest-deep, #1f3522);
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .chip {
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    padding: 2px 6px;
    border-radius: 99px;
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .chip-required {
    background: var(--color-rust-tint, #fce8e8);
    color: var(--color-rust, #a23a3a);
  }
  .chip-plugin {
    background: var(--color-honey-tint, #fff4d6);
    color: var(--color-honey-deep, #6a4f00);
  }
  .chip-locked {
    background: var(--color-forest-tint, #e8f1ea);
    color: var(--color-forest-deep, #1f3522);
  }
  .inv-field-hint {
    font-size: 0.75rem;
    color: var(--color-ink-muted, #6a6f63);
    margin: 0;
  }
  .inv-field-error {
    font-size: 0.8rem;
    color: var(--color-rust, #a23a3a);
    background: var(--color-rust-tint, #fce8e8);
    padding: 4px 8px;
    border-radius: 4px;
    margin: 0;
  }
  .inv-field.has-error .inv-field-control :global(input),
  .inv-field.has-error .inv-field-control :global(select),
  .inv-field.has-error .inv-field-control :global(textarea) {
    border-color: var(--color-rust, #a23a3a);
  }
</style>
