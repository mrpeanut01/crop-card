<script lang="ts">
  import { ChevronLeft, Lock, Pencil } from 'lucide-svelte';
  import Pill from '$lib/components/ui/Pill.svelte';
  import LockPill from '$lib/components/ui/LockPill.svelte';
  import { KIND_LABEL, KIND_TONE } from '$lib/db/recordKinds';

  let { data } = $props();

  function fmtTimestamp(ms: number): string {
    return new Date(ms).toLocaleString('sv-SE', { hour12: false }).slice(0, 16);
  }

  function fmtDate(ms: number | null | undefined): string {
    if (ms == null) return '—';
    return new Date(ms).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  /**
   * Edit affordance (#195) — the spray flow exposes a PATCH endpoint for
   * editable rows. Other kinds don't have one yet; we'd surface the
   * affordance for spray and otherwise route back to the relevant entry
   * route so the operator at least knows where the row came from.
   */
  function editHref(kind: string): string | null {
    if (kind === 'spray') return '/spray';
    if (kind === 'insecticide') return '/spray/insecticide';
    if (kind === 'fungicide') return '/spray/fungicide';
    if (kind === 'harvest') return '/harvest';
    if (kind === 'scout') return '/scout';
    if (kind === 'fertility') return '/fertility';
    if (kind === 'planting') return '/plan';
    return null;
  }

  function entries(obj: Record<string, unknown> | null) {
    if (!obj) return [];
    return Object.entries(obj).filter(([, v]) => v !== undefined && v !== null);
  }

  function fmtVal(v: unknown): string {
    if (v == null) return '—';
    if (typeof v === 'number' && v > 1_000_000_000_000) return fmtDate(v);
    if (typeof v === 'object') return JSON.stringify(v, null, 2);
    return String(v);
  }
</script>

<svelte:head><title>{KIND_LABEL[data.kind]} record · CropCard</title></svelte:head>

<header class="head">
  <a class="back" href="/records" aria-label="Back to Records">
    <ChevronLeft size={16} />
  </a>
  <div class="head-text">
    <div class="kicker">Records · {KIND_LABEL[data.kind]}</div>
    <h1 class="serif">{KIND_LABEL[data.kind]} record</h1>
  </div>
  <div class="head-meta">
    <Pill tone={KIND_TONE[data.kind]}>{KIND_LABEL[data.kind]}</Pill>
    <LockPill locked={data.locked} />
  </div>
</header>

{#if data.locked}
  <section class="lock-banner" role="status">
    <Lock size={14} />
    <span>
      <strong>Locked.</strong>
      This record passed the 48-hour FR-09 edit window
      {#if data.lockedAt}on <span class="mono">{fmtTimestamp(data.lockedAt)}</span>{/if}
      and is immutable. Edits would break the audit chain.
    </span>
  </section>
{:else}
  <section class="edit-banner" role="status">
    <span>
      <strong>Editable until {fmtTimestamp(data.occurredAt + 48 * 60 * 60 * 1000)}.</strong>
      Make corrections before the 48-hour FR-09 window closes — after that this row will be locked for
      audit integrity.
    </span>
    {#if editHref(data.kind)}
      <a class="edit-cta" href={editHref(data.kind)!}>
        <Pencil size={13} /> Edit in {data.kind}
      </a>
    {/if}
  </section>
{/if}

<section class="card">
  <div class="card-row">
    <div class="card-label">When</div>
    <div class="card-value mono">{fmtTimestamp(data.occurredAt)}</div>
  </div>
  {#if data.performerLabel}
    <div class="card-row">
      <div class="card-label">Performed by</div>
      <div class="card-value">{data.performerLabel}</div>
    </div>
  {/if}
  <div class="card-row">
    <div class="card-label">Row id</div>
    <div class="card-value mono">{data.rowId}</div>
  </div>
</section>

<section class="card">
  <h2 class="card-title">Detail</h2>
  <dl class="kv">
    {#each entries(data.detail) as [k, v] (k)}
      <dt>{k}</dt>
      <dd>
        {#if typeof v === 'object' && v !== null}
          <pre class="mono">{fmtVal(v)}</pre>
        {:else}
          <span class="mono">{fmtVal(v)}</span>
        {/if}
      </dd>
    {/each}
  </dl>
</section>

<style>
  .head {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 18px;
  }
  .back {
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    text-decoration: none;
    color: var(--color-ink-muted, #7a7f75);
    flex-shrink: 0;
  }
  .back:hover {
    color: var(--color-forest-deep, #1f3a28);
    border-color: var(--color-forest-deep, #1f3a28);
  }
  .head-text {
    flex: 1;
  }
  .kicker {
    font-size: 11px;
    color: var(--color-ink-muted, #7a7f75);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 600;
  }
  h1 {
    margin: 4px 0 0;
    font-size: 26px;
    color: var(--color-forest-deep, #1f3a28);
    letter-spacing: -0.015em;
  }
  .head-meta {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .lock-banner,
  .edit-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-radius: 6px;
    margin-bottom: 14px;
    font-size: 13px;
    line-height: 1.4;
  }
  .lock-banner {
    background: var(--pill-forest-bg);
    color: var(--pill-forest-fg);
    border-left: 4px solid var(--color-forest-deep, #1f3a28);
  }
  .edit-banner {
    background: var(--pill-wheat-bg);
    color: var(--pill-wheat-fg, #8a6722);
    border-left: 4px solid #b8893c;
  }
  .edit-cta {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: var(--color-paper);
    border: 1px solid currentColor;
    color: inherit;
    padding: 6px 12px;
    border-radius: var(--radius-input, 6px);
    text-decoration: none;
    font-weight: 600;
    font-size: 12.5px;
  }
  .edit-cta:hover {
    filter: brightness(0.96);
  }
  .card {
    background: var(--color-paper, #fdfaf2);
    border: 1px solid var(--color-divider, #d9cfb7);
    border-radius: 8px;
    padding: 14px 18px;
    margin-bottom: 14px;
  }
  .card-title {
    margin: 0 0 10px;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-ink-muted, #7a7f75);
    font-weight: 700;
  }
  .card-row {
    display: grid;
    grid-template-columns: 140px 1fr;
    gap: 12px;
    padding: 6px 0;
    border-top: 1px solid var(--color-divider-soft, #e9dfcc);
    font-size: 13px;
  }
  .card-row:first-child {
    border-top: 0;
  }
  .card-label {
    color: var(--color-ink-muted, #7a7f75);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 11px;
    font-weight: 600;
  }
  .card-value {
    color: var(--color-ink, #1a1f1a);
  }
  .kv {
    display: grid;
    grid-template-columns: 180px 1fr;
    gap: 4px 14px;
    margin: 0;
  }
  .kv dt {
    color: var(--color-ink-muted, #7a7f75);
    font-size: 11.5px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
    padding: 4px 0;
    border-top: 1px solid var(--color-divider-soft, #e9dfcc);
  }
  .kv dt:first-of-type,
  .kv dd:first-of-type {
    border-top: 0;
  }
  .kv dd {
    margin: 0;
    padding: 4px 0;
    border-top: 1px solid var(--color-divider-soft, #e9dfcc);
    font-size: 13px;
    color: var(--color-ink, #1a1f1a);
  }
  .kv pre {
    margin: 0;
    background: var(--color-cream, #f8f3e8);
    padding: 8px 10px;
    border-radius: 4px;
    font-size: 11.5px;
    overflow-x: auto;
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }
</style>
