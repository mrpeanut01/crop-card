<script lang="ts">
  import { fmt } from '$lib/prefsState.svelte';
  import { UNITS, type Quantity } from '$lib/prefs';
  import type { HTMLInputAttributes } from 'svelte/elements';

  interface Props extends Omit<HTMLInputAttributes, 'value' | 'type' | 'name' | 'min' | 'max'> {
    /** Stored value in US units. Bindable. */
    value?: number | null | undefined;
    quantity: Quantity;
    /** Form field name; the hidden input submits the US value under it. */
    name?: string;
    /** Bounds in US units, converted for the visible input. */
    min?: number;
    max?: number;
    /** Show the unit suffix after the input. */
    suffix?: boolean;
  }

  let {
    value = $bindable(),
    quantity,
    name,
    min,
    max,
    suffix = true,
    class: className = '',
    ...rest
  }: Props = $props();

  const digits = $derived(UNITS[quantity].digits.metric + 2);

  function shown(v: number | null | undefined): string {
    if (v === null || v === undefined || !Number.isFinite(v)) return '';
    return String(Number(fmt.toDisplay(v, quantity).toFixed(digits)));
  }

  let text = $state(shown(value));
  let lastEmitted: number | null | undefined = value;

  $effect(() => {
    if (value !== lastEmitted) {
      text = shown(value);
      lastEmitted = value;
    }
  });

  function onInput(e: Event) {
    text = (e.currentTarget as HTMLInputElement).value;
    const n = text.trim() === '' ? null : Number(text);
    const next = n === null || !Number.isFinite(n) ? null : fmt.fromDisplay(n, quantity);
    lastEmitted = next;
    value = next;
  }

  const bound = (v: number | undefined) =>
    v === undefined ? undefined : Number(fmt.toDisplay(v, quantity).toFixed(digits));
  const lo = $derived(bound(min));
  const hi = $derived(bound(max));
  const lower = $derived(lo !== undefined && hi !== undefined ? Math.min(lo, hi) : lo);
  const upper = $derived(lo !== undefined && hi !== undefined ? Math.max(lo, hi) : hi);
</script>

<span class="unit-input">
  <input
    {...rest}
    class={className}
    type="number"
    inputmode="decimal"
    step="any"
    min={lower}
    max={upper}
    value={text}
    oninput={onInput}
  />
  {#if suffix}<span class="suffix">{fmt.unit(quantity)}</span>{/if}
  {#if name}<input type="hidden" {name} value={value ?? ''} />{/if}
</span>

<style>
  .unit-input {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    width: 100%;
  }
  .unit-input > input[type='number'] {
    flex: 1;
    min-width: 0;
  }
  .suffix {
    font-size: 12px;
    color: var(--color-ink-muted);
    white-space: nowrap;
  }
</style>
