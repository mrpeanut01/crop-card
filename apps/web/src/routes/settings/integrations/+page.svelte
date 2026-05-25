<script lang="ts">
  import { Cloud, Check } from 'lucide-svelte';
  import SettingsShell from '$lib/components/settings/SettingsShell.svelte';
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';

  let { data } = $props();

  // Static integration list — these describe app-wide capability not
  // per-tenant state. Real connection status (e.g., NEWA API key set)
  // would slot in from the loader; today we surface the cap with the
  // assumption it's wired (NOAA is, the others are stubs).
  interface Integration {
    id: string;
    name: string;
    status: 'connected' | 'planned';
    note: string;
    since: string | null;
  }
  const integrations: Integration[] = [
    {
      id: 'weather',
      name: 'Weather · NOAA + NEWA',
      status: 'connected',
      note: 'Drives FHB + PM forecasts · 8 mi station radius',
      since: 'Mar 2024'
    },
    {
      id: 'soil',
      name: 'Soil-test · UMD Extension',
      status: 'connected',
      note: 'Last test Apr 2025 · pulls organic-matter + P + K + pH per block',
      since: 'Apr 2024'
    },
    {
      id: 'usda',
      name: 'USDA · soil-survey + frost',
      status: 'connected',
      note: 'Catlett + Penn silt loam zones · last-frost-safe dates',
      since: 'Mar 2024'
    },
    {
      id: 'vdacs',
      name: 'VDACS · inspector links',
      status: 'connected',
      note: 'Time-boxed read-only audit links',
      since: 'Mar 2024'
    },
    {
      id: 'qb',
      name: 'Quickbooks · sales + COGS',
      status: 'planned',
      note: 'Will feed harvest sales → P&L · gated behind owner consent',
      since: null
    },
    {
      id: 'csa',
      name: 'CSA member portal (Mailchimp)',
      status: 'planned',
      note: 'Weekly harvest broadcast + member ratings',
      since: null
    },
    {
      id: 'fsa',
      name: 'FSA crop-reporting',
      status: 'planned',
      note: 'Acreage report 578 auto-fill',
      since: null
    }
  ];

  const active = integrations.filter((i) => i.status === 'connected');
  const planned = integrations.filter((i) => i.status === 'planned');
</script>

<svelte:head><title>Integrations · CropCard</title></svelte:head>

<SettingsShell title="Integrations" kicker="Connected services">
  <SettingsSection title="Active integrations">
    {#each active as it, i (it.id)}
      <div class="row">
        <div class="icon"><Cloud size={16} strokeWidth={1.75} /></div>
        <div class="row-text">
          <div class="row-title">{it.name}</div>
          <div class="row-sub">{it.note}</div>
          <div class="row-meta mono">connected since {it.since}</div>
        </div>
        <Pill tone="forest"><Check size={10} /> connected</Pill>
        <button type="button" class="ghost-sm">Manage</button>
      </div>
    {/each}
  </SettingsSection>

  <SettingsSection
    title="Planned integrations"
    sub="On the roadmap. Open issues in the repo to track or sponsor a particular one."
  >
    <div class="planned-grid">
      {#each planned as it (it.id)}
        <div class="planned-card">
          <div class="icon dim"><Cloud size={13} /></div>
          <div>
            <div class="planned-title">{it.name}</div>
            <div class="planned-sub">{it.note}</div>
          </div>
        </div>
      {/each}
    </div>
  </SettingsSection>

  <SettingsSection
    title="External agents"
    sub="Bearer tokens that let external Claude agents drive /api/** non-interactively."
  >
    <p class="external-blurb">
      Manage API tokens at <a href="/settings/api-tokens">/settings/api-tokens</a>.
      {data.tokenCount} token{data.tokenCount === 1 ? '' : 's'} active for your owner.
    </p>
  </SettingsSection>
</SettingsShell>

<style>
  .row {
    padding: 12px 0;
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    gap: 14px;
    align-items: center;
    border-top: 1px solid var(--color-divider-soft, var(--color-divider));
  }
  .row:first-child {
    border-top: 0;
  }
  .icon {
    width: 36px;
    height: 36px;
    border-radius: 7px;
    background: rgba(141, 174, 138, 0.18);
    color: var(--color-forest-deep);
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .icon.dim {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: var(--color-divider-soft, var(--color-divider));
    color: var(--color-ink-soft);
  }
  .row-text {
    min-width: 0;
  }
  .row-title {
    font-size: 13.5px;
    color: var(--color-ink);
    font-weight: 600;
  }
  .row-sub {
    font-size: 11.5px;
    color: var(--color-ink-soft);
    margin-top: 2px;
  }
  .row-meta {
    font-size: 10.5px;
    color: var(--color-ink-muted);
    margin-top: 2px;
  }

  .planned-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .planned-card {
    padding: 10px 12px;
    background: var(--color-cream);
    border: 1px dashed var(--color-divider);
    border-radius: 8px;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 10px;
    align-items: start;
  }
  .planned-title {
    font-size: 12.5px;
    color: var(--color-ink);
    font-weight: 600;
  }
  .planned-sub {
    font-size: 11px;
    color: var(--color-ink-muted);
    margin-top: 3px;
    line-height: 1.4;
  }

  .external-blurb {
    margin: 0;
    color: var(--color-ink-soft);
    font-size: 13px;
  }
  .external-blurb a {
    color: var(--color-forest-deep);
    font-weight: 600;
    text-decoration: none;
  }
  .external-blurb a:hover {
    text-decoration: underline;
  }

  .ghost-sm {
    background: var(--color-paper);
    color: var(--color-ink);
    border: 1px solid var(--color-divider);
    padding: 5px 10px;
    border-radius: var(--radius-input, 6px);
    font-family: inherit;
    font-size: 11.5px;
    cursor: pointer;
  }
  .ghost-sm:hover {
    border-color: var(--color-forest-deep);
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  @media (max-width: 700px) {
    .row {
      grid-template-columns: auto 1fr;
    }
    .row > :nth-child(n+3) {
      grid-column: 1 / -1;
      justify-self: start;
    }
    .planned-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
