<script lang="ts">
  import { Check } from 'lucide-svelte';
  import SettingsShell from '$lib/components/settings/SettingsShell.svelte';
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte';
  import SettingsField from '$lib/components/settings/SettingsField.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';
  import AiBudgetMeter from '$lib/components/billing/AiBudgetMeter.svelte';
  import { PLANS, formatUsd } from '$lib/billing/plans';
  import type { ActionData, PageData } from './$types';

  const { data, form }: { data: PageData; form: ActionData } = $props();

  const enabled = $derived(data.key.source !== 'none');
  const hostedKey = $derived(data.key.source === 'env');

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

  const usedToday = $derived((data.usedToday ?? {}) as Record<string, number>);
  // Real quota keys live in DEFAULT_AI_DAILY_QUOTA. Display the
  // ones the design's mockup highlights; fall back to '—' for any
  // that aren't in the snapshot.
  const q = $derived((data.dailyQuotas ?? {}) as Record<string, number>);
  const ENDPOINTS: Array<{ key: string; label?: string; quota: number }> = $derived([
    { key: 'allocate', label: 'Plan, schedule and refine', quota: q.allocate ?? 0 },
    { key: 'inputs', quota: q.inputs ?? 0 },
    { key: 'suggest', quota: q.suggest ?? 0 },
    { key: 'succession', quota: q.succession ?? 0 },
    { key: 'groups', quota: q.groups ?? 0 },
    { key: 'optimize', quota: q.optimize ?? 0 },
    { key: 'plugin-search', label: 'Search → web lookup', quota: q['plugin-search'] ?? 0 },
    { key: 'rationale', label: 'Stock AI refresh (web lookup)', quota: q.rationale ?? 0 },
    { key: 'plugin-batch-scan', label: 'Receipt scan', quota: q['plugin-batch-scan'] ?? 0 },
    { key: 'plugin-scan', label: 'Plugin scan (label OCR)', quota: q['plugin-scan'] ?? 0 },
    { key: 'scan-label', label: 'Inventory label / photo scan', quota: q['scan-label'] ?? 0 },
    { key: 'scan-url', label: 'Inventory product-page URL', quota: q['scan-url'] ?? 0 },
    { key: 'scan-barcode', label: 'Inventory barcode lookup', quota: q['scan-barcode'] ?? 0 },
    { key: 'shortNames', label: 'Short names', quota: q.shortNames ?? 0 },
    { key: 'planting-window', label: 'Planting date helper', quota: q['planting-window'] ?? 0 },
    { key: 'garden-fill', label: 'Fill this bed', quota: q['garden-fill'] ?? 0 },
    { key: 'photo-help', label: 'Ask about a photo', quota: q['photo-help'] ?? 0 }
  ]);
  const upgradeName = $derived(data.spend.upgrade ? PLANS[data.spend.upgrade].name : null);
</script>

<svelte:head><title>AI assistant · CropCard</title></svelte:head>

<SettingsShell
  title="AI planning assistant"
  kicker="Integrations · Claude"
  backHref="/settings/integrations"
>
  {#snippet badge()}
    {#if enabled}
      <Pill tone="forest"><Check size={10} /> Active</Pill>
      <!-- #167 / CT-SET-004 — surface a "Cap exceeded" pill next to
           the Active state when this month's spend is over the cap.
           Mirrors the .over class on the cap-fill bar so the badge
           area and the bar are never out-of-sync. -->
      {#if data.spend.aiOff}
        <Pill tone="neutral">AI off</Pill>
      {:else if data.spend.exhausted}
        <Pill tone="rust">Cap exceeded</Pill>
      {/if}
    {:else}
      <Pill tone="rust">No key</Pill>
    {/if}
  {/snippet}

  {#if hostedKey}
    <p class="included" data-testid="ai-included">AI help is included with your plan.</p>
  {:else if data.isOwner}
    <SettingsSection
      title="API key"
      sub="Saved on this farm's CropCard server and used only for this farm's AI help."
    >
      <form method="POST" action="?/saveKey" class="form-block key-form">
        <SettingsField label="Claude API key" hint="sk-ant-…">
          <input
            class="s-input mono"
            type="password"
            name="apiKey"
            autocomplete="off"
            placeholder={data.key.masked || 'sk-ant-•••••'}
          />
        </SettingsField>
        <button type="submit" class="cap-btn primary">Save key</button>
      </form>
    </SettingsSection>
  {/if}

  <SettingsSection
    title="AI help this month"
    sub="Your plan's monthly AI budget. When it runs out, every feature keeps working without AI."
  >
    <div class="budget" data-testid="ai-budget">
      <AiBudgetMeter usage={data.spend} isOwner={data.isOwner} />
      <p class="budget-plan">
        {data.spend.planName} plan includes {formatUsd(PLANS[data.spend.plan].aiMonthlyUsd)} of AI help
        a month.
        {#if data.spend.starterBoost}Your first 30 days get {formatUsd(data.spend.planBudget)}.{/if}
        {#if upgradeName && data.isOwner}
          <a href="/settings/billing"
            >{upgradeName} includes {formatUsd(
              PLANS[data.spend.upgrade ?? 'grower'].aiMonthlyUsd
            )}.</a
          >
        {/if}
      </p>
      {#if data.isOwner}
        <form method="POST" action="?/setCap" class="cap-form">
          <label class="cap-field">
            <span>Your monthly limit (up to {formatUsd(data.spend.planBudget)})</span>
            <input
              class="s-input mono"
              type="number"
              name="cap"
              min="0"
              step="0.05"
              max={data.spend.planBudget}
              value={data.ownerCapSetting ?? data.spend.planBudget}
            />
          </label>
          <div class="cap-actions">
            <button type="submit" class="cap-btn primary" name="mode" value="set">Save limit</button
            >
            {#if data.ownerCapSetting !== null}
              <button type="submit" class="cap-btn" name="mode" value="plan">Use full plan</button>
            {/if}
            {#if !data.spend.aiOff}
              <button type="submit" class="cap-btn" name="mode" value="off">Turn AI off</button>
            {/if}
          </div>
        </form>
        {#if form && 'message' in form && form.message}
          <p class="cap-msg" role="status">{form.message}</p>
        {:else if form && 'error' in form && form.error}
          <p class="cap-msg err" role="alert">{form.error}</p>
        {/if}
      {/if}
    </div>
  </SettingsSection>

  <details class="advanced" data-testid="ai-advanced">
    <summary>Advanced: daily limits per feature</summary>
    <SettingsSection
      title="Per-endpoint daily quota"
      sub="Each AI feature has its own daily limit on your plan. Hitting one falls back to the deterministic result for the rest of the day. A limit of 0 means the feature is part of a bigger plan."
    >
      <div class="quota-grid">
        {#each ENDPOINTS as e (e.key)}
          {@const used = usedToday[e.key] ?? 0}
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
  </details>

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
  .advanced {
    margin: 0 0 16px;
  }
  .budget {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-width: 560px;
  }
  .budget-plan {
    margin: 0;
    font-size: 13px;
    color: var(--color-ink-soft);
    line-height: 1.5;
  }
  .budget-plan a {
    color: var(--color-forest-deep);
    font-weight: 600;
  }
  .cap-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .cap-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--color-ink);
  }
  .cap-field input {
    max-width: 180px;
    min-height: 48px;
  }
  .cap-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .cap-btn {
    min-height: 48px;
    padding: 0 16px;
    border-radius: var(--radius-input, 6px);
    border: 1.5px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-ink);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .cap-btn.primary {
    background: var(--color-forest-deep);
    border-color: var(--color-forest-deep);
    color: var(--color-cream, #f8f3e8);
  }
  .cap-msg {
    margin: 0;
    font-size: 13px;
    color: var(--color-forest-deep);
  }
  .cap-msg.err {
    color: var(--color-rust);
  }
  .advanced summary {
    min-height: 48px;
    display: flex;
    align-items: center;
    font-weight: 600;
    cursor: pointer;
    color: var(--color-forest-deep);
  }
  .included {
    margin: 0 0 16px;
    font-size: 14px;
    color: var(--color-ink);
  }
  .key-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 480px;
  }
  .form-block {
    margin: 0;
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
