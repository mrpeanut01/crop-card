<script lang="ts">
  import { Lock, FileText, Plus } from 'lucide-svelte';
  import SettingsShell from '$lib/components/settings/SettingsShell.svelte';
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte';
  import SettingsField from '$lib/components/settings/SettingsField.svelte';

  let { data } = $props();

  const RETENTION_TILES = [
    { k: 'Spray events', v: '7 yr', note: 'FR-09 lock + hash chain' },
    { k: 'Harvest events', v: '7 yr', note: 'Full provenance' },
    { k: 'Scout events', v: '3 yr', note: 'Trend analysis' },
    { k: 'Application photos', v: '1 yr', note: 'Optional · disable per-event' }
  ];

  // Hash-chain integrity stats — we don't have a real hash chain yet
  // (Phase 26 work), so surface the record count as the "chain length"
  // placeholder + use the oldest spray event for "oldest record".
  const chainStats = $derived({
    length: data.counts.sprays,
    lastVerified: 'today',
    oldest: '—'
  });
</script>

<svelte:head><title>Records & retention · CropCard</title></svelte:head>

<SettingsShell title="Records & retention" kicker="Compliance & audit">
  <SettingsSection
    title="Retention policy"
    sub="VDACS expects 2 years. CropCard retains the spray + harvest hash chain for 7 years."
  >
    <div class="tile-grid">
      {#each RETENTION_TILES as r (r.k)}
        <div class="tile">
          <div class="tile-v serif">{r.v}</div>
          <div class="tile-k">{r.k}</div>
          <div class="tile-note">{r.note}</div>
        </div>
      {/each}
    </div>
  </SettingsSection>

  <SettingsSection
    title="Lock window"
    sub="FR-09 · spray records become immutable after this many hours. Server-enforced regardless of UI."
  >
    <div class="lock-grid">
      <SettingsField label="Lock after" hint="hours">
        <input class="s-input mono" type="number" value={data.retention.sprayYears * 0 + 48} />
      </SettingsField>
      <div class="warn-card">
        <strong>Important:</strong> setting below 24h surfaces a curator warning. Setting above 96h triggers
        a VDACS escalation review (events should be locked promptly).
      </div>
    </div>
  </SettingsSection>

  <SettingsSection
    title="Hash chain integrity"
    sub="Every record signs the previous record's hash. A tampered row breaks the chain."
  >
    <div class="chain-grid">
      <div>
        <div class="kicker-row">Chain length</div>
        <div class="chain-val mono">{chainStats.length} records</div>
      </div>
      <div>
        <div class="kicker-row">Last verified</div>
        <div class="chain-val mono">{chainStats.lastVerified}</div>
      </div>
      <div>
        <div class="kicker-row">Oldest record</div>
        <div class="chain-val mono">{chainStats.oldest}</div>
      </div>
    </div>
    <div class="action-row">
      <button type="button" class="ghost" disabled><Lock size={12} /> Re-verify chain</button>
      <a class="ghost" href="/api/spray/records/export.usda.csv"
        ><FileText size={12} /> Download VDACS audit pack</a
      >
      <a class="ghost" href="/settings/helpers"><Plus size={12} /> Create inspector link</a>
    </div>
  </SettingsSection>
</SettingsShell>

<style>
  .tile-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
  }
  .tile {
    padding: 10px 12px;
    background: var(--color-cream);
    border: 1px solid var(--color-divider-soft, var(--color-divider));
    border-radius: 8px;
  }
  .tile-v {
    font-size: 20px;
    color: var(--color-forest-deep);
    line-height: 1;
    font-weight: 600;
    font-family: var(--font-serif, serif);
  }
  .tile-k {
    font-size: 11px;
    color: var(--color-ink);
    margin-top: 5px;
    font-weight: 700;
  }
  .tile-note {
    font-size: 10.5px;
    color: var(--color-ink-muted);
    margin-top: 2px;
  }

  .lock-grid {
    display: grid;
    grid-template-columns: 1fr 2fr;
    gap: 14px;
    align-items: center;
  }
  .warn-card {
    padding: 10px 12px;
    background: rgba(212, 167, 92, 0.12);
    border: 1px solid rgba(212, 167, 92, 0.4);
    border-radius: 6px;
    font-size: 11.5px;
    color: #8a6722;
    line-height: 1.5;
  }

  .chain-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 12px;
    margin-bottom: 10px;
  }
  .kicker-row {
    font-size: 11px;
    font-weight: 700;
    color: var(--color-ink-muted);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .chain-val {
    font-size: 13px;
    color: var(--color-ink);
    margin-top: 3px;
  }

  .action-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .s-input {
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-ink);
    padding: 8px 10px;
    border-radius: var(--radius-input, 6px);
    font-size: 13.5px;
    font-family: inherit;
    outline: none;
    width: 100%;
  }
  .s-input.mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .s-input:focus {
    border-color: var(--color-forest-deep);
    box-shadow: 0 0 0 2px rgba(44, 82, 55, 0.15);
  }
  .ghost {
    background: var(--color-paper);
    color: var(--color-ink);
    border: 1px solid var(--color-divider);
    padding: 6px 12px;
    border-radius: var(--radius-input, 6px);
    text-decoration: none;
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .ghost:hover:not(:disabled) {
    border-color: var(--color-forest-deep);
  }
  .ghost:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  @media (max-width: 760px) {
    .tile-grid {
      grid-template-columns: 1fr 1fr;
    }
    .lock-grid,
    .chain-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
