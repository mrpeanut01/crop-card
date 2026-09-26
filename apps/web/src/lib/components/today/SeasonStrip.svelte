<script lang="ts">
  import Card from '$lib/components/ui/Card.svelte';
  import { fmt } from '$lib/prefsState.svelte';

  interface Crop {
    id: string;
    varietyDisplayName: string;
    blockId: string;
  }
  interface SeasonEvent {
    startMs: number;
    endMs: number;
    kind: string;
    title: string;
    blockId: string;
  }
  interface Props {
    crops: Crop[];
    events: SeasonEvent[];
    fromMs: number;
    toMs: number;
  }
  const { crops, events, fromMs, toMs }: Props = $props();

  const DAY_MS = 86_400_000;
  const span = $derived(Math.max(1, toMs - fromMs));
  const weeks = $derived.by(() => {
    const out: number[] = [];
    for (let ms = fromMs; ms < toMs; ms += 14 * DAY_MS) out.push(ms);
    return out;
  });
</script>

<Card>
  <h3 class="serif head">Season by crop</h3>
  {#if crops.length === 0}
    <p class="hint">
      Nothing planted or planned yet. Plan a crop on the Plan page to see its season here.
    </p>
  {:else}
    <div class="gantt" role="list" aria-label="Crop calendar by planting">
      <div class="axis" aria-hidden="true">
        {#each weeks as ms (ms)}
          <span>{fmt.instant(ms, 'month-day')}</span>
        {/each}
      </div>
      {#each crops as crop (crop.id)}
        {@const mine = events.filter((e) => e.blockId === crop.blockId)}
        <div class="row" role="listitem">
          <span class="label">{crop.varietyDisplayName}</span>
          <div class="track">
            {#each mine as e, i (i)}
              <span
                class="bar kind-{e.kind}"
                style="left:{Math.max(0, ((e.startMs - fromMs) / span) * 100)}%; width:{Math.max(
                  1,
                  ((e.endMs - e.startMs) / span) * 100
                )}%"
                title="{e.title}, {fmt.instant(e.startMs, 'month-day')}"
              ></span>
            {/each}
          </div>
          <span class="sr-only">
            {mine.length
              ? mine.map((e) => `${e.title} ${fmt.instant(e.startMs, 'month-day')}`).join('; ')
              : 'Nothing on the calendar'}
          </span>
        </div>
      {/each}
    </div>
  {/if}
</Card>

<style>
  .head {
    margin: 0 0 12px;
    font-size: 18px;
  }
  .hint {
    margin: 0;
    color: var(--color-ink-soft);
  }
  .gantt {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .axis {
    display: flex;
    padding-left: 7rem;
    color: var(--color-ink-soft);
    font-size: 11px;
    overflow: hidden;
  }
  .axis span {
    flex: 1 0 0;
    min-width: 0;
    padding: 0 2px;
    border-left: 1px solid var(--color-divider-soft);
    white-space: nowrap;
    overflow: hidden;
  }
  .row {
    display: grid;
    grid-template-columns: 6.5rem minmax(0, 1fr);
    align-items: center;
    gap: 0.5rem;
  }
  .label {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-forest-deep);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .track {
    position: relative;
    height: 1.6rem;
    background: var(--color-cream);
    border-radius: 4px;
    overflow: hidden;
  }
  .bar {
    position: absolute;
    top: 0.2rem;
    bottom: 0.2rem;
    background: rgba(31, 94, 58, 0.6);
    border-radius: 3px;
  }
  .bar.kind-spray-window {
    background: rgba(74, 110, 163, 0.6);
  }
  .bar.kind-harvest-window {
    background: rgba(179, 89, 0, 0.6);
  }
  .bar.kind-orchard-task {
    background: rgba(120, 84, 184, 0.6);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
