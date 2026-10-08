<script lang="ts">
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  /**
   * Phase 25e (#97) — /today "Season at a glance" card.
   *
   * 1:1 port of the `ATodayScreen` season-glance card in
   * [`direction-almanac-today.jsx`](../../../../docs/design/almanac/direction-almanac-today.jsx)
   * (lines 376–389). Three big serif numbers.
   */
  import Card from '$lib/components/ui/Card.svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import { glanceCells, type SeasonGlance } from '$lib/today/seasonGlance';

  interface Props {
    glance: SeasonGlance;
  }
  const { glance }: Props = $props();

  const cells = $derived(glanceCells(glance, page.data?.locale));
  const tr = $derived(createT(page.data?.locale));
</script>

<Card>
  <Kicker>{tr('today.glance.title')}</Kicker>
  <div class="grid">
    {#each cells as cell (cell.id)}
      <div class="cell">
        <div class="num serif">{cell.value}</div>
        <div class="label">{cell.label}</div>
      </div>
    {/each}
  </div>
</Card>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
    margin-top: 12px;
  }
  .num {
    font-size: 28px;
    color: var(--color-forest-deep);
    letter-spacing: -0.02em;
    line-height: 1;
    font-family: var(--font-serif, serif);
  }
  .label {
    font-size: 11.5px;
    color: var(--color-ink-muted);
    margin-top: 4px;
  }
</style>
