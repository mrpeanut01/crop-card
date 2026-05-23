<script lang="ts">
  /**
   * Multi-select picker for cross-referencing existing plugins.
   *
   * Operators search by display name; the component returns an array of
   * pluginIds. Used by the authoring form anywhere a field needs a list
   * of cross-references (companion good-with / bad-with, herbicide
   * label-safe crops, etc.).
   *
   * Search input is on top. Selected items render as removable chips
   * below it. The filtered dropdown appears on focus and disappears on
   * blur (with a short delay so click-to-select can register). Chips
   * animate in on add so the operator sees the selection register.
   */
  import { fly } from 'svelte/transition';
  type PluginRef = { pluginId: string; displayName: string; type: string };

  let {
    available,
    selected,
    kind,
    placeholder = 'Search by name…',
    onChange
  }: {
    available: ReadonlyArray<PluginRef>;
    selected: string[];
    kind: string;
    placeholder?: string;
    onChange: (ids: string[]) => void;
  } = $props();

  let query = $state('');
  let showList = $state(false);

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return available
      .filter((p) => p.type === kind)
      .filter((p) => !selected.includes(p.pluginId))
      .filter((p) => {
        if (!q) return true;
        const hay = (p.displayName + ' ' + p.pluginId).toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .slice(0, 12);
  });

  const selectedDetails = $derived(
    selected.map(
      (id) =>
        available.find((p) => p.pluginId === id) ?? {
          pluginId: id,
          displayName: id,
          type: kind
        }
    )
  );

  function add(id: string) {
    if (selected.includes(id)) return;
    onChange([...selected, id]);
    query = '';
  }

  function remove(id: string) {
    onChange(selected.filter((x) => x !== id));
  }

  let blurTimer: ReturnType<typeof setTimeout> | undefined;
  function handleBlur() {
    blurTimer = setTimeout(() => {
      showList = false;
    }, 180);
  }
  function handleFocus() {
    clearTimeout(blurTimer);
    showList = true;
  }
</script>

<div class="picker">
  <div class="search-row">
    <input
      type="text"
      bind:value={query}
      {placeholder}
      onfocus={handleFocus}
      onblur={handleBlur}
      autocomplete="off"
    />
    {#if showList}
      <ul class="options">
        {#if filtered.length === 0}
          <li class="empty">
            {#if query}No {kind}s match "{query}"{:else}No {kind}s available{/if}
          </li>
        {:else}
          {#each filtered as p (p.pluginId)}
            <li>
              <button
                type="button"
                class="option"
                onmousedown={(e) => {
                  e.preventDefault();
                  add(p.pluginId);
                }}
              >
                {p.displayName}
              </button>
            </li>
          {/each}
        {/if}
      </ul>
    {/if}
  </div>

  {#if selectedDetails.length > 0}
    <div class="chips">
      {#each selectedDetails as p (p.pluginId)}
        <span class="chip" transition:fly={{ y: -4, duration: 160 }}>
          {p.displayName}
          <button
            type="button"
            class="remove"
            aria-label={`Remove ${p.displayName}`}
            onclick={() => remove(p.pluginId)}
          >×</button>
        </span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    min-width: 0;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.05rem;
    background: #e7f1ea;
    color: #1f5e3a;
    padding: 0 0.15rem 0 0.45rem;
    border-radius: 9px;
    font-size: 0.78rem;
    line-height: 1.2;
    border: 1px solid #b3d4bf;
    white-space: nowrap;
    flex: 0 0 auto;
  }
  .chip .remove {
    background: none;
    border: 0;
    color: #1f5e3a;
    cursor: pointer;
    font-size: 0.85rem;
    line-height: 1;
    padding: 0;
    margin: 0;
    width: 13px;
    height: 13px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
  }
  .chip .remove:hover {
    background: rgba(31, 94, 58, 0.2);
  }
  .search-row {
    position: relative;
    max-width: 320px;
  }
  .search-row input {
    width: 100%;
    box-sizing: border-box;
    padding: 0.45rem 0.6rem;
    border: 2px solid #d0d7d0;
    border-radius: 4px;
    font: inherit;
    font-size: 0.9rem;
    min-height: 38px;
  }
  .options {
    position: absolute;
    top: calc(100% + 2px);
    left: 0;
    right: 0;
    background: white;
    border: 1px solid #d0d7d0;
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    list-style: none;
    padding: 0;
    margin: 0;
    z-index: 20;
    max-height: 280px;
    overflow-y: auto;
  }
  .options li {
    border-bottom: 1px solid #f0f0f0;
  }
  .options li:last-child {
    border-bottom: 0;
  }
  .options li.empty {
    padding: 0.5rem 0.7rem;
    color: #777;
    font-style: italic;
    font-size: 0.85rem;
  }
  button.option {
    appearance: none;
    width: 100%;
    text-align: left;
    background: white;
    border: 0;
    padding: 0.2rem 0.6rem;
    font: inherit;
    font-size: 0.85rem;
    line-height: 1.4;
    color: #222;
    cursor: pointer;
    min-height: 0;
  }
  button.option:hover,
  button.option:focus-visible {
    background: #f3f9f5;
    color: #1f5e3a;
    outline: 0;
  }
</style>
