<script lang="ts">
  /**
   * Sprint 7 / Phase 27C (#257) — sprayer detail.
   *
   * Asset model (no lots, no catalog toggle). Two-column:
   *   Left  — identity · calibration · decon status
   *   Right — last calibration · usage history · linked spray events
   *
   * Calibration + decon edit flows continue to live at /calibrate and
   * /equipment/[id]; this detail surface only renders read-only state +
   * deep-links into the existing wizards. Cutover happens in Sprint 9.
   */
  import InvSection from '../InvSection.svelte';
  import InvKVP from '../InvKVP.svelte';
  import type { SprayerDetailPayload } from '../../../../routes/inventory/[type]/[id]/+page.server';

  type Props = Omit<SprayerDetailPayload, 'type'>;
  const { equipment }: Props = $props();

  const spec = $derived((equipment.spec ?? {}) as { tankGal?: number; nozzle?: string; boom?: number });
  const lastUsed = $derived(equipment.state.lastUsedAt);
  const lastDecon = $derived(equipment.state.lastDeconAt);
  const deconRequired = $derived(!!(lastUsed && (!lastDecon || lastDecon < lastUsed)));
</script>

<header class="detail-header">
  <span class="kicker">Sprayer · equipment</span>
  <h1 class="serif">{equipment.label}</h1>
  {#if equipment.state.calibratedGpa != null}
    <p class="sub mono">{equipment.state.calibratedGpa.toFixed(1)} GPA · calibrated</p>
  {:else}
    <p class="sub muted">Not yet calibrated</p>
  {/if}
</header>

<div class="detail-grid">
  <div class="col">
    <InvSection title="Identity">
      <InvKVP label="Label" value={equipment.label} />
      <InvKVP label="Equipment id" value={equipment.id} tone="mono" />
      <InvKVP label="Notes" value={equipment.notes ?? '—'} />
    </InvSection>

    <InvSection title="Calibration" kicker="UC-10 1/128-acre">
      <InvKVP
        label="Measured GPA"
        value={equipment.state.calibratedGpa != null ? equipment.state.calibratedGpa.toFixed(1) : '—'}
        tone="mono"
      />
      <InvKVP
        label="Last calibrated"
        value={equipment.state.calibrationDate
          ? new Date(equipment.state.calibrationDate).toLocaleDateString()
          : '—'}
      />
      <InvKVP label="Tank" value={spec.tankGal != null ? `${spec.tankGal} gal` : '—'} />
      <InvKVP label="Nozzle" value={spec.nozzle ?? '—'} />
      <p class="cta-row">
        <a href="/calibrate?sprayer={equipment.id}">Open calibration wizard →</a>
      </p>
    </InvSection>

    <InvSection title="Decon status" kicker="Cross-contamination kernel">
      {#if deconRequired}
        <p class="warn">
          ⚠ Last product (<span class="mono">{equipment.state.lastChemistryClass}</span>) requires
          decon before next use against a different chemistry class.
        </p>
      {:else if equipment.state.lastChemistryClass}
        <p class="ok">
          ✓ Cleaned since last use (last:
          <span class="mono">{equipment.state.lastChemistryClass}</span>)
        </p>
      {:else}
        <p class="muted">No spray history yet.</p>
      {/if}
      <InvKVP
        label="Last decon"
        value={equipment.state.lastDeconAt
          ? new Date(equipment.state.lastDeconAt).toLocaleDateString()
          : '—'}
      />
    </InvSection>
  </div>

  <div class="col">
    <InvSection title="Hour meter">
      <InvKVP
        label="Reading"
        value={equipment.state.hourMeter != null ? `${equipment.state.hourMeter} h` : '—'}
      />
      <InvKVP
        label="Last used"
        value={lastUsed ? new Date(lastUsed).toLocaleDateString() : 'Never'}
      />
    </InvSection>

    <InvSection title="Linked spray events" kicker="Deferred">
      <p class="empty small">
        Per-sprayer spray-event back-reference lands in Phase 28; today /records carries
        the canonical history.
      </p>
      <p class="cta-row">
        <a href="/records?sprayer={equipment.id}">Open records for this sprayer →</a>
      </p>
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
    font-size: 0.9rem;
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  }
  .muted {
    color: var(--color-ink-muted, #6a6f63);
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
  .empty {
    color: var(--color-ink-muted, #6a6f63);
    font-style: italic;
    margin: 0;
    font-size: 0.9rem;
  }
  .small {
    font-size: 0.8rem;
  }
  .cta-row {
    margin: 4px 0 0;
  }
  .cta-row a {
    font-size: 0.85rem;
    color: var(--color-forest, #1f5e3a);
    text-decoration: none;
  }
  .cta-row a:hover {
    text-decoration: underline;
  }
  .warn {
    background: var(--color-rust-tint, #fce8e8);
    color: var(--color-rust, #a23a3a);
    padding: 8px 10px;
    border-radius: 4px;
    margin: 0 0 6px;
    font-size: 0.85rem;
  }
  .ok {
    background: var(--color-forest-tint, #e8f1ea);
    color: var(--color-forest-deep, #1f3522);
    padding: 8px 10px;
    border-radius: 4px;
    margin: 0 0 6px;
    font-size: 0.85rem;
  }
</style>
