<script lang="ts">
  import { Plus, Wrench } from 'lucide-svelte';
  import SettingsShell from '$lib/components/settings/SettingsShell.svelte';
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';

  let { data } = $props();

  function fmtDate(ms: number | null): string {
    if (!ms) return 'never';
    return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function statusFor(e: (typeof data.equipment)[number]): {
    label: string;
    tone: 'forest' | 'wheat' | 'rust';
    action: string;
    actionHref: string;
  } {
    if (e.requiresDecon) {
      return {
        label: 'Decon required',
        tone: 'rust',
        action: 'Decon wizard',
        actionHref: `/equipment/${e.id}`
      };
    }
    if (e.calibratedGpa == null) {
      return {
        label: 'Re-calibrate',
        tone: 'wheat',
        action: 'Re-calibrate',
        actionHref: `/calibrate?sprayerId=${e.id}`
      };
    }
    return {
      label: 'Calibrated · OK',
      tone: 'forest',
      action: 'Manage',
      actionHref: `/equipment/${e.id}`
    };
  }

  const dirtyCount = $derived(data.equipment.filter((e) => e.requiresDecon).length);
</script>

<svelte:head><title>Sprayers & calibration · CropCard</title></svelte:head>

<SettingsShell title="Sprayers & calibration" kicker="Equipment">
  {#snippet badge()}
    {#if dirtyCount > 0}
      <Pill tone="rust">{dirtyCount} decon needed</Pill>
    {/if}
  {/snippet}

  <SettingsSection
    title="UC-10 · 1/128-acre calibration"
    sub="Re-calibrate quarterly or after a nozzle swap. Locks the dilution table for that sprayer until done."
  >
    <div class="explainer">
      <p>
        <strong>How it works:</strong> spray water into a 18.5 × 18.5 ft square (1/128 ac) at
        your typical pace. The ounces caught = your GPA. CropCard locks the dilution math against
        this GPA until you re-calibrate.
      </p>
      <a class="primary-sm with-icon" href="/calibrate">
        <Wrench size={12} />
        Open calibration wizard
      </a>
    </div>
  </SettingsSection>

  <SettingsSection title={`Sprayers · ${data.equipment.length}`}>
    {#snippet right()}
      <a class="primary-sm" href="/equipment">
        <Plus size={11} /> Add sprayer
      </a>
    {/snippet}

    {#if data.equipment.length === 0}
      <p class="empty">
        No sprayers configured. <a href="/equipment">Add one</a> to start tracking calibration +
        decon.
      </p>
    {/if}

    <div class="sprayer-list">
      {#each data.equipment as e (e.id)}
        {@const s = statusFor(e)}
        <div class="sprayer">
          <div class="sprayer-text">
            <div class="sprayer-name">
              <span class="serif">{e.label}</span>
              <span class="sid mono">· {e.id.slice(-4)}</span>
            </div>
            <div class="sprayer-meta">
              Last calibrated · <span class="mono">{fmtDate(e.calibrationDate)}</span>
              {#if e.calibratedGpa != null}
                · GPA <span class="mono accent">{e.calibratedGpa}</span>
              {/if}
              {#if e.lastChemistryClass}
                · last spray
                <span class="mono" class:rust={e.requiresDecon}>{e.lastChemistryClass}</span>
              {/if}
            </div>
          </div>
          <Pill tone={s.tone}>{s.label}</Pill>
          <a class="ghost-sm" href={s.actionHref}>
            {#if s.tone !== 'forest'}<Wrench size={11} />{/if}
            {s.action}
          </a>
        </div>
      {/each}
    </div>
  </SettingsSection>
</SettingsShell>

<style>
  .explainer {
    padding: 12px 14px;
    background: rgba(141, 174, 138, 0.18);
    border: 1px solid #c9dbc0;
    border-radius: 8px;
    font-size: 12.5px;
    color: var(--color-forest-deep);
    line-height: 1.55;
  }
  .explainer p {
    margin: 0 0 8px;
  }

  .empty {
    margin: 0;
    color: var(--color-ink-soft);
    font-size: 13px;
    font-style: italic;
  }
  .empty a {
    color: var(--color-forest-deep);
    font-weight: 600;
  }

  .sprayer-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .sprayer {
    padding: 12px 14px;
    border: 1px solid var(--color-divider-soft, var(--color-divider));
    border-radius: 8px;
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 14px;
    align-items: center;
  }
  .sprayer-text {
    min-width: 0;
  }
  .sprayer-name {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .sprayer-name .serif {
    font-family: var(--font-serif, serif);
    font-size: 15px;
    color: var(--color-ink);
    font-weight: 600;
  }
  .sid {
    font-size: 11px;
    color: var(--color-ink-muted);
  }
  .sprayer-meta {
    font-size: 11.5px;
    color: var(--color-ink-muted);
    margin-top: 4px;
  }
  .sprayer-meta .accent {
    color: var(--color-ink);
    font-weight: 600;
  }
  .sprayer-meta .rust {
    color: var(--color-rust, #ba4b38);
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .primary-sm {
    background: var(--color-forest-deep);
    color: var(--color-paper);
    padding: 6px 12px;
    border-radius: var(--radius-input, 6px);
    text-decoration: none;
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 32px;
  }
  .primary-sm.with-icon {
    gap: 6px;
  }
  .primary-sm:hover {
    filter: brightness(1.08);
  }
  .ghost-sm {
    background: var(--color-paper);
    color: var(--color-ink);
    border: 1px solid var(--color-divider);
    padding: 6px 10px;
    border-radius: var(--radius-input, 6px);
    font-family: inherit;
    font-size: 11.5px;
    text-decoration: none;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 32px;
  }
  .ghost-sm:hover {
    border-color: var(--color-forest-deep);
  }
  @media (max-width: 700px) {
    .sprayer {
      grid-template-columns: 1fr;
    }
  }
</style>
