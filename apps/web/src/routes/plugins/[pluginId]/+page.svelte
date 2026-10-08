<script lang="ts">
  import { cropDisplayName } from '$lib/i18n/cropName';
  import { seasonalRowText } from '$lib/i18n/seasonalTaskText';
  import { goto, invalidateAll } from '$app/navigation';
  import GroupCodeBadge from '$lib/components/GroupCodeBadge.svelte';
  import PluginRef from '$lib/components/PluginRef.svelte';
  import PluginVersionTimeline from '$lib/components/PluginVersionTimeline.svelte';
  import { hracGroupOf } from '$lib/safety/cropFamilyLethality';
  import { rangeText } from '$lib/plugins/rangeText';
  import { fmt, currentPrefs } from '$lib/prefsState.svelte';
  import { formatRateText } from '$lib/stock/units';
  import FallbackRateLine from '$lib/components/spray/FallbackRateLine.svelte';
  import { isFallbackRate } from '$lib/plugins/rateProvenance';
  import { createT } from '$lib/i18n';
  import { cropFamilyLabel } from '$lib/plugins/familyLabel';
  import { TASK_CATEGORY_VALUES, labelForTaskCategory } from '$lib/plan/taskCategory';
  import { page } from '$app/state';

  let { data } = $props();
  const tr = $derived(createT(page.data?.locale));
  const TYPE_KEYS = {
    crop: 'plugins.type.crop',
    herbicide: 'plugins.type.herbicide',
    insecticide: 'plugins.type.insecticide',
    fungicide: 'plugins.type.fungicide',
    fertilizer: 'plugins.type.fertilizer',
    companion: 'plugins.type.companion'
  } as const;
  function typeLabel(type: string): string {
    return type in TYPE_KEYS ? tr(TYPE_KEYS[type as keyof typeof TYPE_KEYS]) : type;
  }
  function familyLabel(family: unknown): string {
    return typeof family === 'string' ? cropFamilyLabel(family, page.data?.locale) : '';
  }
  const SEASONAL_KINDS = [
    'spray',
    'cultural',
    'pruning',
    'thinning',
    'fertilize',
    'irrigate',
    'scout',
    'harvest'
  ] as const;
  function seasonalKindLabel(k: unknown): string {
    const hit = SEASONAL_KINDS.find((x) => x === k);
    return hit ? tr(`pluginui.seasonalKind.${hit}`) : String(k);
  }
  const FORM_KEYS = {
    granular: 'plugins.new.formGranular',
    liquid: 'plugins.new.formLiquid',
    soluble: 'plugins.new.formSoluble',
    compost: 'plugins.new.formCompost',
    'slow-release': 'plugins.new.formSlow',
    meal: 'plugins.new.formMeal'
  } as const;
  function formLabel(form: unknown): string {
    const f = String(form);
    return f in FORM_KEYS ? tr(FORM_KEYS[f as keyof typeof FORM_KEYS]) : f;
  }
  function taskCategoryLabel(c: unknown): string {
    const hit = TASK_CATEGORY_VALUES.find((x) => x === c);
    return hit ? labelForTaskCategory(hit, page.data?.locale) : String(c);
  }

  let rollingBack = $state<string | null>(null);
  let rollbackError = $state<string | null>(null);
  let rollbackSuccess = $state<string | null>(null);

  // ─── Retire / Uninstall state ──────────────────────────────────
  let retireBusy = $state(false);
  let lifecycleError = $state<string | null>(null);
  let lifecycleSuccess = $state<string | null>(null);
  let uninstallConfirmOpen = $state(false);
  let uninstallConfirmInput = $state('');
  let uninstallRefs = $state<null | {
    sprayEvents: number;
    insecticideEvents: number;
    fungicideEvents: number;
    cropRows: number;
    total: number;
  }>(null);

  /** Is the current version row retired? */
  const isRetired = $derived.by(() => {
    const current = data.history.find((r) => !r.supersededAt);
    return !!current?.retiredAt;
  });

  async function lifecycleAction(action: 'retire' | 'unretire', global = false) {
    retireBusy = true;
    lifecycleError = null;
    lifecycleSuccess = null;
    try {
      const scope = global ? '?scope=global' : '';
      const res = await fetch(
        `/api/plugins/${encodeURIComponent(data.pluginId)}/${action}${scope}`,
        { method: 'POST' }
      );
      const out = await res.json();
      if (!res.ok) {
        lifecycleError = out.error ?? `HTTP ${res.status}`;
        return;
      }
      lifecycleSuccess =
        action === 'retire'
          ? global
            ? tr('plugins.detail.retiredAll')
            : tr('plugins.detail.retiredFarm')
          : tr('plugins.detail.restored');
      await invalidateAll();
    } catch (e) {
      lifecycleError = e instanceof Error ? e.message : String(e);
    } finally {
      retireBusy = false;
    }
  }

  async function uninstall() {
    if (uninstallConfirmInput !== data.pluginId) return;
    retireBusy = true;
    lifecycleError = null;
    lifecycleSuccess = null;
    uninstallRefs = null;
    try {
      const res = await fetch(`/api/plugins/${encodeURIComponent(data.pluginId)}/uninstall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: uninstallConfirmInput })
      });
      const out = await res.json();
      if (!res.ok) {
        if (out.code === 'still-referenced' && out.references) {
          uninstallRefs = out.references;
        }
        lifecycleError = out.error ?? `HTTP ${res.status}`;
        return;
      }
      lifecycleSuccess = tr('plugins.detail.uninstalled');
      setTimeout(() => goto('/plugins'), 700);
    } catch (e) {
      lifecycleError = e instanceof Error ? e.message : String(e);
    } finally {
      retireBusy = false;
    }
  }

  function openUninstallConfirm() {
    uninstallConfirmOpen = true;
    uninstallConfirmInput = '';
    lifecycleError = null;
    uninstallRefs = null;
  }
  function closeUninstallConfirm() {
    uninstallConfirmOpen = false;
    uninstallConfirmInput = '';
  }

  /** Plugin payload typed loosely so each per-kind block can reach in
   *  via discriminated narrowing. The server load returns a fully-typed
   *  Plugin; we cast through `Record<string, unknown>` here so the
   *  rendering blocks can `.field` without TypeScript complaining about
   *  every cross-kind field absence. */
  const plugin = $derived(data.live?.plugin as unknown as Record<string, unknown> | null);
  const kind = $derived(plugin?.type as string | undefined);

  const groupBadges = $derived.by(() => {
    if (!plugin) return [] as Array<{ kind: 'HRAC' | 'IRAC' | 'FRAC'; group: string }>;
    const out: Array<{ kind: 'HRAC' | 'IRAC' | 'FRAC'; group: string }> = [];
    const ais = (plugin.activeIngredients as Array<Record<string, unknown>> | undefined) ?? [];
    if (plugin.type === 'herbicide') {
      for (const ai of ais) {
        const g = hracGroupOf(ai.chemistryClass as Parameters<typeof hracGroupOf>[0]);
        if (g != null) out.push({ kind: 'HRAC', group: String(g) });
      }
    } else if (plugin.type === 'insecticide') {
      for (const ai of ais) {
        if (typeof ai.iracGroup === 'string') out.push({ kind: 'IRAC', group: ai.iracGroup });
      }
    } else if (plugin.type === 'fungicide') {
      for (const ai of ais) {
        if (typeof ai.fracCode === 'string') out.push({ kind: 'FRAC', group: ai.fracCode });
      }
    }
    const seen = new Set<string>();
    return out.filter((c) => {
      const k = `${c.kind}:${c.group}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  });

  async function rollback(version: string) {
    if (!confirm(tr('plugins.detail.rollbackConfirm', { id: data.pluginId, version }))) return;
    rollingBack = version;
    rollbackError = null;
    rollbackSuccess = null;
    try {
      const res = await fetch(`/api/plugins/${encodeURIComponent(data.pluginId)}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toVersion: version })
      });
      const out = await res.json();
      if (!res.ok) {
        rollbackError = out.error ?? `HTTP ${res.status}`;
        return;
      }
      rollbackSuccess = tr('plugins.detail.rolledBack', { version: out.version });
      await invalidateAll();
    } catch (e) {
      rollbackError = e instanceof Error ? e.message : String(e);
    } finally {
      rollingBack = null;
    }
  }

  function startEdit() {
    if (!data.live) return;
    const prefill = encodeURIComponent(JSON.stringify(data.live.plugin));
    goto(`/plugins/new?prefill=${prefill}`);
  }

  function asArray<T>(v: unknown): T[] {
    return Array.isArray(v) ? (v as T[]) : [];
  }
  function seasonalText(t: Record<string, unknown>, part: 'title' | 'body'): string {
    return seasonalRowText(
      asStr(plugin?.pluginId),
      asStr(t.key),
      part,
      asStr(t[part]) ?? '',
      page.data?.locale
    );
  }

  function asStr(v: unknown): string | undefined {
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  }
  function asNum(v: unknown): number | undefined {
    return typeof v === 'number' ? v : undefined;
  }
  function asBool(v: unknown): boolean | undefined {
    return typeof v === 'boolean' ? v : undefined;
  }
  function asObj(v: unknown): Record<string, unknown> | undefined {
    return v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : undefined;
  }

  function labelRate(rate: Record<string, unknown>): string {
    const amount = asNum(rate.amount);
    if (amount === undefined) return `${rate.amount} ${rate.unit}`;
    return formatRateText(amount, String(rate.unit), currentPrefs(), { labelUnit: true });
  }

  function rangeRate(range: Record<string, unknown>): string {
    const us = `${range.min}-${range.max} ${range.unit}`;
    const min = asNum(range.min);
    const max = asNum(range.max);
    if (min === undefined || max === undefined) return us;
    const unit = String(range.unit);
    const lo = formatRateText(min, unit, currentPrefs());
    if (lo === `${min} ${unit}`) return us;
    return `${lo} – ${formatRateText(max, unit, currentPrefs())}`;
  }

  function metricGpa(gpa: number | undefined): string {
    return gpa !== undefined && currentPrefs().units === 'metric'
      ? ` (${fmt.qty(gpa, 'volumePerArea')})`
      : '';
  }
</script>

<svelte:head>
  <title>{tr('plugins.detail.title', { id: data.pluginId })}</title>
</svelte:head>

<nav class="breadcrumbs">
  <a href="/plugins">{tr('plugins.detail.back')}</a>
</nav>

{#if data.live && plugin}
  <section class="card header-card">
    <div class="title-row">
      <h1>{cropDisplayName(data.pluginId, data.live.displayName, data.locale)}</h1>
      <span class="type-badge type-{data.live.type}">{typeLabel(data.live.type)}</span>
      {#each groupBadges as gb (gb.kind + gb.group)}
        <GroupCodeBadge kind={gb.kind} group={gb.group} />
      {/each}
      <span class="version">v{data.live.version}</span>
      {#if data.history.length > 1}
        <span class="history-chip"
          >{tr('plugins.list.versions', { count: data.history.length })}</span
        >
      {/if}
    </div>
    <div class="header-actions">
      {#if data.canEdit}
        <button class="action primary" onclick={startEdit} disabled={retireBusy}>
          {tr('plugins.detail.edit')}
        </button>
      {/if}
      <a
        class="action subtle"
        href="/api/plugins/{encodeURIComponent(data.pluginId)}/export"
        download
      >
        {tr('plugins.detail.download')}
      </a>
      {#if data.canEdit}
        <span class="action-divider" aria-hidden="true"></span>
        {#if data.hiddenForOwner}
          <button
            class="action warn"
            onclick={() => lifecycleAction('unretire')}
            disabled={retireBusy}
          >
            {tr('plugins.detail.unretireFarm')}
          </button>
        {:else}
          <button
            class="action warn"
            onclick={() => lifecycleAction('retire')}
            disabled={retireBusy}
          >
            {tr('plugins.detail.retireFarm')}
          </button>
        {/if}
      {/if}
      {#if data.isSuperadmin}
        <span class="action-divider" aria-hidden="true"></span>
        {#if isRetired}
          <button
            class="action warn"
            onclick={() => lifecycleAction('unretire', true)}
            disabled={retireBusy}
          >
            {tr('plugins.detail.unretireAll')}
          </button>
        {:else}
          <button
            class="action warn"
            onclick={() => lifecycleAction('retire', true)}
            disabled={retireBusy}
          >
            {tr('plugins.detail.retireAll')}
          </button>
        {/if}
        <button class="action danger" onclick={openUninstallConfirm} disabled={retireBusy}>
          {tr('plugins.detail.uninstall')}
        </button>
      {/if}
    </div>
    {#if data.hiddenForOwner}
      <p class="retired-banner">
        ⚠ {tr('plugins.detail.retiredFarmA')}<strong>{tr('plugins.detail.retiredFarmB')}</strong
        >{tr('plugins.detail.retiredFarmC')}
      </p>
    {:else if isRetired}
      <p class="retired-banner">
        ⚠ {tr('plugins.detail.retiredLibA')}<strong>{tr('plugins.detail.retiredLibB')}</strong>{tr(
          'plugins.detail.retiredLibC'
        )}
      </p>
    {/if}
    {#if data.farmOverride}
      <p class="retired-banner">
        {tr('plugins.detail.copyA')}<strong>{tr('plugins.detail.copyB')}</strong>{tr(
          'plugins.detail.copyC'
        )}
      </p>
    {/if}
  </section>
{:else}
  <section class="card">
    <h1>{data.pluginId}</h1>
    <p class="retired-notice">
      {tr('plugins.detail.noLive')}
    </p>
    {#if data.isSuperadmin && isRetired}
      <button
        class="action warn"
        onclick={() => lifecycleAction('unretire', true)}
        disabled={retireBusy}
      >
        {tr('plugins.detail.unretireAll')}
      </button>
    {/if}
  </section>
{/if}

{#if rollbackError}<p class="error">⛔ {rollbackError}</p>{/if}
{#if rollbackSuccess}<p class="success">✓ {rollbackSuccess}</p>{/if}
{#if lifecycleError}
  <p class="error">⛔ {lifecycleError}</p>
  {#if uninstallRefs}
    <div class="ref-summary">
      <strong>{tr('plugins.detail.referencedBy')}</strong>
      <ul>
        {#if uninstallRefs.sprayEvents}<li>
            {tr('plugins.detail.refSpray', { count: uninstallRefs.sprayEvents })}
          </li>{/if}
        {#if uninstallRefs.insecticideEvents}<li>
            {tr('plugins.detail.refInsecticide', { count: uninstallRefs.insecticideEvents })}
          </li>{/if}
        {#if uninstallRefs.fungicideEvents}<li>
            {tr('plugins.detail.refFungicide', { count: uninstallRefs.fungicideEvents })}
          </li>{/if}
        {#if uninstallRefs.cropRows}<li>
            {tr('plugins.detail.refCrop', { count: uninstallRefs.cropRows })}
          </li>{/if}
      </ul>
      <p class="muted">{tr('plugins.detail.retireInstead')}</p>
    </div>
  {/if}
{/if}
{#if lifecycleSuccess}<p class="success">✓ {lifecycleSuccess}</p>{/if}

{#if uninstallConfirmOpen}
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="uninstall-title"
    onclick={(e) => {
      if (e.target === e.currentTarget && !retireBusy) closeUninstallConfirm();
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape' && !retireBusy) closeUninstallConfirm();
    }}
    tabindex="-1"
  >
    <div class="modal">
      <h2 id="uninstall-title">{tr('plugins.detail.uninstallTitle', { id: data.pluginId })}</h2>
      <p>
        {tr('plugins.detail.uninstallBody')}
      </p>
      <label class="confirm-label">
        {tr('plugins.detail.typeA')}<code>{data.pluginId}</code>{tr('plugins.detail.typeB')}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          type="text"
          bind:value={uninstallConfirmInput}
          placeholder={data.pluginId}
          autocomplete="off"
          autofocus
        />
      </label>
      <div class="modal-actions">
        <button class="secondary" onclick={closeUninstallConfirm} disabled={retireBusy}
          >{tr('plugins.detail.cancel')}</button
        >
        <button
          class="danger"
          onclick={uninstall}
          disabled={retireBusy || uninstallConfirmInput !== data.pluginId}
        >
          {retireBusy ? tr('plugins.detail.uninstalling') : tr('plugins.detail.uninstallPerm')}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if plugin}
  <!-- ─── Per-kind KEY FACTS ─────────────────────────────────────── -->
  {#if kind === 'crop'}
    {@const dtm = asObj(plugin.daysToMaturity)}
    {@const planting = asObj(plugin.plantingGuide)}
    {@const curing = asObj(plugin.postHarvestCuring)}
    {@const agronomy = asObj(plugin.agronomy)}
    {@const indicators = asArray<string>(plugin.harvestIndicators)}
    {@const traits = asArray<string>(plugin.traits)}
    <section class="card">
      <h2>{tr('plugins.detail.keyFacts')}</h2>
      <dl class="grid-dl">
        <div class="stat">
          <dt>{tr('plugins.detail.family')}</dt>
          <dd>{familyLabel(plugin.cropFamily)}</dd>
        </div>
        {#if dtm}
          <div class="stat">
            <dt>{tr('plugins.detail.dtm')}</dt>
            <dd>{dtm.min}-{dtm.max} d</dd>
          </div>
        {/if}
        {#if asNum(plugin.defaultRowSpacingInches) !== undefined}
          <div class="stat">
            <dt>{tr('plugins.detail.rowSpacing')}</dt>
            <dd>{fmt.qty(asNum(plugin.defaultRowSpacingInches), 'length')}</dd>
          </div>
        {/if}
        {#if asNum(plugin.preHarvestIntervalDays) !== undefined}
          <div class="stat" lang="en" data-english-only="safety">
            <dt>Default PHI</dt>
            <dd>{plugin.preHarvestIntervalDays} d</dd>
          </div>
        {/if}
        {#if asStr(plugin.cornType)}
          <div class="stat">
            <dt>{tr('plugins.detail.cornType')}</dt>
            <dd>{plugin.cornType}</dd>
          </div>
        {/if}
        {#if agronomy?.lifecycle}
          <div class="stat">
            <dt>{tr('plugins.detail.lifecycle')}</dt>
            <dd>{agronomy.lifecycle}</dd>
          </div>
        {/if}
        {#if asNum(agronomy?.rotationLookbackYears) !== undefined}
          <div class="stat">
            <dt>{tr('plugins.detail.rotation')}</dt>
            <dd>
              {tr('plugins.detail.years', { count: agronomy?.rotationLookbackYears as number })}
            </dd>
          </div>
        {/if}
        {#if asNum(planting?.soilTempMinF) !== undefined}
          <div class="stat">
            <dt>{tr('plugins.detail.soilTemp')}</dt>
            <dd>{fmt.qty(asNum(planting?.soilTempMinF), 'temperature')}</dd>
          </div>
        {/if}
      </dl>
      {#if traits.length > 0}
        <div class="chip-row">
          <span class="row-label">{tr('plugins.detail.traits')}</span>
          {#each traits as t, idx (idx)}<span class="chip neutral">{t}</span>{/each}
        </div>
      {/if}
      {#if indicators.length > 0}
        <div class="bullet-list">
          <strong class="row-label">{tr('plugins.detail.harvestIndicators')}</strong>
          <ul>
            {#each indicators as ind, idx (idx)}<li>{ind}</li>{/each}
          </ul>
        </div>
      {/if}
      {#if curing}
        {@const curingWeeks = rangeText(curing.durationWeeks)}
        {@const curingMoisture = rangeText(curing.targetMoisturePercent)}
        <div class="bullet-list">
          <strong class="row-label">{tr('plugins.detail.curing')}</strong>
          <p class="muted">
            {(curing.method as string) ?? ''}
            {#if curingWeeks}· {tr('plugins.detail.curingWeeks', { value: curingWeeks })}{/if}
            {#if curingMoisture}· {tr('plugins.detail.curingMoisture', {
                value: curingMoisture
              })}{/if}
            {#if curing.storageLocation}· {tr('plugins.detail.curingStore', {
                value: String(curing.storageLocation)
              })}{/if}
          </p>
        </div>
      {/if}
      {#if asStr(plugin.notes)}
        <p class="notes">{plugin.notes}</p>
      {/if}
    </section>
  {/if}

  {#if kind === 'herbicide'}
    {@const ais = asArray<Record<string, unknown>>(plugin.activeIngredients)}
    {@const rate = asObj(plugin.ratePerAcre)}
    {@const labelClaims = asObj(plugin.labelClaims)}
    {@const safeFor = asArray<string>(labelClaims?.safeForCropPluginIds)}
    {@const traitGated = asArray<Record<string, unknown>>(plugin.traitGatedSafeFor)}
    {@const flags = asObj(plugin.complianceFlags)}
    <section class="card">
      <h2>{tr('plugins.detail.keyFacts')}</h2>
      <dl class="grid-dl">
        {#each ais as ai, i (i)}
          <div class="stat">
            <dt>{tr('plugins.detail.activeIngredient')} {ais.length > 1 ? i + 1 : ''}</dt>
            <dd>{ai.name} <span class="muted">({ai.chemistryClass})</span></dd>
          </div>
        {/each}
        {#if rate}
          <div class="stat">
            <dt>{tr('plugins.detail.rate')}</dt>
            <dd>
              {labelRate(rate)}
              {#if isFallbackRate(plugin)}<FallbackRateLine />{/if}
            </dd>
          </div>
        {/if}
        {#if asNum(plugin.gpaCalibration) !== undefined}
          <div class="stat">
            <dt>{tr('plugins.detail.gpa')}</dt>
            <dd>{plugin.gpaCalibration}{metricGpa(asNum(plugin.gpaCalibration))}</dd>
          </div>
        {/if}
        {#if asStr(plugin.applicationTiming)}
          <div class="stat">
            <dt>{tr('plugins.detail.timing')}</dt>
            <dd>{plugin.applicationTiming}</dd>
          </div>
        {/if}
        {#if asStr(plugin.epaRegistrationNumber)}
          <div class="stat">
            <dt>{tr('pluginui.detail.epaReg')}</dt>
            <dd>{plugin.epaRegistrationNumber}</dd>
          </div>
        {/if}
        <div class="stat">
          <dt>{tr('pluginui.detail.requiresAms')}</dt>
          <dd>{asBool(plugin.requiresAMS) ? tr('plugins.detail.yes') : tr('plugins.detail.no')}</dd>
        </div>
        <div class="stat" lang="en" data-english-only="safety">
          <dt>Decon required</dt>
          <dd>{asBool(plugin.deconRequired) ? 'Yes' : 'No'}</dd>
        </div>
      </dl>
      {#if safeFor.length > 0}
        <div class="chip-row" lang="en" data-english-only="safety">
          <span class="row-label">Label-safe crops</span>
          {#each safeFor as id, idx (idx)}<PluginRef
              pluginId={id}
              lookup={data.pluginLookup}
            />{/each}
        </div>
      {/if}
      {#if traitGated.length > 0}
        <div class="bullet-list" lang="en" data-english-only="safety">
          <strong class="row-label">Trait-gated safety</strong>
          <ul>
            {#each traitGated as tg, idx (idx)}
              <li>
                <PluginRef pluginId={tg.cropPluginId as string} lookup={data.pluginLookup} />
                requires
                {#each asArray<string>(tg.requiresTraits) as t, i (i)}
                  <span class="chip neutral">{t}</span>
                {/each}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
      {#if flags}
        <div class="chip-row">
          <span class="row-label">{tr('plugins.detail.compliance')}</span>
          {#if flags.omriListed}<span class="chip ok">{tr('pluginui.detail.omri')}</span>{/if}
          {#if flags.nonGmoCompliant}<span class="chip ok">{tr('plugins.detail.nonGmo')}</span>{/if}
          {#if flags.transitioningAllowed}<span class="chip ok"
              >{tr('plugins.detail.transition')}</span
            >{/if}
          {#if flags.certifiedOrganicAllowed === false}<span class="chip neg"
              >{tr('plugins.detail.notOrganic')}</span
            >{/if}
        </div>
      {/if}
      {#if asStr(plugin.notes)}<p class="notes">{plugin.notes}</p>{/if}
    </section>
  {/if}

  {#if kind === 'insecticide'}
    {@const ais = asArray<Record<string, unknown>>(plugin.activeIngredients)}
    {@const rate = asObj(plugin.ratePerAcre)}
    {@const pests = asArray<string>(plugin.targetPests)}
    {@const thresholds = asArray<Record<string, unknown>>(plugin.scoutingThresholds)}
    {@const labelClaims = asObj(plugin.labelClaims)}
    {@const safeFor = asArray<string>(labelClaims?.safeForCropPluginIds)}
    {@const flags = asObj(plugin.complianceFlags)}
    <section class="card">
      <h2>{tr('plugins.detail.keyFacts')}</h2>
      <dl class="grid-dl">
        {#each ais as ai, i (i)}
          <div class="stat">
            <dt>{tr('plugins.detail.activeIngredient')} {ais.length > 1 ? i + 1 : ''}</dt>
            <dd>
              {ai.name}{#if ai.iracGroup}<span class="muted"> (IRAC {ai.iracGroup})</span>{/if}
            </dd>
          </div>
        {/each}
        {#if rate}
          <div class="stat">
            <dt>{tr('plugins.detail.rate')}</dt>
            <dd>{labelRate(rate)}</dd>
          </div>
        {/if}
        {#if asNum(plugin.reEntryIntervalHours) !== undefined}
          <div class="stat">
            <dt>REI</dt>
            <dd>{plugin.reEntryIntervalHours} h</dd>
          </div>
        {/if}
        {#if asNum(plugin.preHarvestIntervalDays) !== undefined}
          <div class="stat">
            <dt>PHI</dt>
            <dd>{plugin.preHarvestIntervalDays} d</dd>
          </div>
        {/if}
        {#if asStr(plugin.pollinatorRisk)}
          <div class="stat" lang="en" data-english-only="safety">
            <dt>Pollinator risk</dt>
            <dd>{plugin.pollinatorRisk}</dd>
          </div>
        {/if}
        {#if asStr(plugin.epaRegistrationNumber)}
          <div class="stat">
            <dt>{tr('pluginui.detail.epaReg')}</dt>
            <dd>{plugin.epaRegistrationNumber}</dd>
          </div>
        {/if}
      </dl>
      {#if pests.length > 0}
        <div class="chip-row">
          <span class="row-label">{tr('plugins.detail.targetPests')}</span>
          {#each pests as p, idx (idx)}<span class="chip neutral">{p}</span>{/each}
        </div>
      {/if}
      {#if safeFor.length > 0}
        <div class="chip-row" lang="en" data-english-only="safety">
          <span class="row-label">Label-safe crops</span>
          {#each safeFor as id, idx (idx)}<PluginRef
              pluginId={id}
              lookup={data.pluginLookup}
            />{/each}
        </div>
      {/if}
      {#if thresholds.length > 0}
        <div class="bullet-list">
          <strong class="row-label">{tr('pluginui.detail.scoutThresholds')}</strong>
          <ul>
            {#each thresholds as t, idx (idx)}
              <li lang="en" data-english-only="safety">
                <strong>{t.pest}</strong>: spray at {t.threshold}
                {t.metric}
                {#if t.warnAt}· warn at {t.warnAt}{/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
      {#if flags}
        <div class="chip-row">
          <span class="row-label">{tr('plugins.detail.compliance')}</span>
          {#if flags.omriListed}<span class="chip ok">{tr('pluginui.detail.omri')}</span>{/if}
          {#if flags.nonGmoCompliant}<span class="chip ok">{tr('plugins.detail.nonGmo')}</span>{/if}
          {#if flags.transitioningAllowed}<span class="chip ok"
              >{tr('plugins.detail.transition')}</span
            >{/if}
          {#if flags.certifiedOrganicAllowed === false}<span class="chip neg"
              >{tr('plugins.detail.notOrganic')}</span
            >{/if}
        </div>
      {/if}
      {#if asStr(plugin.notes)}<p class="notes">{plugin.notes}</p>{/if}
    </section>
  {/if}

  {#if kind === 'fungicide'}
    {@const ais = asArray<Record<string, unknown>>(plugin.activeIngredients)}
    {@const rate = asObj(plugin.ratePerAcre)}
    {@const diseases = asArray<string>(plugin.targetDiseases)}
    {@const labelClaims = asObj(plugin.labelClaims)}
    {@const safeFor = asArray<string>(labelClaims?.safeForCropPluginIds)}
    {@const flags = asObj(plugin.complianceFlags)}
    <section class="card">
      <h2>{tr('plugins.detail.keyFacts')}</h2>
      <dl class="grid-dl">
        {#each ais as ai, i (i)}
          <div class="stat">
            <dt>{tr('plugins.detail.activeIngredient')} {ais.length > 1 ? i + 1 : ''}</dt>
            <dd>
              {ai.name}{#if ai.fracCode}<span class="muted"> (FRAC {ai.fracCode})</span>{/if}
            </dd>
          </div>
        {/each}
        {#if rate}
          <div class="stat">
            <dt>{tr('plugins.detail.rate')}</dt>
            <dd>{labelRate(rate)}</dd>
          </div>
        {/if}
        {#if asNum(plugin.gpaCalibration) !== undefined}
          <div class="stat">
            <dt>{tr('plugins.detail.gpa')}</dt>
            <dd>{plugin.gpaCalibration}{metricGpa(asNum(plugin.gpaCalibration))}</dd>
          </div>
        {/if}
        {#if asNum(plugin.reEntryIntervalHours) !== undefined}
          <div class="stat">
            <dt>REI</dt>
            <dd>{plugin.reEntryIntervalHours} h</dd>
          </div>
        {/if}
        {#if asNum(plugin.preHarvestIntervalDays) !== undefined}
          <div class="stat">
            <dt>PHI</dt>
            <dd>{plugin.preHarvestIntervalDays} d</dd>
          </div>
        {/if}
        {#if asStr(plugin.applicationTiming)}
          <div class="stat">
            <dt>{tr('plugins.detail.timing')}</dt>
            <dd>{plugin.applicationTiming}</dd>
          </div>
        {/if}
        {#if asStr(plugin.pollinatorRisk)}
          <div class="stat" lang="en" data-english-only="safety">
            <dt>Pollinator risk</dt>
            <dd>{plugin.pollinatorRisk}</dd>
          </div>
        {/if}
        <div class="stat" lang="en" data-english-only="safety">
          <dt>Decon required</dt>
          <dd>{asBool(plugin.deconRequired) ? 'Yes' : 'No'}</dd>
        </div>
      </dl>
      {#if diseases.length > 0}
        <div class="chip-row">
          <span class="row-label">{tr('plugins.detail.targetDiseases')}</span>
          {#each diseases as d, idx (idx)}<span class="chip neutral">{d}</span>{/each}
        </div>
      {/if}
      {#if safeFor.length > 0}
        <div class="chip-row" lang="en" data-english-only="safety">
          <span class="row-label">Label-safe crops</span>
          {#each safeFor as id, idx (idx)}<PluginRef
              pluginId={id}
              lookup={data.pluginLookup}
            />{/each}
        </div>
      {/if}
      {#if flags}
        <div class="chip-row">
          <span class="row-label">{tr('plugins.detail.compliance')}</span>
          {#if flags.omriListed}<span class="chip ok">{tr('pluginui.detail.omri')}</span>{/if}
          {#if flags.transitioningAllowed}<span class="chip ok"
              >{tr('plugins.detail.transition')}</span
            >{/if}
        </div>
      {/if}
      {#if asStr(plugin.notes)}<p class="notes">{plugin.notes}</p>{/if}
    </section>
  {/if}

  {#if kind === 'fertilizer'}
    {@const analysis = asObj(plugin.analysis)}
    {@const range = asObj(plugin.applicationRange)}
    {@const secondary = asObj(plugin.secondaryNutrients)}
    {@const flags = asObj(plugin.complianceFlags)}
    <section class="card">
      <h2>{tr('plugins.detail.keyFacts')}</h2>
      <dl class="grid-dl">
        {#if analysis}
          <div class="stat">
            <dt>{tr('plugins.detail.npk')}</dt>
            <dd>{analysis.n}-{analysis.p}-{analysis.k}</dd>
          </div>
        {/if}
        {#if asStr(plugin.form)}
          <div class="stat">
            <dt>{tr('plugins.detail.form')}</dt>
            <dd>{formLabel(plugin.form)}</dd>
          </div>
        {/if}
        <div class="stat">
          <dt>{tr('plugins.detail.organic')}</dt>
          <dd>{asBool(plugin.organic) ? tr('plugins.detail.yes') : tr('plugins.detail.no')}</dd>
        </div>
        {#if range}
          <div class="stat">
            <dt>{tr('plugins.detail.appRange')}</dt>
            <dd>{rangeRate(range)}</dd>
          </div>
        {/if}
      </dl>
      {#if secondary}
        <div class="chip-row">
          <span class="row-label">{tr('plugins.detail.secondary')}</span>
          {#each Object.entries(secondary) as [k, v] (k)}
            <span class="chip neutral">{k.toUpperCase()} {v}%</span>
          {/each}
        </div>
      {/if}
      {#if flags}
        <div class="chip-row">
          <span class="row-label">{tr('plugins.detail.compliance')}</span>
          {#if flags.omriListed}<span class="chip ok">{tr('pluginui.detail.omri')}</span>{/if}
          {#if flags.transitioningAllowed}<span class="chip ok"
              >{tr('plugins.detail.transition')}</span
            >{/if}
          {#if flags.certifiedOrganicAllowed === false}<span class="chip neg"
              >{tr('plugins.detail.notOrganic')}</span
            >{/if}
        </div>
      {/if}
      {#if asStr(plugin.notes)}<p class="notes">{plugin.notes}</p>{/if}
    </section>
  {/if}

  {#if kind === 'companion'}
    {@const goodWith = asArray<string>(plugin.goodWith)}
    {@const badWith = asArray<string>(plugin.badWith)}
    {@const keepApart = asArray<Record<string, unknown>>(plugin.keepApart)}
    {@const members = asArray<Record<string, unknown>>(plugin.members)}
    <section class="card">
      <h2>{tr('plugins.detail.keyFacts')}</h2>
      <dl class="grid-dl">
        {#if asStr(plugin.primaryFamily)}
          <div class="stat">
            <dt>{tr('plugins.detail.anchorFamily')}</dt>
            <dd>{familyLabel(plugin.primaryFamily)}</dd>
          </div>
        {/if}
        {#if members.length > 0}
          <div class="stat">
            <dt>{tr('plugins.detail.members')}</dt>
            <dd>{members.length}</dd>
          </div>
        {/if}
      </dl>
      {#if asStr(plugin.benefit)}
        <p class="notes">
          <strong class="row-label">{tr('plugins.detail.benefit')}</strong>
          {plugin.benefit}
        </p>
      {/if}
      {#if members.length > 0}
        <div class="bullet-list">
          <strong class="row-label">{tr('plugins.detail.members')}</strong>
          <ul>
            {#each members as m, idx (idx)}
              <li>
                <strong>{m.role}</strong>
                <span class="muted">({familyLabel(m.family)})</span>
                {#if m.plantingOffsetDays != null}
                  {#if (m.plantingOffsetDays as number) < 0}
                    · {tr('plugins.detail.plantBefore', {
                      days: Math.abs(m.plantingOffsetDays as number)
                    })}
                  {:else if (m.plantingOffsetDays as number) === 0}
                    · {tr('plugins.detail.plantSame')}
                  {:else}
                    · {tr('plugins.detail.plantAfter', { days: m.plantingOffsetDays as number })}
                  {/if}
                {/if}
                {#if asStr(m.title)}— {m.title}{/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
      {#if goodWith.length > 0}
        <div class="chip-row">
          <span class="row-label">{tr('plugins.detail.goodWith')}</span>
          {#each goodWith as id, idx (idx)}<PluginRef
              pluginId={id}
              lookup={data.pluginLookup}
            />{/each}
        </div>
      {/if}
      {#if badWith.length > 0}
        <div class="chip-row">
          <span class="row-label">{tr('plugins.detail.badWith')}</span>
          {#each badWith as id, idx (idx)}<PluginRef
              pluginId={id}
              lookup={data.pluginLookup}
            />{/each}
        </div>
      {/if}
      {#each keepApart as k, kIdx (kIdx)}
        <div class="bullet-list">
          <strong class="row-label">{tr('plugins.detail.keepApart')}</strong>
          {#if asStr(k.reason)}<p class="notes">{k.reason}</p>{/if}
          <div class="chip-row">
            {#each asArray<string>(k.a) as id, idx (idx)}<PluginRef
                pluginId={id}
                lookup={data.pluginLookup}
              />{/each}
          </div>
          <div class="chip-row">
            <span class="row-label">{tr('plugins.detail.awayFrom')}</span>
            {#each asArray<string>(k.b) as id, idx (idx)}<PluginRef
                pluginId={id}
                lookup={data.pluginLookup}
              />{/each}
          </div>
          {#if asStr(k.source)}<p class="muted">
              {tr('plugins.list.source', { source: String(k.source) })}
            </p>{/if}
        </div>
      {/each}
    </section>
  {/if}

  <!-- ─── Tasks (crops only) ─────────────────────────────────────── -->
  {#if kind === 'crop'}
    {@const preTasks = asArray<Record<string, unknown>>(plugin.preTasks)}
    {@const postTasks = asArray<Record<string, unknown>>(plugin.postTasks)}
    {@const seasonalTasks = asArray<Record<string, unknown>>(plugin.seasonalTasks)}
    {#if preTasks.length || postTasks.length || seasonalTasks.length}
      <section class="card">
        <h2>{tr('plugins.detail.tasks')}</h2>
        {#if preTasks.length > 0}
          <div class="task-group">
            <h3>{tr('plugins.detail.preTasks', { count: preTasks.length })}</h3>
            <ul class="task-list">
              {#each preTasks as t, idx (idx)}
                <li>
                  {#if t.category}<span class="task-cat">{taskCategoryLabel(t.category)}</span>{/if}
                  <strong>{t.title}</strong>
                  {#if t.daysBeforePlant != null}<span class="muted"
                      >· {tr('plugins.detail.beforePlant', {
                        days: t.daysBeforePlant as number
                      })}</span
                    >{/if}
                  {#if t.daysBeforeFirstHarvest != null}<span class="muted"
                      >· {tr('plugins.detail.beforeFirstHarvest', {
                        days: t.daysBeforeFirstHarvest as number
                      })}</span
                    >{/if}
                  {#if asStr(t.body)}<p class="body">{t.body}</p>{/if}
                </li>
              {/each}
            </ul>
          </div>
        {/if}
        {#if postTasks.length > 0}
          <div class="task-group">
            <h3>{tr('plugins.detail.postTasks', { count: postTasks.length })}</h3>
            <ul class="task-list">
              {#each postTasks as t, idx (idx)}
                <li>
                  {#if t.category}<span class="task-cat">{taskCategoryLabel(t.category)}</span>{/if}
                  <strong>{t.title}</strong>
                  {#if t.daysAfterPlant != null}<span class="muted"
                      >· {tr('plugins.detail.afterPlant', {
                        days: t.daysAfterPlant as number
                      })}</span
                    >{/if}
                  {#if t.daysAfterHarvest != null}<span class="muted"
                      >· {tr('plugins.detail.afterHarvest', {
                        days: t.daysAfterHarvest as number
                      })}</span
                    >{/if}
                  {#if asStr(t.body)}<p class="body">{t.body}</p>{/if}
                </li>
              {/each}
            </ul>
          </div>
        {/if}
        {#if seasonalTasks.length > 0}
          <div class="task-group">
            <h3>{tr('plugins.detail.seasonalTasks', { count: seasonalTasks.length })}</h3>
            <ul class="task-list">
              {#each seasonalTasks as t, idx (idx)}
                <li>
                  {#if t.category}<span class="task-cat">{taskCategoryLabel(t.category)}</span>{/if}
                  <strong>{seasonalText(t, 'title')}</strong>
                  {#if t.kind}<span class="muted">· {seasonalKindLabel(t.kind)}</span>{/if}
                  {#if t.dayOfYear != null}<span class="muted"
                      >· {tr('plugins.detail.dayOfYear', { day: t.dayOfYear as number })}</span
                    >{/if}
                  {#if t.daysAfterPlanting != null}<span class="muted"
                      >· {tr('plugins.detail.afterPlanting', {
                        days: t.daysAfterPlanting as number
                      })}</span
                    >{/if}
                  {#if t.windowDays != null}<span class="muted"
                      >· {tr('plugins.detail.window', { days: t.windowDays as number })}</span
                    >{/if}
                  {#if asStr(t.body)}<p class="body">{seasonalText(t, 'body')}</p>{/if}
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </section>
    {/if}
  {/if}

  <!-- ─── Spray windows (crops only) ─────────────────────────────── -->
  {#if kind === 'crop'}
    {@const sprayWindows = asArray<Record<string, unknown>>(plugin.sprayWindows)}
    {#if sprayWindows.length > 0}
      <details class="card">
        <summary>{tr('pluginui.detail.sprayWindows', { count: sprayWindows.length })}</summary>
        <ul class="task-list">
          {#each sprayWindows as sw, idx (idx)}
            <li>
              <strong>{sw.title}</strong>
              <span class="muted">· {sw.chemistryClass}</span>
              {#if sw.purpose}<span class="chip neutral small">{sw.purpose}</span>{/if}
              <div class="muted">
                {tr('pluginui.detail.windowDays', {
                  min: String(sw.offsetDaysMin),
                  max: String(sw.offsetDaysMax),
                  anchor: String(sw.anchor)
                })}{#if sw.stageCode}
                  {tr('pluginui.detail.windowStage', { stage: String(sw.stageCode) })}{/if}
              </div>
              {#if asStr(sw.body)}<p class="body">{sw.body}</p>{/if}
            </li>
          {/each}
        </ul>
      </details>
    {/if}
  {/if}

  <details class="card">
    <summary>{tr('plugins.detail.rawJson')}</summary>
    <pre>{JSON.stringify(plugin, null, 2)}</pre>
  </details>
{/if}

<section class="card">
  <h2>{tr('plugins.detail.history')}</h2>
  {#if data.history.length === 0}
    <p class="empty">
      {tr('plugins.detail.noHistory')}
    </p>
  {:else}
    <PluginVersionTimeline
      rows={data.history}
      canRollback={data.isSuperadmin}
      onRollback={rollingBack ? undefined : rollback}
    />
  {/if}
</section>

<style>
  .breadcrumbs {
    margin-bottom: 0.5rem;
  }
  .breadcrumbs a {
    color: #1f5e3a;
    text-decoration: none;
    font-size: 0.9rem;
  }
  .breadcrumbs a:hover {
    text-decoration: underline;
  }
  .header-card {
    padding-bottom: 0.85rem;
  }
  .title-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: 0.6rem;
  }
  h1 {
    margin: 0;
    font-size: 1.35rem;
    color: #1a2e1a;
  }
  .type-badge {
    padding: 0.1rem 0.45rem;
    border-radius: 3px;
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    color: white;
    letter-spacing: 0.5px;
  }
  .type-crop {
    background: #1f5e3a;
  }
  .type-herbicide {
    background: #b00020;
  }
  .type-insecticide {
    background: #b35900;
  }
  .type-fungicide {
    background: #4a2c83;
  }
  .type-fertilizer {
    background: #1c5fa6;
  }
  .type-companion {
    background: #6b3fa0;
  }
  .version {
    color: #888;
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
  }
  .history-chip {
    font-size: 0.7rem;
    color: #8a5a00;
    background: #fff4d8;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
  }
  .header-actions {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.85rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .action {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.35rem 0.75rem;
    border-radius: 5px;
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    color: #1f5e3a;
    background: transparent;
    border: 1px solid transparent;
    text-decoration: none;
    cursor: pointer;
    min-height: 32px;
    line-height: 1.2;
    transition: background-color 0.1s ease;
  }
  .action.primary {
    background: #1f5e3a;
    color: white;
  }
  .action.primary:hover:not(:disabled) {
    background: #174d2f;
  }
  .action.subtle:hover {
    background: #e7f1ea;
  }
  .action.warn {
    color: #8a5a00;
  }
  .action.warn:hover:not(:disabled) {
    background: #fff4d8;
  }
  .action.danger {
    color: #b00020;
  }
  .action.danger:hover:not(:disabled) {
    background: #fce8e8;
  }
  .action:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .action-divider {
    display: inline-block;
    width: 1px;
    height: 20px;
    background: #d8e0db;
    margin: 0 0.3rem;
    vertical-align: middle;
  }
  .retired-banner {
    margin: 0.75rem 0 0;
    background: #fff4d8;
    color: #8a5a00;
    border-left: 4px solid #d4a017;
    padding: 0.55rem 0.75rem;
    border-radius: 4px;
    font-size: 0.88rem;
  }
  .ref-summary {
    background: #fce8e8;
    color: #b00020;
    padding: 0.55rem 0.85rem;
    border-radius: 4px;
    border-left: 4px solid #b00020;
    margin-top: 0.4rem;
  }
  .ref-summary ul {
    margin: 0.25rem 0;
    padding-left: 1.2rem;
  }
  .ref-summary .muted {
    color: #555;
    font-style: italic;
  }
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    padding: 1rem;
  }
  .modal {
    background: white;
    border-radius: 8px;
    padding: 1.25rem;
    max-width: 480px;
    width: 100%;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  }
  .modal h2 {
    margin: 0 0 0.75rem;
    font-size: 1.05rem;
    color: #b00020;
  }
  .modal p {
    font-size: 0.9rem;
    color: #444;
    margin: 0 0 0.75rem;
  }
  .confirm-label {
    display: block;
    font-size: 0.85rem;
    color: #555;
    margin-bottom: 1rem;
  }
  .confirm-label code {
    background: #f5f5f5;
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
    font-size: 0.85rem;
  }
  .confirm-label input {
    display: block;
    width: 100%;
    box-sizing: border-box;
    margin-top: 0.4rem;
    padding: 0.5rem 0.65rem;
    border: 2px solid #d0d7d0;
    border-radius: 4px;
    font: inherit;
    font-family: ui-monospace, monospace;
    font-size: 0.9rem;
  }
  .modal-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
  }
  .modal .secondary {
    background: white;
    border: 2px solid #d0d7d0;
    color: #444;
    padding: 0.5rem 1rem;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    font-weight: 600;
  }
  .modal .danger {
    background: #b00020;
    color: white;
    border: 0;
    padding: 0.5rem 1rem;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    font-weight: 600;
  }
  .modal .danger:disabled {
    background: #aaa;
    cursor: not-allowed;
  }
  .card {
    background: white;
    border-radius: 8px;
    padding: 1rem 1.25rem;
    margin-top: 1rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  .card h2 {
    margin: 0 0 0.75rem;
    font-size: 0.95rem;
    color: #1f5e3a;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  details.card summary {
    cursor: pointer;
    color: #1f5e3a;
    font-weight: 600;
    font-size: 0.95rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    list-style: revert;
  }
  details.card[open] summary {
    margin-bottom: 0.75rem;
  }
  details.card pre {
    background: #fafafa;
    border: 1px solid #d0d7d0;
    padding: 0.75rem;
    border-radius: 4px;
    font-size: 0.78rem;
    overflow-x: auto;
    margin: 0;
  }
  .grid-dl {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 0.5rem 1rem;
    margin: 0;
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: 0.35rem 0;
  }
  .stat dt {
    font-size: 0.7rem;
    color: #777;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    font-weight: 600;
  }
  .stat dd {
    margin: 0;
    font-size: 0.9rem;
    color: #1a2e1a;
  }
  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    align-items: center;
    margin-top: 0.75rem;
  }
  .row-label {
    font-size: 0.7rem;
    color: #777;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    font-weight: 700;
    margin-right: 0.4rem;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    border-radius: 10px;
    padding: 0.05rem 0.45rem;
    font-size: 0.78rem;
    line-height: 1.5;
    border: 1px solid transparent;
    white-space: nowrap;
  }
  .chip.small {
    font-size: 0.7rem;
    padding: 0 0.35rem;
  }
  .chip.neutral {
    background: #eef2f0;
    color: #444;
    border-color: #d8e0db;
  }
  .chip.ok {
    background: #e7f1ea;
    color: #1f5e3a;
    border-color: #b3d4bf;
  }
  .chip.neg {
    background: #fce8e8;
    color: #b00020;
    border-color: #e8b3b9;
  }
  .bullet-list {
    margin-top: 0.85rem;
  }
  .bullet-list ul {
    margin: 0.35rem 0 0;
    padding-left: 1.2rem;
    font-size: 0.88rem;
    color: #333;
  }
  .bullet-list li {
    margin-bottom: 0.2rem;
  }
  .notes {
    margin-top: 0.75rem;
    color: #444;
    font-size: 0.88rem;
    line-height: 1.5;
  }
  .task-group {
    margin-bottom: 0.75rem;
  }
  .task-group h3 {
    margin: 0 0 0.4rem;
    font-size: 0.85rem;
    color: #1f5e3a;
    font-weight: 700;
  }
  .task-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .task-list li {
    padding: 0.4rem 0;
    border-top: 1px solid #eef0ee;
    font-size: 0.88rem;
    color: #333;
  }
  .task-list li:first-child {
    border-top: 0;
  }
  .task-cat {
    background: #1f5e3a;
    color: white;
    padding: 0 0.35rem;
    border-radius: 3px;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    margin-right: 0.35rem;
  }
  .body {
    margin: 0.2rem 0 0;
    color: #555;
    font-size: 0.85rem;
  }
  .muted {
    color: #777;
    font-size: 0.85rem;
  }
  .retired-notice {
    color: #b00020;
    margin: 0.5rem 0 0;
  }
  .empty {
    color: #777;
    font-style: italic;
  }
  .error {
    background: #fce8e8;
    color: #b00020;
    padding: 0.5rem 0.75rem;
    border-radius: 4px;
    border-left: 4px solid #b00020;
  }
  .success {
    background: #e8f5e8;
    color: #1f5e3a;
    padding: 0.5rem 0.75rem;
    border-radius: 4px;
    border-left: 4px solid #1f5e3a;
  }
</style>
