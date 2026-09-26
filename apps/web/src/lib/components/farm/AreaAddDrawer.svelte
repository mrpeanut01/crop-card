<script lang="ts">
  import Modal from '$lib/components/ui/Modal.svelte';
  import { ADD_GROUPS, type AddPick } from '$lib/farm/kindStyle';

  const {
    open,
    onClose,
    onPick,
    mode = 'map',
    canAddBlock = true
  }: {
    open: boolean;
    onClose: () => void;
    onPick: (pick: AddPick) => void;
    mode?: 'map' | 'sketch';
    canAddBlock?: boolean;
  } = $props();

  const groups = $derived(
    mode === 'map' ? ADD_GROUPS : ADD_GROUPS.filter((g) => g.id !== 'shade' && g.id !== 'features')
  );
</script>

<Modal {open} {onClose} title="Add to map">
  <p class="lede">
    {mode === 'map'
      ? 'Pick what you are adding, then outline or mark it on the map.'
      : 'Pick what you are adding, then type its width and length.'}
  </p>
  {#if mode === 'sketch'}
    <p class="lede note">Fences, gates, water and other lines and points go on the Map view.</p>
  {/if}
  {#each groups as g (g.id)}
    <section class="group" aria-labelledby="add-group-{g.id}">
      <h3 id="add-group-{g.id}">{g.title}</h3>
      <ul>
        {#each g.items as item (item.kind)}
          <li>
            <button
              type="button"
              class="pick"
              data-kind={item.kind}
              onclick={() => onPick({ type: item.type, kind: item.kind } as AddPick)}
            >
              <span
                class="swatch"
                class:line={item.type === 'shade' ||
                  (item.type === 'feature' && item.shape === 'line')}
                class:point={item.type === 'feature' && item.shape === 'point'}
                style:--swatch={item.color}
                aria-hidden="true"
              ></span>
              <span class="text">
                <span class="label">{item.label}</span>
                {#if item.type === 'area' || item.type === 'feature'}<span class="hint"
                    >{item.hint}</span
                  >{/if}
              </span>
            </button>
          </li>
        {/each}
        {#if g.id === 'crop' && mode === 'map' && canAddBlock}
          <li>
            <button
              type="button"
              class="pick"
              data-kind="block"
              onclick={() => onPick({ type: 'block' })}
            >
              <span class="swatch block" aria-hidden="true"></span>
              <span class="text">
                <span class="label">Block or bed</span>
                <span class="hint">A patch inside one of your crop areas</span>
              </span>
            </button>
          </li>
        {/if}
      </ul>
    </section>
  {/each}
</Modal>

<style>
  .lede {
    margin: 0 0 12px;
    color: var(--color-ink-soft);
    font-size: 14px;
  }
  .note {
    margin-top: -6px;
    font-size: 13px;
  }
  .group + .group {
    margin-top: 14px;
  }
  h3 {
    margin: 0 0 6px;
    font-size: var(--font-size-kicker, 11px);
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-ink-muted);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 8px;
  }
  .pick {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 56px;
    padding: 8px 12px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 8px);
    background: var(--color-paper);
    color: var(--color-ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .pick:hover {
    border-color: var(--color-forest);
  }
  .pick:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .swatch {
    flex: 0 0 22px;
    height: 22px;
    border-radius: 5px;
    background: color-mix(in srgb, var(--swatch) 35%, transparent);
    border: 2px solid var(--swatch);
  }
  .swatch.line {
    height: 6px;
    border-radius: 3px;
    background: var(--swatch);
  }
  .swatch.point {
    flex-basis: 16px;
    height: 16px;
    margin: 0 3px;
    border-radius: 50%;
    background: var(--swatch);
    border-color: var(--color-paper);
    box-shadow: 0 0 0 2px var(--swatch);
  }
  .swatch.block {
    background: var(--color-wheat-soft);
    border: 2px dashed var(--color-ink-soft);
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .label {
    font-weight: 600;
    font-size: 15px;
  }
  .hint {
    font-size: 12.5px;
    color: var(--color-ink-muted);
  }
</style>
