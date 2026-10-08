<script lang="ts">
  import { ChevronLeft, Lock, Pencil } from 'lucide-svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import Pill from '$lib/components/ui/Pill.svelte';
  import LockPill from '$lib/components/ui/LockPill.svelte';
  import { KIND_TONE } from '$lib/db/recordKinds';
  import {
    BLOOM_SOURCE_LABEL,
    BLOOM_STATUS_LABEL,
    VERDICT_LABEL
  } from '$lib/records/pollinatorAttestation';
  import { currentPrefs, fmt } from '$lib/prefsState.svelte';
  import { localStamp } from '$lib/exports/localTime';
  import { kindLabel } from '$lib/components/records/kindLabel';

  let { data } = $props();
  const tr = $derived(createT(page.data?.locale));
  const kindName = $derived(kindLabel(tr, data.kind));

  function fmtTimestamp(ms: number): string {
    return localStamp(ms, currentPrefs());
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
    if (kind === 'hay') return '/hay';
    if (kind === 'planting') return '/plan';
    return null;
  }
</script>

<svelte:head><title>{tr('records.detail.title', { kind: kindName })}</title></svelte:head>

<header class="head">
  <a class="back" href="/records" aria-label={tr('records.detail.back')}>
    <ChevronLeft size={16} />
  </a>
  <div class="head-text">
    <div class="kicker">{tr('records.detail.kicker', { kind: kindName })}</div>
    <h1 class="serif">{tr('records.detail.h1', { kind: kindName })}</h1>
  </div>
  <div class="head-meta">
    <Pill tone={KIND_TONE[data.kind]}>{kindName}</Pill>
    <LockPill locked={data.locked} />
  </div>
</header>

{#if data.locked}
  <section class="lock-banner" role="status">
    <Lock size={14} />
    <span>
      <strong>{tr('records.detail.lockedTitle')}</strong>
      {data.lockedAt
        ? tr('records.detail.lockedOn', { date: fmtTimestamp(data.lockedAt) })
        : tr('records.detail.lockedBody')}
    </span>
  </section>
{:else}
  <section class="edit-banner" role="status">
    <span>
      <strong
        >{tr('records.detail.editableUntil', {
          date: fmtTimestamp(data.occurredAt + 48 * 60 * 60 * 1000)
        })}</strong
      >
      {tr('records.detail.editableBody')}
    </span>
    {#if data.canEdit && editHref(data.kind)}
      <a class="edit-cta" href={editHref(data.kind)!}>
        <Pencil size={13} />
        {tr('records.detail.editIn', { kind: kindName.toLowerCase() })}
      </a>
    {/if}
  </section>
{/if}

<section class="card">
  <div class="card-row">
    <div class="card-label">{tr('records.detail.when')}</div>
    <div class="card-value mono">
      {data.kind === 'planting'
        ? fmt.day(data.occurredAt)
        : `${fmtTimestamp(data.occurredAt)} ${fmt.zone(data.occurredAt)}`}
    </div>
  </div>
  {#if data.performerLabel}
    <div class="card-row">
      <div class="card-label">{tr('records.detail.performedBy')}</div>
      <div class="card-value">{data.performerLabel}</div>
    </div>
  {/if}
</section>

{#if data.pollinator}
  {@const p = data.pollinator}
  <section
    class="card"
    aria-labelledby="pollinator-heading"
    data-testid="pollinator-attestation"
    lang="en"
    data-english-only="safety"
  >
    <h2 class="card-title" id="pollinator-heading">Pollinator protection</h2>
    <div class="card-row">
      <div class="card-label">Bloom status</div>
      <div class="card-value">{p.bloomStatus ? BLOOM_STATUS_LABEL[p.bloomStatus] : '—'}</div>
    </div>
    <div class="card-row">
      <div class="card-label">Bloom source</div>
      <div class="card-value">
        {p.bloomStatusSource ? BLOOM_SOURCE_LABEL[p.bloomStatusSource] : '—'}
      </div>
    </div>
    <div class="card-row">
      <div class="card-label">No foragers attested</div>
      <div class="card-value">
        {p.attestedNoForagers === undefined ? '—' : p.attestedNoForagers ? 'Yes' : 'No'}
      </div>
    </div>
    <div class="card-row">
      <div class="card-label">Gate verdict</div>
      <div class="card-value">
        {p.pollinatorVerdict ? VERDICT_LABEL[p.pollinatorVerdict] : '—'}
      </div>
    </div>
    {#if !p.bloomStatus && !p.pollinatorVerdict}
      <p class="card-note">Recorded before bloom attestation was stored (#130).</p>
    {/if}
  </section>
{/if}

<section class="card">
  <h2 class="card-title">{tr('records.detail.detail')}</h2>
  <dl class="kv">
    {#each data.rows as row, i (i)}
      <dt>{row.label}</dt>
      <dd>
        {#if row.englishOnly}
          <span lang="en" data-english-only="safety">{row.value}</span>
        {:else if row.block}
          <span class="wrap">{row.value}</span>
        {:else}
          {row.value}
        {/if}
      </dd>
    {/each}
  </dl>
</section>

<details class="card technical" data-testid="record-technical">
  <summary class="card-title">{tr('records.field.technical')}</summary>
  <p class="card-note">{tr('records.field.technicalHint')}</p>
  <dl class="kv">
    <dt>{tr('records.detail.rowId')}</dt>
    <dd><span class="mono">{data.rowId}</span></dd>
    {#each data.technical as row, i (i)}
      <dt>{row.label}</dt>
      <dd>
        {#if row.block}
          <pre class="mono">{row.value}</pre>
        {:else}
          <span class="mono">{row.value}</span>
        {/if}
      </dd>
    {/each}
  </dl>
</details>

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
  .card-note {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--color-ink-muted, #7a7f75);
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
  .wrap {
    white-space: pre-wrap;
  }
  .technical summary {
    cursor: pointer;
    min-height: 48px;
    display: flex;
    align-items: center;
    margin: 0;
  }
  .kv dd {
    overflow-wrap: anywhere;
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }
</style>
