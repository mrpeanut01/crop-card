<script lang="ts">
  import { FileText, AlertTriangle } from 'lucide-svelte';
  import SettingsShell from '$lib/components/settings/SettingsShell.svelte';
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte';
  import { createT, type MessageKey } from '$lib/i18n';

  let { data } = $props();

  const tr = $derived(createT(data.locale));

  const DIAGNOSTICS = $derived<Array<[MessageKey, string]>>([
    ['settings.advanced.diag.build', data.advanced.buildVersion],
    ['settings.advanced.diag.rules', data.advanced.rulesVersion],
    ['settings.advanced.diag.pluginFailures', String(data.advanced.pluginFailures)],
    ['settings.advanced.diag.crops', String(data.appData.crops)],
    ['settings.advanced.diag.herbicides', String(data.appData.herbicides)],
    ['settings.advanced.diag.plugins', String(data.appData.plugins)],
    ['settings.advanced.diag.blocks', String(data.appData.blocks)],
    ['settings.advanced.diag.plantings', String(data.appData.plantings)],
    ['settings.advanced.diag.tenant', data.advanced.tenantId],
    ['settings.advanced.diag.backup', data.advanced.lastBackup],
    ['settings.advanced.diag.storage', 'SQLite · Litestream → Azure Blob']
  ]);

  const EXPORTS: Array<{ name: MessageKey; fmt: MessageKey | 'CSV'; href: string | null }> = [
    { name: 'settings.advanced.exp.spray', fmt: 'CSV', href: '/api/spray/records/export.csv' },
    { name: 'settings.advanced.exp.usda', fmt: 'CSV', href: '/api/spray/records/export.usda.csv' },
    {
      name: 'settings.advanced.exp.sprayPdf',
      fmt: 'settings.advanced.fmt.pdf',
      href: '/api/spray/records/export.pdf'
    },
    {
      name: 'settings.advanced.exp.records',
      fmt: 'settings.advanced.fmt.browser',
      href: '/records'
    },
    { name: 'settings.advanced.exp.plugins', fmt: 'settings.advanced.fmt.json', href: '/plugins' },
    {
      name: 'settings.advanced.exp.account',
      fmt: 'settings.advanced.fmt.tar',
      href: null
    }
  ];

  const DANGER: Array<{
    title: MessageKey;
    desc: MessageKey;
    btn: MessageKey;
    action: string;
    danger: boolean;
  }> = [
    {
      title: 'settings.advanced.transfer.title',
      desc: 'settings.advanced.transfer.desc',
      btn: 'settings.advanced.transfer.btn',
      action: '/settings/advanced',
      danger: false
    },
    {
      title: 'settings.advanced.reset.title',
      desc: 'settings.advanced.reset.desc',
      btn: 'settings.advanced.reset.btn',
      action: '/settings/advanced',
      danger: false
    },
    {
      title: 'settings.advanced.delete.title',
      desc: 'settings.advanced.delete.desc',
      btn: 'settings.advanced.delete.btn',
      action: '/settings/advanced',
      danger: true
    }
  ];

  async function copyDiagnostics() {
    const en = createT('en');
    const text = DIAGNOSTICS.map(([k, v]) => `${en(k)}: ${v}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API can fail in non-HTTPS contexts; ignore silently.
    }
  }
</script>

<svelte:head
  ><title
    >{tr('settings.advanced.pageTitle', {
      title: data.isOwner
        ? tr('settings.advanced.ownerTitle')
        : tr('settings.advanced.appInfoTitle')
    })}</title
  ></svelte:head
>

<SettingsShell
  title={data.isOwner ? tr('settings.advanced.ownerTitle') : tr('settings.advanced.appInfoTitle')}
  kicker={data.isOwner ? tr('settings.advanced.kickerOwner') : tr('settings.advanced.kickerHelper')}
  hideFooter
>
  <SettingsSection
    title={data.isOwner
      ? tr('settings.advanced.versionsOwner')
      : tr('settings.advanced.versionsHelper')}
    sub={data.isOwner ? tr('settings.advanced.subOwner') : tr('settings.advanced.subHelper')}
  >
    <div class="diag-grid" data-testid="app-info">
      {#each DIAGNOSTICS as [k, v] (k)}
        <div>
          <div class="kicker-row">{tr(k)}</div>
          <div class="diag-v mono">{v}</div>
        </div>
      {/each}
    </div>
    <button type="button" class="ghost-sm with-icon" onclick={copyDiagnostics}>
      <FileText size={12} />
      {tr('settings.advanced.copy')}
    </button>
    {#if data.pluginFailureList.length > 0}
      <div class="failures" data-testid="plugin-failures">
        <h3>{tr('settings.advanced.failuresTitle')}</h3>
        <p>{tr('settings.advanced.failuresBody')}</p>
        <ul>
          {#each data.pluginFailureList as f, i (i)}<li class="mono">{f}</li>{/each}
        </ul>
      </div>
    {/if}
  </SettingsSection>

  {#if data.isOwner}
    <SettingsSection
      title={tr('settings.advanced.bulkTitle')}
      sub={tr('settings.advanced.bulkSub')}
    >
      <div class="export-grid">
        {#each EXPORTS as e (e.name)}
          <div class="export-card">
            <div>
              <div class="export-name">{tr(e.name)}</div>
              <div class="export-fmt mono">{e.fmt === 'CSV' ? e.fmt : tr(e.fmt)}</div>
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
          <h3 class="serif">{tr('settings.advanced.dangerTitle')}</h3>
          <p>{tr('settings.advanced.dangerSub')}</p>
        </div>
      </header>
      <div class="danger-body">
        {#each DANGER as d (d.title)}
          <div class="danger-row" class:full-danger={d.danger}>
            <div class="danger-text">
              <div class="danger-title">{tr(d.title)}</div>
              <p class="danger-desc">{tr(d.desc)}</p>
            </div>
            <button type="button" class="danger-btn" data-danger={d.danger} disabled>
              {tr(d.btn)}
            </button>
          </div>
        {/each}
      </div>
    </section>
  {/if}
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
    overflow-wrap: anywhere;
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
    min-height: 48px;
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

  .failures {
    margin-top: 16px;
    padding: 12px 14px;
    border: 1px solid #e2b69e;
    border-radius: 8px;
    background: rgba(186, 75, 56, 0.06);
  }
  .failures h3 {
    margin: 0;
    font-size: 14px;
    color: #8a341b;
  }
  .failures p {
    margin: 4px 0 8px;
    font-size: 13px;
    color: var(--color-ink-soft);
  }
  .failures ul {
    margin: 0;
    padding-left: 1.1rem;
    font-size: 12px;
    overflow-wrap: anywhere;
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
