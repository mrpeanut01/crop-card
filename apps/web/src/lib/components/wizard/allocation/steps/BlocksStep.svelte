<script lang="ts">
  import { getWizardContext } from '../wizardState.svelte';

  const w = getWizardContext();
  const blocks = $derived(w.props.blocks);
</script>

<div class="aw-blocks-header">
  <p class="aw-intro">Pick the blocks the wizard may use.</p>
  <div class="aw-blocks-actions">
    <span class="muted">{w.selectedBlockIds.size} of {blocks.length} selected</span>
    <button type="button" class="aw-link" onclick={() => w.selectAllBlocks()}>Select all</button>
    {#if w.selectedBlockIds.size > 0}
      <button type="button" class="aw-link" onclick={() => (w.selectedBlockIds = new Set())}>
        Clear
      </button>
    {/if}
  </div>
</div>
<ul class="aw-blocklist">
  {#each blocks as b (b.id)}
    {@const checked = w.selectedBlockIds.has(b.id)}
    {@const acresText = b.acres !== undefined ? `${b.acres.toFixed(2)} ac` : null}
    {@const sunText = b.sunExposure ? `${b.sunExposure} sun` : null}
    {@const plantingsText =
      b.plantings.length > 0
        ? `${b.plantings.length} active planting${b.plantings.length === 1 ? '' : 's'}`
        : null}
    <li class:checked>
      <label>
        <input type="checkbox" {checked} onchange={() => w.toggleBlock(b.id)} />
        <span class="aw-block-info">
          <span class="aw-block-name">{b.blockLabel ?? b.name}</span>
          <span class="aw-chips">
            {#if acresText}<span class="aw-chip">{acresText}</span>{/if}
            {#if sunText}<span class="aw-chip">☀ {sunText}</span>{/if}
            {#if plantingsText}<span class="aw-chip aw-chip-warn">🌱 {plantingsText}</span>{/if}
          </span>
        </span>
      </label>
    </li>
  {/each}
</ul>

<style>
  .aw-intro {
    margin: 0 0 0.75rem;
    color: #4a5d4a;
  }
  .muted {
    color: #6a7d6a;
    font-size: 0.9rem;
  }
  .aw-blocks-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.5rem;
  }
  .aw-blocks-header .aw-intro {
    margin: 0;
  }
  .aw-blocks-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.9rem;
  }
  .aw-blocklist {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 0.5rem;
  }
  .aw-blocklist li {
    border: 1px solid #cbd5cb;
    border-radius: 8px;
    background: white;
    transition:
      border-color 0.1s,
      background 0.1s;
  }
  .aw-blocklist li:hover {
    border-color: var(--color-forest);
  }
  .aw-blocklist li.checked {
    border-color: var(--color-forest);
    background: #f3f9f4;
  }
  .aw-blocklist label {
    display: flex;
    align-items: flex-start;
    gap: 0.65rem;
    padding: 0.65rem 0.8rem;
    cursor: pointer;
    width: 100%;
  }
  .aw-blocklist input[type='checkbox'] {
    margin-top: 0.15rem;
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    accent-color: var(--color-forest);
  }
  .aw-block-info {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-width: 0;
    flex: 1;
  }
  .aw-block-name {
    font-weight: 700;
    color: #1f3a26;
    font-size: 0.95rem;
    line-height: 1.2;
  }
  .aw-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .aw-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.1rem 0.5rem;
    background: #eef4ef;
    color: #4a5d4a;
    border-radius: 999px;
    font-size: 0.78rem;
    line-height: 1.4;
    white-space: nowrap;
    text-transform: capitalize;
  }
  .aw-chip-warn {
    background: #fff1cc;
    color: #6a4f00;
  }
  .aw-link {
    background: none;
    border: none;
    color: var(--color-forest);
    text-decoration: underline;
    cursor: pointer;
    font-size: inherit;
    padding: 0;
  }
</style>
