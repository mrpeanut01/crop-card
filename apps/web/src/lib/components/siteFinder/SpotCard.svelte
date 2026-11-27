<script lang="ts">
  import { page } from '$app/state';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { createT } from '$lib/i18n';
  import { currentPrefs } from '$lib/prefsState.svelte';
  import { designerHref } from '$lib/garden/design';
  import { describeSoil } from '$lib/soil/describe';
  import type { SoilLookup } from '$lib/soil/types';
  import { confidenceText, factorLines, spotLabel, spotLabelText } from '$lib/siteFinder/explain';
  import type { Candidate, FactorProvenance } from '$lib/siteFinder/types';

  /** One offered spot: what it scored as words, why, the soil survey there
   *  and the owner's two choices. */
  interface Props {
    candidate: Candidate;
    rank: number;
    soil: SoilLookup;
    areaKind: 'garden' | 'orchard' | 'field';
    defaultName: string;
    /** Set once the owner created the Area from this spot. */
    created?: { id: string; name: string } | null;
    busy?: boolean;
    error?: string | null;
    onCreate: (name: string) => void;
    onDismiss: () => void;
  }
  const {
    candidate,
    rank,
    soil,
    areaKind,
    defaultName,
    created = null,
    busy = false,
    error = null,
    onCreate,
    onDismiss
  }: Props = $props();

  const tr = $derived(createT(page.data?.locale));
  const locale = $derived(page.data?.locale ?? null);
  const prefs = $derived(currentPrefs());
  const opts = $derived({ locale, units: prefs.units });
  const lines = $derived(factorLines(candidate, opts));
  const label = $derived(
    spotLabel(
      candidate.score,
      rank,
      candidate.factors.some((f) => f.verdict === 'poor')
    )
  );
  const soilLines = $derived(
    soil.status === 'ok' && !soil.survey.notSoil ? describeSoil(soil.survey, opts) : []
  );

  // The stock chip words ("Your data", "You typed") do not fit a survey
  // fact, something drawn on the map or an app estimate.
  function provLabel(p: FactorProvenance, source?: 'elevation'): string | undefined {
    if (source === 'elevation') return tr('sitefinder.prov.elevation');
    if (p === 'data') return tr('sitefinder.prov.survey');
    if (p === 'manual') return tr('sitefinder.prov.map');
    if (p === 'fallback') return tr('sitefinder.prov.estimate');
    return undefined;
  }

  let naming = $state(false);
  let name = $state('');
  $effect(() => {
    if (!name) name = defaultName;
  });
</script>

<article class="spot" data-testid="spot-card" data-rank={rank + 1} data-label={label}>
  <header>
    <span class="num" aria-hidden="true">{rank + 1}</span>
    <div class="head">
      <h3 class="serif">{tr('sitefinder.spot.title', { n: rank + 1 })}</h3>
      <p class="label" data-testid="spot-label">
        <strong>{spotLabelText(label, locale)}</strong>
        <span class="conf">{confidenceText(candidate.confidence, locale)}</span>
      </p>
    </div>
  </header>

  <ul class="factors">
    {#each lines as line, i (i)}
      <li
        class="factor"
        data-verdict={line.verdict}
        data-factor={line.id}
        data-provenance={line.provenance}
        data-source={line.source}
      >
        <span class="mark" aria-hidden="true"></span>
        <span class="text">
          {#if line.id === 'ai-note'}<span lang="en">{line.text}</span>{:else}{line.text}{/if}
          {#if !(line.verdict === 'unknown' && line.provenance === 'manual')}
            <span class="prov"
              ><Provenance
                source={line.provenance}
                label={provLabel(line.provenance, line.source)}
              /></span
            >
          {/if}
        </span>
      </li>
    {/each}
  </ul>

  {#if soilLines.length > 0}
    <details class="soil" data-testid="spot-soil">
      <summary>{tr('sitefinder.spot.soilTitle')}</summary>
      <dl>
        {#each soilLines as l (l.id)}
          <div>
            <dt>{l.label}</dt>
            <dd>
              {l.value}{#if l.note}<span class="note">{l.note}</span>{/if}
            </dd>
          </div>
        {/each}
      </dl>
      <p class="source">
        <Provenance source="data" label={tr('sitefinder.spot.soilSource')} />
        {tr('soil.panel.scaleNote')}
      </p>
    </details>
  {/if}

  {#if created}
    <div class="created" role="status" data-testid="spot-created">
      <p>{tr('sitefinder.spot.created', { name: created.name })}</p>
      <div class="actions">
        {#if areaKind === 'garden'}
          <a class="primary" href={designerHref(created.id)} data-testid="spot-next"
            >{tr('sitefinder.spot.openDesigner')}</a
          >
        {:else}
          <a
            class="primary"
            href={`/plan?area=${encodeURIComponent(created.id)}`}
            data-testid="spot-next">{tr('sitefinder.spot.planPlanting')}</a
          >
        {/if}
        <a class="ghost" href="/plan/farm">{tr('sitefinder.spot.seeOnMap')}</a>
      </div>
    </div>
  {:else if naming}
    <form
      class="naming"
      onsubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onCreate(name.trim());
      }}
    >
      <label>
        <span>{tr('sitefinder.spot.nameLabel')}</span>
        <input type="text" bind:value={name} maxlength="120" required data-testid="spot-name" />
      </label>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="actions">
        <button type="submit" class="primary" disabled={busy} data-testid="spot-save"
          >{tr('sitefinder.spot.save')}</button
        >
        <button type="button" class="ghost" disabled={busy} onclick={() => (naming = false)}
          >{tr('sitefinder.spot.cancel')}</button
        >
      </div>
    </form>
  {:else}
    <div class="actions">
      <button
        type="button"
        class="primary"
        onclick={() => (naming = true)}
        data-testid="spot-create">{tr('sitefinder.spot.create')}</button
      >
      <button type="button" class="ghost" onclick={onDismiss} data-testid="spot-dismiss"
        >{tr('sitefinder.spot.notHere')}</button
      >
    </div>
  {/if}
</article>

<style>
  .spot {
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card, 12px);
    background: var(--color-paper);
    padding: var(--space-3);
    min-width: 0;
  }
  header {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  .num {
    flex: none;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-forest);
    color: var(--color-paper, #fff);
    font-weight: 700;
  }
  h3 {
    margin: 0;
    font-size: var(--text-lg, 1.15rem);
  }
  .head {
    min-width: 0;
  }
  .label {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0 var(--space-2);
  }
  .conf {
    color: var(--color-ink-soft);
  }
  .factors {
    list-style: none;
    margin: var(--space-3) 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  .factor {
    display: grid;
    grid-template-columns: 14px minmax(0, 1fr);
    gap: var(--space-2);
    align-items: start;
  }
  .text {
    overflow-wrap: anywhere;
  }
  .prov {
    display: inline-block;
    margin-left: var(--space-1);
    vertical-align: middle;
  }
  .mark {
    width: 10px;
    height: 10px;
    margin-top: 0.4em;
    border-radius: 50%;
    background: var(--color-ink-soft);
  }
  .factor[data-verdict='good'] .mark {
    background: var(--color-forest);
  }
  .factor[data-verdict='ok'] .mark {
    background: var(--color-honey-deep, #6a4f00);
  }
  .factor[data-verdict='poor'] .mark {
    background: var(--color-rust-deep, #8a2f1d);
    border-radius: 2px;
  }
  .factor[data-verdict='unknown'] .mark {
    background: transparent;
    border: 2px solid var(--color-ink-soft);
  }
  .soil {
    margin: 0 0 var(--space-3);
    border-top: 1px solid var(--color-divider);
    padding-top: var(--space-2);
  }
  .soil summary {
    min-height: 48px;
    display: flex;
    align-items: center;
    cursor: pointer;
    font-weight: 600;
    color: var(--color-forest);
  }
  dl {
    margin: 0;
    display: grid;
    gap: var(--space-2);
  }
  dt {
    font-weight: 600;
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .note {
    display: block;
    color: var(--color-ink-soft);
  }
  .source {
    margin: var(--space-2) 0 0;
    color: var(--color-ink-soft);
    font-size: var(--text-sm, 0.9rem);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .primary,
  .ghost {
    min-height: 48px;
    display: inline-flex;
    align-items: center;
    padding: 0 var(--space-3);
    border-radius: var(--radius-input);
    border: 1px solid var(--color-forest);
    font: inherit;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
  }
  .primary {
    background: var(--color-forest);
    color: var(--color-paper, #fff);
  }
  .ghost {
    background: transparent;
    color: var(--color-forest);
  }
  .naming label {
    display: grid;
    gap: var(--space-1);
    margin-bottom: var(--space-2);
  }
  .naming input {
    min-height: 48px;
    padding: 0 var(--space-2);
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-input);
    font: inherit;
    width: 100%;
    box-sizing: border-box;
  }
  .created p {
    margin: 0 0 var(--space-2);
    font-weight: 600;
    color: var(--color-forest);
  }
  .error {
    margin: 0 0 var(--space-2);
    color: var(--color-rust-deep, #8a2f1d);
  }
</style>
