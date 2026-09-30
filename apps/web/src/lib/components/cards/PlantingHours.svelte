<script lang="ts">
  import { formatHours } from '$lib/labour/hours';

  interface Props {
    plantingId: string;
    /** Only owners see who put in the time (F1-17). */
    role: string | null;
  }
  const { plantingId, role }: Props = $props();

  let rows = $state<{ id: string; name: string; minutes: number }[]>([]);

  $effect(() => {
    rows = [];
    if (role !== 'owner' || typeof navigator === 'undefined' || navigator.onLine === false) return;
    const id = plantingId;
    let live = true;
    void (async () => {
      try {
        const res = await fetch(`/api/plantings/${encodeURIComponent(id)}/hours`);
        if (!res.ok || !live) return;
        const body = (await res.json()) as {
          byPerson?: { id: string; name: string; minutes: number }[];
        };
        if (live) rows = body.byPerson ?? [];
      } catch {
        rows = [];
      }
    })();
    return () => {
      live = false;
    };
  });
</script>

{#if rows.length > 0}
  <section class="hours" aria-labelledby="hours-{plantingId}" data-testid="planting-hours">
    <h2 id="hours-{plantingId}">Time by person</h2>
    <ul>
      {#each rows as r (r.id)}
        <li><span class="name">{r.name}</span><span>{formatHours(r.minutes)}</span></li>
      {/each}
    </ul>
    <p class="hint">Only you see this split. Helpers see the total on the card.</p>
  </section>
{/if}

<style>
  .hours {
    max-width: 640px;
    margin: var(--space-3) 0;
    padding: var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    background: var(--color-paper);
  }
  h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-card-title);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  li {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .name {
    font-weight: 600;
    overflow-wrap: anywhere;
    min-width: 0;
  }
  .hint {
    margin: var(--space-2) 0 0;
    color: var(--color-ink-soft);
    font-size: var(--font-size-caption);
  }
</style>
