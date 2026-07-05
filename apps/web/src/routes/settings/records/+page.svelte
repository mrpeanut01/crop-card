<script lang="ts">
  import { FileText, Plus } from 'lucide-svelte';
  import SettingsShell from '$lib/components/settings/SettingsShell.svelte';
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte';

  let { data } = $props();

  const totalRecords = $derived(
    data.counts.sprays + data.counts.insecticides + data.counts.fungicides + data.counts.harvests
  );
</script>

<svelte:head><title>Records & retention · CropCard</title></svelte:head>

<SettingsShell title="Records & retention" kicker="Compliance & audit">
  <SettingsSection
    title="Retention policy"
    sub="VDACS requires a 2-year minimum for pesticide records. CropCard never auto-deletes — near-expiry rows surface an alert and only the owner can remove them (NFR-05)."
  >
    <div class="tile-grid">
      <div class="tile">
        <div class="tile-v serif">{data.retention.sprayYears} yr</div>
        <div class="tile-k">Minimum retention</div>
        <div class="tile-note">Spray, insecticide, fungicide (FR-09 / NFR-05)</div>
      </div>
      <div class="tile">
        <div class="tile-v serif">{data.retention.sprayInRetention}</div>
        <div class="tile-k">Spray records in retention</div>
        <div class="tile-note">Within the last {data.retention.sprayYears} years</div>
      </div>
      <div class="tile">
        <div class="tile-v serif">{data.retention.approachingRetention}</div>
        <div class="tile-k">Approaching expiry</div>
        <div class="tile-note">Aged into the 30-day pre-expiry window</div>
      </div>
      <div class="tile">
        <div class="tile-v serif">{totalRecords}</div>
        <div class="tile-k">Records retained</div>
        <div class="tile-note">
          {data.counts.sprays} spray · {data.counts.insecticides} insecticide · {data.counts
            .fungicides} fungicide · {data.counts.harvests} harvest
        </div>
      </div>
    </div>
  </SettingsSection>

  <SettingsSection
    title="Lock window"
    sub="FR-09 · spray records become immutable after this window closes. Server-enforced regardless of UI; not user-configurable."
  >
    <div class="lock-grid">
      <div class="tile">
        <div class="tile-v serif">{data.lockWindowHours} h</div>
        <div class="tile-k">Immutable after</div>
        <div class="tile-note">Measured from the time of application</div>
      </div>
      <div class="warn-card">
        <strong>How it works:</strong> a record is editable for {data.lockWindowHours} hours after it's
        entered. After that the server refuses any edit or delete, so the audit trail stays tamper-evident.
      </div>
    </div>
  </SettingsSection>

  <SettingsSection
    title="Integrity & export"
    sub="Each record carries per-plugin content hashes; every export prints a SHA-256 of its canonical row set so an inspector can confirm the records haven't changed since export."
  >
    <div class="action-row">
      <a class="ghost" href="/api/records/export.vdacs.pdf">
        <FileText size={12} /> Download VDACS audit pack
      </a>
      <a class="ghost" href="/settings/helpers"><Plus size={12} /> Invite an inspector</a>
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
    align-items: stretch;
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

  .action-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
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
  .ghost:hover {
    border-color: var(--color-forest-deep);
  }
  @media (max-width: 760px) {
    .tile-grid {
      grid-template-columns: 1fr 1fr;
    }
    .lock-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
