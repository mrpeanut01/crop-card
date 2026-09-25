<script lang="ts">
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import ProvenanceLegend from '$lib/components/ui/ProvenanceLegend.svelte';
  import AiProgress from '../AiProgress.svelte';
  import ChatPanel from '../ChatPanel.svelte';
  import { fmtDateMs } from '../format';
  import { getWizardContext } from '../wizardState.svelte';

  const w = getWizardContext();
  const aiEnabled = $derived(w.props.aiEnabled);
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
    note={aiEnabled
      ? 'Dates AI-proposed within plugin-derived windows · all editable'
      : 'AI off · deterministic scheduler · plugin windows + your records'}
  />
  {#if w.scheduleLoading}
    <AiProgress stage="schedule" startMs={w.scheduleStartMs} />
  {:else if w.scheduleError}
    <p class="aw-error">Error: {w.scheduleError}</p>
    <button class="btn-secondary" onclick={() => w.advanceToSchedule()}>Retry</button>
  {:else if w.scheduleResponse}
    {#if w.scheduleResponse.meta.fallback}
      <div class="aw-banner info" role="alert" aria-live="assertive">
        {w.scheduleResponse.meta.fallback === 'no-api-key'
          ? '🛟 Dates picked by the deterministic scheduler (no Anthropic API key). Staggers + companion offsets honored.'
          : '🛟 AI needed help — deterministic scheduler took over. See chat below for what tripped it up and refine from there.'}
      </div>
    {/if}
    <p class="aw-rationale">
      {w.scheduleResponse.rationale}
      <Provenance
        source={w.scheduleResponse.meta.fallback ? 'fallback' : aiEnabled ? 'ai' : 'plugin'}
        detail={w.scheduleResponse.meta.fallback ? 'deterministic scheduler' : undefined}
        compact
      />
    </p>
    <table class="aw-table">
      <thead>
        <tr>
          <th>Seed</th>
          <th>Block</th>
          <th>Planting date</th>
          <th>Plants</th>
          <th>Why</th>
        </tr>
      </thead>
      <tbody>
        {#each w.scheduleResponse.scheduled as p, i (i)}
          <tr>
            <td>
              {p.varietyDisplayName}
              {#if p.successionIndex}
                <span class="chip chip-succession" title="Succession sowing">
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
        <strong>Schedule notes:</strong>
        <ul>
          {#each w.scheduleResponse.advisories as a}<li>{a}</li>{/each}
        </ul>
      </section>
    {/if}
    <ChatPanel />
  {/if}
{/if}

<style>
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
