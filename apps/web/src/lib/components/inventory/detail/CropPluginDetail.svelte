<script lang="ts">
  /**
   * Sprint 7 / Phase 27C (#257) — crop plugin detail.
   *
   * Catalog-only (no lots — crops are metadata). Two-column per
   * INVENTORY_UNIFICATION.md §02:
   *   Left  — plugin metadata · varieties · growth stages · pest watchlist
   *   Right — where it's used · dependencies · plugin source (JSON preview)
   *
   * Closes #237 (postHarvestCuring [object Object] rendering) by routing
   * every plugin field through `formatField()` which expands range-shaped
   * objects ({min, max, unit}) into readable strings before render.
   * Subsumes the pre-Almanac /plugins/[id] route until Sprint 9 cutover.
   */
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import { cropDisplayName } from '$lib/i18n/cropName';
  import InvSection from '../InvSection.svelte';
  import InvKVP from '../InvKVP.svelte';
  import { currentPrefs } from '$lib/prefsState.svelte';
  import { formatRateText } from '$lib/stock/units';
  import type { CropDetailPayload } from '../../../../routes/inventory/[type]/[id]/+page.server';

  type Props = Omit<CropDetailPayload, 'type'>;
  const { plugin, resolvedArchetype, hash }: Props = $props();
  const tr = $derived(createT(page.data?.locale));

  /** Phase 27C / #237 fix — flatten range-shaped objects so the detail
   *  card stops rendering "[object Object]" for fields like
   *  postHarvestCuring.durationWeeks. */
  function formatField(v: unknown): string {
    if (v == null) return '—';
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      return String(v);
    }
    if (Array.isArray(v)) {
      if (v.length === 0) return '—';
      return tr('inv.crop.items', { count: v.length });
    }
    if (typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      // {min, max} → "10–14"; with unit → "10–14 wk"
      if ('min' in obj && 'max' in obj) {
        const unit = 'unit' in obj ? ` ${String(obj.unit)}` : '';
        return `${obj.min}–${obj.max}${unit}`;
      }
      // {amount, unit} → "32 fl oz/ac"
      if ('amount' in obj && 'unit' in obj) {
        return typeof obj.amount === 'number'
          ? formatRateText(obj.amount, String(obj.unit), currentPrefs())
          : `${obj.amount} ${obj.unit}`;
      }
      // {n, p, k} → "10-10-10"
      if ('n' in obj && 'p' in obj && 'k' in obj) {
        return `${obj.n}-${obj.p}-${obj.k}`;
      }
      // Fallback: short JSON preview rather than the leaky default.
      const keys = Object.keys(obj);
      return keys.length === 0 ? '—' : `{${keys.slice(0, 3).join(', ')}…}`;
    }
    return '—';
  }

  const varieties = $derived(Array.isArray(plugin.varieties) ? plugin.varieties : []);
  const growthStages = $derived(Array.isArray(plugin.growthStages) ? plugin.growthStages : []);
  const seasonalTasks = $derived(Array.isArray(plugin.seasonalTasks) ? plugin.seasonalTasks : []);
  const postHarvestCuring = $derived(
    plugin.postHarvestCuring as Record<string, unknown> | undefined
  );
</script>

<header class="detail-header">
  <span class="kicker"
    >{tr('inv.crop.kicker', { family: plugin.cropFamily ?? tr('inv.seed.unknownFamily') })}</span
  >
  <h1 class="serif">{cropDisplayName(plugin.pluginId, plugin.displayName, page.data?.locale)}</h1>
  <p class="sub mono">{plugin.pluginId}</p>
</header>

<div class="detail-grid">
  <div class="col">
    <InvSection title={tr('inv.crop.about')} kicker={tr('inv.crop.identity')}>
      <InvKVP label={tr('inv.crop.id')} value={plugin.pluginId} tone="mono" />
      <InvKVP label={tr('inv.seed.cropFamily')} value={plugin.cropFamily ?? '—'} />
      <InvKVP label={tr('inv.crop.archDeclared')} value={plugin.archetype ?? '—'} tone="locked" />
      <InvKVP label={tr('inv.crop.archResolved')} value={resolvedArchetype} tone="locked" />
      {#if plugin.daysToMaturity}
        <InvKVP label={tr('inv.seed.daysToMaturity')} value={formatField(plugin.daysToMaturity)} />
      {/if}
      {#if plugin.preHarvestIntervalDays != null}
        <InvKVP label="PHI" value={`${plugin.preHarvestIntervalDays} d`} tone="locked" />
      {/if}
    </InvSection>

    {#if varieties.length > 0}
      <InvSection title={tr('inv.crop.varieties')} kicker={tr('inv.crop.fromLibrary')}>
        <ul class="bullet-list">
          {#each varieties.slice(0, 12) as v, idx (idx)}
            <li>
              {#if typeof v === 'string'}
                {v}
              {:else if v && typeof v === 'object' && 'displayName' in (v as Record<string, unknown>)}
                {(v as { displayName: string }).displayName}
              {:else}
                {formatField(v)}
              {/if}
            </li>
          {/each}
          {#if varieties.length > 12}
            <li class="muted small">{tr('inv.crop.andMore', { n: varieties.length - 12 })}</li>
          {/if}
        </ul>
      </InvSection>
    {/if}

    {#if growthStages.length > 0}
      <InvSection title={tr('inv.crop.growthStages')} kicker={tr('inv.crop.stagesKicker')}>
        <ul class="bullet-list">
          {#each growthStages.slice(0, 10) as s, idx (idx)}
            <li>{formatField(s)}</li>
          {/each}
        </ul>
      </InvSection>
    {/if}

    {#if postHarvestCuring}
      <InvSection title={tr('inv.crop.curing')} kicker="FR-08">
        <InvKVP label={tr('inv.crop.method')} value={formatField(postHarvestCuring.method)} />
        <InvKVP
          label={tr('inv.crop.duration')}
          value={formatField(postHarvestCuring.durationWeeks)}
        />
        <InvKVP
          label={tr('inv.crop.targetMoisture')}
          value={formatField(postHarvestCuring.targetMoisturePercent)}
        />
        <InvKVP
          label={tr('inv.crop.storage')}
          value={formatField(postHarvestCuring.storageLocation)}
        />
      </InvSection>
    {/if}
  </div>

  <div class="col">
    <InvSection title={tr('inv.crop.whereUsed')} kicker={tr('inv.crop.crossRefs')}>
      <p class="empty small">
        {tr('inv.crop.whereUsedNote')}
      </p>
    </InvSection>

    {#if seasonalTasks.length > 0}
      <InvSection title={tr('inv.crop.seasonalTasks')} kicker={tr('inv.crop.fromLibrary')}>
        <ul class="bullet-list">
          {#each seasonalTasks.slice(0, 8) as t, idx (idx)}
            <li>{formatField(t)}</li>
          {/each}
        </ul>
      </InvSection>
    {/if}

    <InvSection title={tr('inv.crop.source')} kicker={tr('inv.crop.signedHash')}>
      <InvKVP label={tr('inv.crop.hash')} value={hash} tone="mono" />
      <details class="json-preview">
        <summary>{tr('inv.crop.viewJson', { n: Object.keys(plugin).length })}</summary>
        <pre class="mono">{JSON.stringify(plugin, null, 2)}</pre>
      </details>
    </InvSection>
  </div>
</div>

<style>
  .detail-header {
    margin-bottom: 16px;
  }
  .kicker {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--color-ink-muted, #6a6f63);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  h1 {
    margin: 2px 0 4px;
    font-size: 1.5rem;
    color: var(--color-forest-deep, #1f3522);
  }
  .sub {
    margin: 0;
    color: var(--color-ink-muted, #6a6f63);
    font-size: 0.85rem;
  }
  .detail-grid {
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 14px;
  }
  @media (max-width: 768px) {
    .detail-grid {
      grid-template-columns: 1fr;
    }
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .bullet-list {
    list-style: disc;
    padding-left: 18px;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 0.9rem;
  }
  .empty {
    color: var(--color-ink-muted, #6a6f63);
    font-style: italic;
    margin: 0;
    font-size: 0.9rem;
  }
  .small {
    font-size: 0.8rem;
  }
  .muted {
    color: var(--color-ink-muted, #6a6f63);
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  }
  .json-preview pre {
    background: #f4ecd8;
    padding: 8px 10px;
    border-radius: 4px;
    font-size: 0.75rem;
    max-height: 320px;
    overflow: auto;
    margin: 6px 0 0;
  }
  details summary {
    cursor: pointer;
    font-size: 0.85rem;
    color: var(--color-forest, #1f5e3a);
  }
</style>
