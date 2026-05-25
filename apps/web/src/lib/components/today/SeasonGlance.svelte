<script lang="ts">
  /**
   * Phase 25e (#97) — /today "Season at a glance" card.
   *
   * 1:1 port of the `ATodayScreen` season-glance card in
   * [`direction-almanac-today.jsx`](../../../../docs/design/almanac/direction-almanac-today.jsx)
   * (lines 376–389). Four big serif numbers.
   */
  import Card from '$lib/components/ui/Card.svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import type { SeasonGlance } from '$lib/today/seasonGlance';

  interface Props {
    glance: SeasonGlance;
  }
  const { glance }: Props = $props();

  const cells = $derived([
    [String(glance.activePlantings), 'active plantings'],
    [String(glance.spraysYTD), 'sprays YTD'],
    [glance.daysToNextHarvest === null ? '—' : String(glance.daysToNextHarvest), 'days to next harvest'],
    [String(glance.pluginsLoaded), 'plugins loaded']
  ] as const);
</script>

<Card>
  <Kicker>Season at a glance</Kicker>
  <div class="grid">
    {#each cells as [n, label] (label)}
      <div class="cell">
        <div class="num serif">{n}</div>
        <div class="label">{label}</div>
      </div>
    {/each}
  </div>
</Card>

<style>
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
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
