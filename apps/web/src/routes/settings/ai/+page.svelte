<script lang="ts">
  import { Check } from 'lucide-svelte';
  import SettingsShell from '$lib/components/settings/SettingsShell.svelte';
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte';
  import SettingsField from '$lib/components/settings/SettingsField.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const enabled = $derived(data.key.source !== 'none');

  // Static lists from the design — these describe the kernel
  // architecture not per-user state, so they live in the component.
  const GATED = [
    'Allocation refinement chat',
    'Schedule re-derivation (e.g. 3-sisters offsets)',
    'Input plan substitutions',
    "Free-text 'ask the assistant' on Plan v2 + Today"
  ];
  const ALWAYS_WORKS = [
    'All five wizard steps run fully manually — drag Gantt bars, click edit, fill forms',
    'Safety kernel + decon + retention logic are local and never call AI',
    'CSV import / export · plugins · all calendar derivations'
  ];

  // Group recent calls by endpoint for the per-endpoint usage tiles.
  type Endpoint = string;
  const callsByEndpoint = $derived(
    (data.recentCalls ?? []).reduce<Record<Endpoint, number>>((acc, c) => {
      acc[c.endpoint] = (acc[c.endpoint] ?? 0) + 1;
      return acc;
    }, {})
  );
  // Real quota keys live in DEFAULT_AI_DAILY_QUOTA. Display the
  // ones the design's mockup highlights; fall back to '—' for any
  // that aren't in the snapshot.
  const q = $derived(data.dailyQuotas ?? ({} as Record<string, number>));
  const ENDPOINTS: Array<{ key: string; label?: string; quota?: number }> = $derived([
    { key: 'allocate', quota: q.allocate ?? 10 },
    { key: 'inputs', quota: q.inputs ?? 10 },
    { key: 'suggest', quota: q.suggest ?? 20 },
    { key: 'succession', quota: q.succession ?? 20 },
    { key: 'plugin-search', label: 'Search → web lookup', quota: q['plugin-search'] ?? 15 },
    { key: 'plugin-scan', label: 'Plugin scan (label OCR)', quota: q['plugin-scan'] ?? 10 }
  ]);
</script>

<svelte:head><title>AI assistant · CropCard</title></svelte:head>

<SettingsShell title="AI planning assistant" kicker="Claude" saveAction="?/saveKey">
  {#snippet badge()}
    {#if enabled}
      <Pill tone="forest"><Check size={10} /> Active</Pill>
    {:else}
      <Pill tone="rust">No key</Pill>
    {/if}
  {/snippet}

  <SettingsSection title="API key & cap" sub="Stored locally · never sent to the CropCard server.">
    <form method="POST" action="?/saveKey" class="form-block">
      <div class="grid-2-1">
        <SettingsField label="Claude API key" hint="sk-ant-…">
          <input
            class="s-input mono"
            type="password"
            name="apiKey"
            value={data.key.masked}
            placeholder="sk-ant-•••••"
          />
        </SettingsField>
        <SettingsField label="Model">
          <select class="s-input" name="model">
            <option value="claude-haiku-4-5">claude-haiku-4-5</option>
            <option value="claude-sonnet-4-5">claude-sonnet-4-5</option>
          </select>
        </SettingsField>
      </div>
      <div class="cap">
        <div class="cap-head">
          <span class="kicker-row">Monthly cap · USD</span>
          <span class="cap-val mono">${data.spend.cap.toFixed(2)}</span>
        </div>
        <div
          class="cap-bar"
          role="meter"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={Math.round(data.spend.pctUsed * 100)}
        >
          <div
            class="cap-fill"
            class:warn={data.spend.warnAt80}
            class:over={data.spend.pctUsed >= 1}
            style:width="{Math.min(100, Math.round(data.spend.pctUsed * 100))}%"
          ></div>
        </div>
        <div class="cap-ticks mono">
          <span>$0</span>
          <span
            >${data.spend.monthlyUsdSoFar.toFixed(2)} spent · {data.recentCalls?.length ?? 0} calls</span
          >
          <span>${data.spend.cap.toFixed(0)} cap</span>
        </div>
      </div>
    </form>
  </SettingsSection>

  <SettingsSection
    title="Per-endpoint daily quota"
    sub="Each AI endpoint has its own cap. Hitting a quota falls back to deterministic mode for the rest of the day."
  >
    <div class="quota-grid">
      {#each ENDPOINTS as e (e.key)}
        {@const used = callsByEndpoint[e.key] ?? 0}
        {@const pct = e.quota ? used / e.quota : 0}
        <div class="quota-row">
          <div class="quota-text">
            <div class="quota-label">{e.label ?? `/api/plan/${e.key}`}</div>
            {#if e.label}
              <div class="quota-sub mono">/api/{e.key}</div>
            {/if}
          </div>
          <span class="quota-val mono" class:warn={pct >= 0.8}>{used}/{e.quota}</span>
        </div>
      {/each}
    </div>
  </SettingsSection>

  <SettingsSection
    title="What's gated vs always-works"
    sub="Deterministic fallbacks ensure CropCard remains usable when AI is off, offline, or rate-limited."
  >
    <div class="gated-grid">
      <div>
        <div class="kicker-row">Gated by AI</div>
        <ul class="gated-list" class:dim={!enabled}>
          {#each GATED as g, i (i)}<li>{g}</li>{/each}
        </ul>
      </div>
      <div class="always-works-col">
        <div class="kicker-row">Always works</div>
        <ul class="works-list">
          {#each ALWAYS_WORKS as k, i (i)}
            <li>
              <Check size={11} strokeWidth={2} />
              {k}
            </li>
          {/each}
        </ul>
      </div>
    </div>
  </SettingsSection>
</SettingsShell>

<style>
  .grid-2-1 {
    display: grid;
    grid-template-columns: 1.6fr 1fr;
    gap: 16px;
  }
  .form-block {
    margin: 0;
  }
  .cap {
    margin-top: 14px;
  }
  .cap-head {
    display: flex;
    justify-content: space-between;
    margin-bottom: 5px;
  }
  .cap-val {
    font-size: 12px;
    color: var(--color-ink);
    font-weight: 600;
  }
  .cap-bar {
    height: 8px;
    background: var(--color-cream);
    border-radius: 999px;
    overflow: hidden;
    border: 1px solid var(--color-divider);
  }
  .cap-fill {
    height: 100%;
    background: var(--color-forest-deep);
    transition: width 0.3s ease;
  }
  .cap-fill.warn {
    background: var(--color-wheat, #d4a75c);
  }
  .cap-fill.over {
    background: var(--color-rust, #ba4b38);
  }
  .cap-ticks {
    margin-top: 4px;
    display: flex;
    justify-content: space-between;
    font-size: 10.5px;
    color: var(--color-ink-muted);
  }

  .quota-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .quota-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    align-items: center;
    padding: 9px 12px;
    border: 1px solid var(--color-divider-soft, var(--color-divider));
    border-radius: 6px;
  }
  .quota-label {
    font-size: 12.5px;
    color: var(--color-ink);
    font-weight: 600;
  }
  .quota-sub {
    font-size: 10.5px;
    color: var(--color-ink-muted);
    margin-top: 2px;
  }
  .quota-val {
    font-size: 11.5px;
    color: var(--color-forest-deep);
    font-weight: 600;
  }
  .quota-val.warn {
    color: var(--color-wheat, #d4a75c);
  }

  .gated-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
  .always-works-col {
    padding-left: 18px;
    border-left: 1px solid var(--color-divider-soft, var(--color-divider));
  }
  .kicker-row {
    font-size: 11px;
    font-weight: 700;
    color: var(--color-ink-muted);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .gated-list,
  .works-list {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
  }
  .gated-list li {
    font-size: 12px;
    color: var(--color-ink);
    line-height: 1.7;
    padding-left: 14px;
    position: relative;
  }
  .gated-list li::before {
    content: '';
    position: absolute;
    left: 0;
    top: 8px;
    width: 5px;
    height: 5px;
    border-radius: 999px;
    background: var(--color-forest-deep);
  }
  .gated-list.dim li {
    color: var(--color-ink-muted);
  }
  .gated-list.dim li::before {
    background: var(--color-divider);
  }
  .works-list li {
    font-size: 12px;
    color: var(--color-ink);
    line-height: 1.7;
    padding-left: 18px;
    position: relative;
  }
  .works-list li :global(svg) {
    position: absolute;
    left: 0;
    top: 6px;
    color: var(--color-forest-deep);
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
  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }

  @media (max-width: 700px) {
    .grid-2-1,
    .quota-grid,
    .gated-grid {
      grid-template-columns: 1fr;
    }
    .always-works-col {
      padding-left: 0;
      border-left: 0;
      border-top: 1px solid var(--color-divider-soft, var(--color-divider));
      padding-top: 14px;
    }
  }
</style>
