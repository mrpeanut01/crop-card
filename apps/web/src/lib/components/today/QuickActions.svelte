<script lang="ts">
  /**
   * Phase 25e (#97) — /today quick actions card.
   *
   * 1:1 port of the right-column "Quick actions" card in
   * [`direction-almanac-today.jsx`](../../../../docs/design/almanac/direction-almanac-today.jsx)
   * (lines 280–306). Three primary verbs with chip icons.
   */
  import { ChevronRight, SprayCan, Wheat, Eye } from 'lucide-svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';

  type LucideIcon = typeof Eye;
  type Action = { label: string; href: string; icon: LucideIcon };

  const ACTIONS: Action[] = [
    { label: 'Spray', href: '/spray', icon: SprayCan },
    { label: 'Record harvest', href: '/harvest', icon: Wheat },
    { label: 'Log scout note', href: '/scout', icon: Eye }
  ];
</script>

<Card padded={false}>
  <div class="head">
    <Kicker>Quick actions</Kicker>
  </div>
  <div class="rows">
    {#each ACTIONS as { label, href, icon: Icon } (label)}
      <a class="row" {href}>
        <span class="row-icon">
          <Icon size={16} strokeWidth={1.75} />
        </span>
        <span class="row-label">{label}</span>
        <ChevronRight size={14} strokeWidth={1.75} class="row-arrow" />
      </a>
    {/each}
  </div>
</Card>

<style>
  .head {
    padding: 20px 22px 12px;
  }
  .rows {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1px;
    background: var(--color-divider-soft, var(--color-divider));
  }
  .row {
    background: var(--color-paper);
    padding: 16px 18px;
    display: flex;
    align-items: center;
    gap: 12px;
    color: var(--color-forest-deep);
    font-size: 14px;
    font-weight: 500;
    text-decoration: none;
    text-align: left;
    border: none;
    font-family: inherit;
  }
  .row:hover {
    background: var(--color-cream);
  }
  .row-icon {
    width: 32px;
    height: 32px;
    border-radius: 6px;
    background: var(--color-forest-tint, #e5eedf);
    display: grid;
    place-items: center;
    color: var(--color-forest);
  }
  .row-label {
    flex: 1;
  }
  :global(.row .row-arrow) {
    color: var(--color-ink-muted);
  }
</style>
