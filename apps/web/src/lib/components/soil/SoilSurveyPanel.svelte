<script lang="ts">
  import { page } from '$app/state';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { createT } from '$lib/i18n';
  import { currentPrefs } from '$lib/prefsState.svelte';
  import { describeSoil } from '$lib/soil/describe';
  import { soilSitingFlags, soilSitingFlagText } from '$lib/soil/siting';
  import { WEB_SOIL_SURVEY_URL, type SoilAreaResponse, type SoilLookup } from '$lib/soil/types';

  /** The USDA NRCS soil survey for an Area or a map point, in plain words.
   *  It reads `/api/soil/**` after the page is up (when `collapsed`, only
   *  once opened), so it never slows a page load. Online only: the survey
   *  is not part of the saved Card copy. Reference data for the reader;
   *  nothing in the app computes from it. */
  interface Props {
    /** An Area of the farm; the server uses the centre of its outline. */
    areaId?: string;
    /** Or a point. Both null shows the "save your location" line. */
    lat?: number | null;
    lon?: number | null;
    /** `here` titles it "What the soil survey says here". */
    heading?: 'survey' | 'here';
    /** Render folded; the lookup starts when it is opened. */
    collapsed?: boolean;
    /** Says the point is the farm's saved location. */
    farmLocation?: boolean;
    /** Link to the soil test sheet on /fertility. Off on /fertility itself. */
    soilTestLink?: boolean;
  }
  const {
    areaId,
    lat = null,
    lon = null,
    heading = 'survey',
    collapsed = false,
    farmLocation = false,
    soilTestLink = true
  }: Props = $props();

  type View =
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'offline' }
    | { kind: 'not-located' }
    | { kind: 'need-location' }
    | { kind: 'done'; lookup: SoilLookup; approximate: boolean };

  const tr = $derived(createT(page.data?.locale));
  const locale = $derived(page.data?.locale ?? null);
  const prefs = $derived(currentPrefs());

  let view = $state<View>({ kind: 'idle' });
  let opened = $state(false);
  let attempt = $state(0);

  const url = $derived(
    areaId
      ? `/api/soil/areas/${encodeURIComponent(areaId)}`
      : typeof lat === 'number' &&
          typeof lon === 'number' &&
          Number.isFinite(lat) &&
          Number.isFinite(lon)
        ? `/api/soil/survey?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`
        : null
  );

  $effect(() => {
    void attempt;
    if (collapsed && !opened) return;
    if (!url) {
      view = { kind: areaId ? 'not-located' : 'need-location' };
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      view = { kind: 'offline' };
      return;
    }
    const target = url;
    const controller = new AbortController();
    view = { kind: 'loading' };
    const timer = setTimeout(
      () => {
        void (async () => {
          try {
            const res = await fetch(target, { signal: controller.signal });
            if (!res.ok) {
              view = { kind: 'done', lookup: { status: 'unavailable' }, approximate: false };
              return;
            }
            const body = (await res.json()) as SoilLookup | SoilAreaResponse;
            if ('located' in body) {
              view = body.located
                ? { kind: 'done', lookup: body.lookup, approximate: body.approximate }
                : { kind: 'not-located' };
            } else {
              view = { kind: 'done', lookup: body, approximate: false };
            }
          } catch {
            if (controller.signal.aborted) return;
            view =
              typeof navigator !== 'undefined' && navigator.onLine === false
                ? { kind: 'offline' }
                : { kind: 'done', lookup: { status: 'unavailable' }, approximate: false };
          }
        })();
      },
      areaId ? 0 : 500
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  });

  const survey = $derived(
    view.kind === 'done' && view.lookup.status === 'ok' ? view.lookup.survey : null
  );
  const lines = $derived(survey ? describeSoil(survey, { locale, units: prefs.units }) : []);
  const flags = $derived(
    survey
      ? soilSitingFlags(survey).map((f) => ({ ...f, text: soilSitingFlagText(f, locale) }))
      : []
  );
  const title = $derived(tr(heading === 'here' ? 'soil.panel.titleHere' : 'soil.panel.title'));
  const status = $derived(view.kind === 'done' ? view.lookup.status : view.kind);
</script>

{#snippet body()}
  {#if heading === 'here'}
    <p class="lede">{tr('soil.panel.labWins')}</p>
  {/if}
  {#if view.kind === 'idle' || view.kind === 'loading'}
    <p class="quiet" role="status" data-testid="soil-loading">{tr('soil.panel.loading')}</p>
  {:else if view.kind === 'offline'}
    <p class="quiet" role="status" data-testid="soil-offline">{tr('soil.panel.offline')}</p>
  {:else if view.kind === 'not-located'}
    <p class="quiet" data-testid="soil-not-located">{tr('soil.panel.notLocated')}</p>
  {:else if view.kind === 'need-location'}
    <p class="quiet" data-testid="soil-need-location">{tr('soil.panel.needLocation')}</p>
  {:else if view.lookup.status === 'no-data'}
    <p class="quiet" role="status" data-testid="soil-no-data">{tr('soil.panel.noData')}</p>
  {:else if view.lookup.status === 'unavailable'}
    <div class="retry" role="status" data-testid="soil-unavailable">
      <p class="quiet">{tr('soil.panel.unavailable')}</p>
      <button type="button" onclick={() => (attempt += 1)}>{tr('soil.panel.retry')}</button>
    </div>
  {:else}
    {#if view.approximate}
      <p class="approx" data-testid="soil-approximate">{tr('soil.panel.approximate')}</p>
    {:else if farmLocation}
      <p class="quiet">{tr('soil.panel.farmLocation')}</p>
    {/if}
    <dl class="lines" data-testid="soil-lines">
      {#each lines as line (line.id)}
        <div class="line" data-soil-line={line.id}>
          <dt>
            {line.label}
            <Provenance
              source={line.provenance}
              label={tr('soil.panel.provLabel')}
              long={tr('soil.panel.provLong')}
              compact
            />
          </dt>
          <dd>
            <span class="value">{line.value}</span>
            {#if line.note}<span class="note">{line.note}</span>{/if}
          </dd>
        </div>
      {/each}
    </dl>
    {#if flags.length > 0}
      <div class="flags" data-testid="soil-flags">
        <h4>{tr('soil.panel.flagsTitle')}</h4>
        <ul>
          {#each flags as flag (flag.id)}
            <li class="flag" class:caution={flag.severity === 'caution'} data-soil-flag={flag.id}>
              {flag.text}
            </li>
          {/each}
        </ul>
      </div>
    {/if}
    <div class="notes">
      <p data-testid="soil-scale-note">{tr('soil.panel.scaleNote')}</p>
      <p data-testid="soil-lab-note">
        {tr('soil.panel.labNote')}
        {#if soilTestLink}
          <a href="/fertility?soilTest=1">{tr('soil.panel.labLink')}</a>
        {/if}
      </p>
      <p class="source" data-testid="soil-source">
        {tr('soil.panel.source')}
        <a href={WEB_SOIL_SURVEY_URL} target="_blank" rel="noopener noreferrer"
          >{tr('soil.panel.sourceLink')}</a
        >
      </p>
    </div>
  {/if}
{/snippet}

{#if collapsed}
  <details
    class="soil-panel"
    data-testid="soil-survey-panel"
    data-state={status}
    ontoggle={(e) => {
      if (e.currentTarget.open) opened = true;
    }}
  >
    <summary>{title}</summary>
    {@render body()}
  </details>
{:else}
  <section class="soil-panel" data-testid="soil-survey-panel" data-state={status}>
    <h3>{title}</h3>
    {@render body()}
  </section>
{/if}

<style>
  .soil-panel {
    margin: var(--space-3) 0;
    padding: var(--space-3);
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-card, 12px);
    min-width: 0;
  }
  h3,
  summary {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-ink);
  }
  h3 {
    margin-bottom: var(--space-2);
  }
  summary {
    display: flex;
    align-items: center;
    min-height: 48px;
    cursor: pointer;
  }
  summary:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  details:not([open]) {
    padding-top: 0;
    padding-bottom: 0;
  }
  h4 {
    margin: 0 0 var(--space-1);
    font-size: var(--font-size-meta, 12px);
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-ink-soft);
  }
  p {
    margin: 0;
  }
  .lede {
    margin-bottom: var(--space-2);
    color: var(--color-ink);
  }
  .quiet {
    color: var(--color-ink-muted);
    font-size: 14px;
  }
  .approx {
    margin-bottom: var(--space-2);
    padding: var(--space-2);
    border-left: 3px solid var(--color-wheat, var(--color-rule));
    background: var(--color-paper-soft, transparent);
    font-size: 14px;
  }
  .retry {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  button {
    min-height: 48px;
    padding: 0 18px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 8px);
    background: var(--color-paper);
    color: var(--color-forest-deep);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .lines {
    display: flex;
    flex-direction: column;
    margin: var(--space-2) 0 0;
  }
  .line {
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--color-divider-soft, var(--color-rule));
  }
  dt {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
    color: var(--color-ink-soft);
  }
  dd {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 2px 0 0;
    overflow-wrap: anywhere;
  }
  .value {
    font-weight: 600;
    color: var(--color-ink);
  }
  .note {
    color: var(--color-ink-muted);
    font-size: 14px;
  }
  .flags {
    margin-top: var(--space-3);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .flag {
    padding: var(--space-2);
    border-left: 3px solid var(--color-rule);
    font-size: 14px;
  }
  .flag.caution {
    border-left-color: var(--color-rust);
  }
  .notes {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-top: var(--space-3);
    color: var(--color-ink-muted);
    font-size: 14px;
  }
  a {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    color: var(--color-forest);
    font-weight: 600;
  }
</style>
