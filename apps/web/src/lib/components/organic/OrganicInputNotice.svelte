<script lang="ts">
  import type { OrganicInputClass } from '$lib/organic/inputCompliance';
  import { organicInputNotice } from './organicInputNotice';

  /**
   * 33B (B-20, B-21). A non-blocking note before a save: a selected block
   * is under an owner-entered organic or transitioning status and a
   * selected product is not marked allowed for organic use in the library.
   * Renders nothing otherwise, and nothing when the page sends no
   * `organicBlocks` (organic chrome is not `full`).
   */
  interface Props {
    organicBlocks: Record<string, string> | null | undefined;
    selectedBlockIds: string[];
    products: { name: string; inputClass: OrganicInputClass }[];
    blockNames?: Record<string, string>;
  }

  const { organicBlocks, selectedBlockIds, products, blockNames }: Props = $props();

  const notice = $derived(
    organicInputNotice({ organicBlocks, selectedBlockIds, products, blockNames })
  );
</script>

{#if notice}
  <aside class="organic-notice" role="note" data-testid="organic-input-notice">
    <p class="kicker">Organic record</p>
    <ul class="products">
      {#each notice.products as p (p.inputClass + p.name)}
        <li data-class={p.inputClass}>
          <strong>{p.name}</strong>. {p.message}
        </li>
      {/each}
    </ul>
    <ul class="blocks">
      {#each notice.blocks as b (b.id)}
        <li><span class="block-name">{b.name}</span>: {b.statusLine}</li>
      {/each}
    </ul>
    <p class="foot">
      You can still save. The library mark is how the plugin library marks this product today.
    </p>
  </aside>
{/if}

<style>
  .organic-notice {
    margin: 12px 0;
    padding: 12px 14px;
    border: 1px solid var(--color-wheat, #d9b45a);
    border-left-width: 4px;
    border-radius: 6px;
    background: var(--color-wheat-soft, #fbf3dc);
    color: var(--color-ink, #1f2a1f);
    font-size: 0.92rem;
    overflow-wrap: anywhere;
  }
  .kicker {
    margin: 0 0 6px;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-ink-muted, #5a5f53);
  }
  ul {
    margin: 0 0 6px;
    padding-left: 18px;
  }
  li {
    margin: 2px 0;
  }
  .block-name {
    font-weight: 600;
  }
  .foot {
    margin: 4px 0 0;
    font-size: 0.8rem;
    color: var(--color-ink-muted, #5a5f53);
  }
</style>
