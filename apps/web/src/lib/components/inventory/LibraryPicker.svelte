<script lang="ts">
  /**
   * #472: type-ahead picker over library entries (crop categories for seed,
   * product labels for pesticide and fertility). An ARIA combobox: typing
   * filters the list, arrow keys move, Enter picks, Escape closes. The
   * current pick shows with its provenance tag so an auto-match reads as
   * `data` and the operator's own pick as `manual`.
   */
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { searchLibrary, type LibraryOption } from '$lib/plugins/libraryMatch';

  type Source = 'plugin' | 'data' | 'ai' | 'manual' | 'fallback';

  interface Props {
    id: string;
    options: ReadonlyArray<LibraryOption>;
    value?: string;
    source?: Source;
    /** Ranked auto-matches shown first when the box is empty. */
    suggestions?: ReadonlyArray<LibraryOption>;
    placeholder?: string;
    /** Singular noun for copy, e.g. "category" or "product". */
    noun?: string;
    clearable?: boolean;
    onChange?: (id: string, source: Source) => void;
  }

  let {
    id,
    options,
    value = $bindable(''),
    source = $bindable('manual'),
    suggestions = [],
    placeholder = 'Start typing to search',
    noun = 'category',
    clearable = true,
    onChange
  }: Props = $props();

  const listId = $derived(`${id}-listbox`);
  const selected = $derived(
    value ? (options.find((o) => o.id === value) ?? { id: value, name: value }) : undefined
  );

  let query = $state('');
  let open = $state(false);
  let active = $state(0);

  const results = $derived.by(() => {
    if (query.trim()) return searchLibrary(query, options, 8);
    const seen = new Set<string>();
    const out: LibraryOption[] = [];
    for (const s of suggestions) {
      if (!seen.has(s.id)) {
        seen.add(s.id);
        out.push(s);
      }
    }
    for (const o of searchLibrary('', options, 8)) {
      if (out.length >= 8) break;
      if (!seen.has(o.id)) {
        seen.add(o.id);
        out.push(o);
      }
    }
    return out;
  });

  function pick(opt: LibraryOption): void {
    value = opt.id;
    source = 'manual';
    query = '';
    open = false;
    onChange?.(opt.id, 'manual');
  }

  function clear(): void {
    value = '';
    source = 'manual';
    query = '';
    onChange?.('', 'manual');
  }

  function onInput(e: Event): void {
    query = (e.currentTarget as HTMLInputElement).value;
    open = true;
    active = 0;
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) open = true;
      else active = Math.min(active + 1, results.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(active - 1, 0);
    } else if (e.key === 'Enter') {
      if (open && results[active]) {
        e.preventDefault();
        pick(results[active]);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        open = false;
      }
    }
  }
</script>

<div class="picker">
  {#if selected}
    <div class="current" data-testid="{id}-current">
      <span class="current-name">{selected.name}</span>
      <Provenance
        {source}
        label={source === 'data'
          ? 'Matched'
          : source === 'manual'
            ? 'You picked'
            : source === 'plugin'
              ? 'Saved'
              : undefined}
        long={source === 'data'
          ? 'Matched from the name. Search to change it.'
          : source === 'plugin'
            ? 'The library entry saved with this item. Search to change it.'
            : undefined}
      />
      {#if clearable}
        <button type="button" class="clear" onclick={clear} aria-label="Clear the {noun}">
          Clear
        </button>
      {/if}
    </div>
  {/if}
  <input
    {id}
    type="text"
    role="combobox"
    autocomplete="off"
    aria-autocomplete="list"
    aria-expanded={open && results.length > 0}
    aria-controls={listId}
    aria-activedescendant={open && results[active] ? `${id}-opt-${active}` : undefined}
    value={query}
    placeholder={selected ? `Change the ${noun}` : placeholder}
    oninput={onInput}
    onkeydown={onKeydown}
    onfocus={() => (open = true)}
    onblur={() => setTimeout(() => (open = false), 150)}
  />
  {#if open && results.length > 0}
    <ul class="options" role="listbox" id={listId} aria-label="Matching {noun}s">
      {#each results as opt, i (opt.id)}
        <li
          id="{id}-opt-{i}"
          role="option"
          tabindex="-1"
          aria-selected={opt.id === value}
          class:active={i === active}
          onmousedown={(e) => {
            e.preventDefault();
            pick(opt);
          }}
        >
          {opt.name}
        </li>
      {/each}
    </ul>
  {:else if open && query.trim()}
    <p class="none" role="status">No {noun} matches "{query.trim()}".</p>
  {/if}
</div>

<style>
  .picker {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .current {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px 10px;
    border: 1px solid var(--color-divider, #e5e7e0);
    border-radius: 6px;
    background: var(--color-cream, #fff8e1);
  }
  .current-name {
    font-weight: 600;
    color: var(--color-forest-deep, #1f3522);
    overflow-wrap: anywhere;
    min-width: 0;
  }
  .clear {
    margin-left: auto;
    min-height: 48px;
    min-width: 48px;
    padding: 0 12px;
    border: 1px solid var(--color-divider, #e5e7e0);
    border-radius: 6px;
    background: var(--color-paper, #fff);
    font: inherit;
    cursor: pointer;
  }
  input {
    width: 100%;
    min-height: 48px;
    padding: 10px 12px;
    border: 1px solid var(--color-divider, #e5e7e0);
    border-radius: 6px;
    font: inherit;
    background: var(--color-paper, #fff);
    box-sizing: border-box;
  }
  input:focus {
    outline: 2px solid var(--color-forest, #1f5e3a);
    outline-offset: 1px;
  }
  .options {
    list-style: none;
    margin: 0;
    padding: 4px 0;
    border: 1px solid var(--color-divider, #e5e7e0);
    border-radius: 6px;
    background: var(--color-paper, #fff);
    max-height: 288px;
    overflow-y: auto;
  }
  .options li {
    min-height: 48px;
    display: flex;
    align-items: center;
    padding: 4px 12px;
    cursor: pointer;
    overflow-wrap: anywhere;
  }
  .options li.active,
  .options li:hover {
    background: var(--color-cream, #fff8e1);
  }
  .options li[aria-selected='true'] {
    font-weight: 600;
  }
  .none {
    margin: 0;
    font-size: 0.85rem;
    color: var(--color-ink-muted, #6a6f63);
  }
</style>
