<script lang="ts">
  import { FileText, AlertTriangle } from 'lucide-svelte';
  import SettingsShell from '$lib/components/settings/SettingsShell.svelte';
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte';

  let { data } = $props();

  const DIAGNOSTICS = $derived<Array<[string, string]>>([
    ['Build version', data.advanced.buildVersion],
    ['Rules version', data.advanced.rulesVersion],
    ['Plugin failures', String(data.advanced.pluginFailures)],
    ['Tenant ID', data.advanced.tenantId],
    ['Last Litestream backup', data.advanced.lastBackup],
    ['Storage tier', 'SQLite · Litestream → Azure Blob']
  ]);

  const EXPORTS = [
    { name: 'Spray events', fmt: 'CSV', href: '/api/spray/records/export.csv' },
    { name: 'USDA / NRCS export', fmt: 'CSV', href: '/api/spray/records/export.usda.csv' },
    { name: 'Spray events PDF', fmt: 'PDF · printable', href: '/api/spray/records/export.pdf' },
    { name: 'Records (audit)', fmt: 'browser', href: '/records' },
    { name: 'Plugin overrides', fmt: 'JSON snapshot', href: '/plugins' },
    {
      name: 'Full account · everything',
      fmt: 'tar.gz · planned',
      href: null
    }
  ];

  const DANGER = [
    {
      title: 'Transfer farm ownership',
      desc: 'Re-assigns this owner_id to another user. Spray records remain locked under the original signer; helpers stay attached.',
      btn: 'Transfer…',
      action: '/settings/advanced',
      danger: false
    },
    {
      title: 'Reset plugin overrides',
      desc: 'Removes all your custom plugin overrides. Crop + input plugins fall back to marketplace defaults.',
      btn: 'Reset…',
      action: '/settings/advanced',
      danger: false
    },
    {
      title: 'Delete all data',
      desc: "Erases everything: spray records, harvest events, blocks, plugins, sessions. VDACS hash chain is also destroyed — you can never prove tampering didn't happen.",
      btn: 'Delete…',
      action: '/settings/advanced',
      danger: true
    }
  ];

  async function copyDiagnostics() {
    const text = DIAGNOSTICS.map(([k, v]) => `${k}: ${v}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API can fail in non-HTTPS contexts; ignore silently.
    }
  }
</script>

<svelte:head><title>Advanced & export-all · CropCard</title></svelte:head>

<SettingsShell title="Advanced & export-all" kicker="Danger zone" hideFooter>
  <SettingsSection title="Diagnostics" sub="Server-reported. Paste into a bug report.">
    <div class="diag-grid">
      {#each DIAGNOSTICS as [k, v] (k)}
        <div>
          <div class="kicker-row">{k}</div>
          <div class="diag-v mono">{v}</div>
        </div>
      {/each}
    </div>
    <button type="button" class="ghost-sm with-icon" onclick={copyDiagnostics}>
      <FileText size={12} /> Copy diagnostics to clipboard
    </button>
  </SettingsSection>

  <SettingsSection
    title="Bulk export"
    sub="Pulls everything for this owner_id. Useful for moving farms or year-end archive."
  >
    <div class="export-grid">
      {#each EXPORTS as e (e.name)}
        <div class="export-card">
          <div>
            <div class="export-name">{e.name}</div>
            <div class="export-fmt mono">{e.fmt}</div>
          </div>
          {#if e.href}
            <a class="ghost-sm" href={e.href}><FileText size={11} /></a>
          {:else}
            <button type="button" class="ghost-sm" disabled><FileText size={11} /></button>
          {/if}
        </div>
      {/each}
    </div>
  </SettingsSection>

  <section class="danger-card">
    <header class="danger-head">
      <AlertTriangle size={15} strokeWidth={1.75} />
      <div>
        <h3 class="serif">Danger zone</h3>
        <p>Irreversible operations · double-confirm required.</p>
      </div>
    </header>
    <div class="danger-body">
      {#each DANGER as d (d.title)}
        <div class="danger-row" class:full-danger={d.danger}>
          <div class="danger-text">
            <div class="danger-title">{d.title}</div>
            <p class="danger-desc">{d.desc}</p>
          </div>
          <button type="button" class="danger-btn" data-danger={d.danger} disabled>
            {d.btn}
          </button>
        </div>
      {/each}
    </div>
  </section>
</SettingsShell>

<style>
  .diag-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
  }
  .kicker-row {
    font-size: 11px;
    font-weight: 700;
    color: var(--color-ink-muted);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .diag-v {
    font-size: 12.5px;
    color: var(--color-ink);
    margin-top: 3px;
  }
  .ghost-sm {
    background: var(--color-paper);
    color: var(--color-ink);
    border: 1px solid var(--color-divider);
    padding: 5px 9px;
    border-radius: var(--radius-input, 6px);
    text-decoration: none;
    font-family: inherit;
    font-size: 11px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .ghost-sm.with-icon {
    margin-top: 14px;
    padding: 6px 12px;
    font-size: 12px;
  }
  .ghost-sm:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ghost-sm:hover:not(:disabled) {
    border-color: var(--color-forest-deep);
  }

  .export-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }
  .export-card {
    padding: 10px 12px;
    border: 1px solid var(--color-divider-soft, var(--color-divider));
    border-radius: 8px;
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    align-items: center;
  }
  .export-name {
    font-size: 12.5px;
    color: var(--color-ink);
    font-weight: 600;
  }
  .export-fmt {
    font-size: 10.5px;
    color: var(--color-ink-muted);
    margin-top: 2px;
  }

  .danger-card {
    border: 1.5px solid #e2b69e;
    background: var(--color-paper);
    border-radius: var(--radius-card, 8px);
    overflow: hidden;
    margin-bottom: 14px;
  }
  .danger-head {
    padding: 13px 18px 11px;
    background: rgba(186, 75, 56, 0.06);
    border-bottom: 1px solid #e2b69e;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-rust, #ba4b38);
  }
  .danger-head h3 {
    margin: 0;
    font-size: 16px;
    color: #8a341b;
    letter-spacing: -0.01em;
  }
  .danger-head p {
    margin: 4px 0 0;
    font-size: 11.5px;
    color: #8a341b;
  }
  .danger-body {
    padding: 14px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .danger-row {
    padding: 10px 12px;
    border: 1px solid var(--color-divider-soft, var(--color-divider));
    border-radius: 8px;
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 12px;
    align-items: center;
  }
  .danger-row.full-danger {
    border-color: #e2b69e;
  }
  .danger-title {
    font-size: 13px;
    color: var(--color-ink);
    font-weight: 700;
  }
  .danger-row.full-danger .danger-title {
    color: #8a341b;
  }
  .danger-desc {
    margin: 3px 0 0;
    font-size: 11.5px;
    color: var(--color-ink-soft);
    line-height: 1.45;
  }
  .danger-btn {
    background: transparent;
    color: var(--color-rust, #ba4b38);
    border: 1px solid var(--color-rust, #ba4b38);
    padding: 6px 12px;
    border-radius: var(--radius-input, 6px);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    opacity: 0.5;
  }
  .danger-btn[data-danger='true'] {
    background: #a64a2a;
    color: var(--color-cream, #f8f3e8);
    border: 0;
  }

  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  @media (max-width: 760px) {
    .diag-grid {
      grid-template-columns: 1fr 1fr;
    }
    .export-grid {
      grid-template-columns: 1fr;
    }
    .danger-row {
      grid-template-columns: 1fr;
    }
  }
</style>
