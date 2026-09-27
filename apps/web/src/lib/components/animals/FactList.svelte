<script lang="ts">
  import type { Fact } from '$lib/animals/facts';

  interface Props {
    facts: Fact[];
  }

  const { facts }: Props = $props();
</script>

<dl class="facts">
  {#each facts as f (f.label)}
    <div class="fact">
      <dt>{f.label}</dt>
      <dd>{f.value}</dd>
    </div>
  {/each}
</dl>

<style>
  .facts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: var(--space-3);
    margin: 0;
  }
  .fact {
    min-width: 0;
  }
  dt {
    font-size: var(--font-size-kicker);
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-ink-muted);
  }
  dd {
    margin: 2px 0 0;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
</style>
