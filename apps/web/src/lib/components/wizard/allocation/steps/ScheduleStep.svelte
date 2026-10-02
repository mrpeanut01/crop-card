<script lang="ts">
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import ProvenanceLegend from '$lib/components/ui/ProvenanceLegend.svelte';
  import AiProgress from '../AiProgress.svelte';
  import ChatPanel from '../ChatPanel.svelte';
  import { fmtDateMs } from '../format';
  import { getWizardContext } from '../wizardState.svelte';
  import SeedOrSeedling from '$lib/components/plan/SeedOrSeedling.svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import { pageCropName } from '$lib/i18n/pageCropName';

  const w = getWizardContext();
  const tr = $derived(createT(page.data?.locale));
  const aiEnabled = $derived(w.props.aiEnabled);

  const scheduledCrops = $derived.by(() => {
    const seen = new Map<string, string>();
    for (const p of w.scheduleResponse?.scheduled ?? []) {
      if (!seen.has(p.cropPluginId)) seen.set(p.cropPluginId, p.varietyDisplayName);
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  });

  $effect(() => {
    for (const c of scheduledCrops) {
      if (!w.establishmentByCrop[c.id]) {
        w.establishmentByCrop[c.id] = { establishment: null, startIndoors: true, sowIndoorsOn: '' };
      }
    }
  });
</script>

{#if w.response}
  <!-- Phase 25 v2-addendum (#82 partial) — AI-on/off legend strip
       at the top of the schedule step. Per the addendum spec,
       AI on/off is a real product mode, not an error state —
       the operator sees the provenance map for the dates they're
       about to commit. -->
  <ProvenanceLegend
    shown={aiEnabled
      ? ['plugin', 'data', 'ai', 'manual']
      : ['plugin', 'data', 'fallback', 'manual']}
    note={aiEnabled ? tr('wizard.schedule.noteAi') : tr('wizard.schedule.noteOff')}
  />
  {#if w.scheduleLoading}
    <AiProgress stage="schedule" startMs={w.scheduleStartMs} />
  {:else if w.scheduleError}
    <p class="aw-error">{tr('wizard.schedule.error', { error: w.scheduleError })}</p>
    <button class="btn-secondary" onclick={() => w.advanceToSchedule()}
      >{tr('wizard.schedule.retry')}</button
    >
  {:else if w.scheduleResponse}
    {#if w.scheduleResponse.meta.fallback}
      <div class="aw-banner info" role="alert" aria-live="assertive">
        {w.scheduleResponse.meta.fallback === 'no-api-key'
          ? tr('wizard.schedule.noKey')
          : tr('wizard.schedule.aiHelp')}
      </div>
    {/if}
    <p class="aw-rationale">
      {w.scheduleResponse.rationale}
      <Provenance
        source={w.scheduleResponse.meta.fallback ? 'fallback' : aiEnabled ? 'ai' : 'plugin'}
        detail={w.scheduleResponse.meta.fallback ? tr('wizard.schedule.fallbackDetail') : undefined}
        compact
      />
    </p>
    <table class="aw-table">
      <thead>
        <tr>
          <th>{tr('wizard.schedule.thSeed')}</th>
          <th>{tr('wizard.schedule.thBlock')}</th>
          <th>{tr('wizard.schedule.thDate')}</th>
          <th>{tr('wizard.schedule.thPlants')}</th>
          <th>{tr('wizard.schedule.thWhy')}</th>
        </tr>
      </thead>
      <tbody>
        {#each w.scheduleResponse.scheduled as p, i (i)}
          <tr>
            <td>
              {pageCropName(p.cropPluginId, p.varietyDisplayName)}
              {#if p.successionIndex}
                <span class="chip chip-succession" title={tr('wizard.schedule.succession')}>
                  {p.successionIndex.i}/{p.successionIndex.n}
                </span>
              {/if}
            </td>
            <td>{w.blockNameFor(p.blockId)}</td>
            <td>{fmtDateMs(p.plantingDateMs)}</td>
            <td>{p.plants.toLocaleString()}</td>
            <td class="why">{p.rationale}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if w.scheduleResponse.advisories.length > 0}
      <section class="aw-banner info">
        <strong>{tr('wizard.schedule.notes')}</strong>
        <ul>
          {#each w.scheduleResponse.advisories as a, idx (idx)}<li>{a}</li>{/each}
        </ul>
      </section>
    {/if}
    {#if scheduledCrops.length}
      <section class="aw-sos" aria-labelledby="aw-sos-title" data-testid="wizard-seed-or-seedling">
        <h3 id="aw-sos-title">{tr('wizard.schedule.sosTitle')}</h3>
        <p class="aw-sos-lede">
          {tr('wizard.schedule.sosLede')}
        </p>
        {#each scheduledCrops as c (c.id)}
          {#if w.establishmentByCrop[c.id]}
            <div class="aw-sos-row">
              <strong>{pageCropName(c.id, c.name)}</strong>
              <SeedOrSeedling
                plugin={{ plantingGuide: w.props.plantingGuides[c.id] }}
                dated={true}
                idPrefix="aw-{c.id}"
                compact
                bind:establishment={w.establishmentByCrop[c.id].establishment}
                bind:startIndoors={w.establishmentByCrop[c.id].startIndoors}
                bind:sowIndoorsOn={w.establishmentByCrop[c.id].sowIndoorsOn}
              />
            </div>
          {/if}
        {/each}
      </section>
    {/if}
    <ChatPanel />
  {/if}
{/if}

<style>
  .aw-sos {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin: 0.75rem 0;
  }
  .aw-sos h3 {
    margin: 0;
    color: var(--color-forest);
  }
  .aw-sos-lede {
    margin: 0;
    font-size: 0.92rem;
    color: #4a5d4a;
  }
  .aw-sos-row {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.6rem 0;
    border-top: 1px solid #e4e9e4;
    min-width: 0;
  }
  .aw-table {
    width: 100%;
    border-collapse: collapse;
  }
  .aw-table th,
  .aw-table td {
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid #e4e9e4;
    text-align: left;
    vertical-align: middle;
  }
  .aw-table th {
    background: #f8fbf9;
    color: var(--color-forest);
    font-weight: 700;
    font-size: 0.9rem;
  }
  .aw-rationale {
    background: #f3f9f4;
    border-left: 3px solid var(--color-forest);
    padding: 0.75rem 1rem;
    margin: 0 0 0.75rem;
    color: var(--color-forest);
    font-size: 0.95rem;
  }
  .aw-banner.info {
    background: #eaf3fb;
    border-left: 3px solid #2e6dbf;
    padding: 0.5rem 0.75rem;
    margin-bottom: 0.75rem;
    color: #1f4a85;
    font-size: 0.92rem;
  }
  .chip-succession {
    background: #e6efff;
    color: #1f4a85;
    margin-left: 0.3rem;
    font-weight: 600;
  }
  .aw-error {
    color: #b22222;
    font-weight: 600;
  }
  .chip {
    display: inline-block;
    padding: 0.15rem 0.55rem;
    border-radius: 999px;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .why {
    color: #4a5d4a;
    font-size: 0.9rem;
    max-width: 22rem;
  }
  .btn-secondary {
    min-height: 44px;
    padding: 0 1rem;
    border-radius: 6px;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid #cbd5cb;
  }
  .btn-secondary {
    background: white;
    color: #4a5d4a;
  }
</style>
