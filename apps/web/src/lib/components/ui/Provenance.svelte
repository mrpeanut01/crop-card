<script lang="ts">
  import { Lock, FileText, Sparkles, Pencil, RefreshCw } from 'lucide-svelte';
  import { PROVENANCE_LABEL, PROVENANCE_LONG } from '$lib/provenanceLabels';

  /**
   * Phase 25 v2 addendum (#89, prop contract first shipped under #90).
   *
   * Single-line badge indicating where a pre-populated value came from.
   * 1:1 port of the canonical `A_Provenance` component at
   * [`direction-almanac-ai-provenance.jsx`](../../../../../docs/design/almanac/direction-almanac-ai-provenance.jsx)
   * using `--prov-*` design tokens.
   *
   * Five sources per `PROV_SOURCES`:
   *   plugin   → forest tone, Lock      icon — deterministic plugin/kernel
   *   data     → sky tone,    FileText  icon — owner's records
   *   ai       → wheat tone,  Sparkles  icon — Claude proposal (+confidence)
   *   manual   → neutral,     Pencil    icon — user typed/edited
   *   fallback → rust tone,   RefreshCw icon — AI would-have, deterministic ran
   */

  type ProvenanceSource = 'plugin' | 'data' | 'ai' | 'manual' | 'fallback';

  interface Props {
    source: ProvenanceSource;
    /** Optional secondary text — e.g. "corn-bb · v1.4" or "your scout · May 24". */
    detail?: string;
    /** Icon-only variant for dense tables. */
    compact?: boolean;
    /** AI source only — 0..1. Renders as %. */
    confidence?: number;
    /** Overrides the chip label, e.g. reference data that is not the user's own. */
    label?: string;
    /** Overrides the tooltip explanation. */
    long?: string;
  }

  const { source, detail, compact = false, confidence, label, long }: Props = $props();

  type LucideIcon = typeof Lock;
  const ICON: Record<ProvenanceSource, LucideIcon> = {
    plugin: Lock,
    data: FileText,
    ai: Sparkles,
    manual: Pencil,
    fallback: RefreshCw
  };

  const meta = $derived({
    label: label ?? PROVENANCE_LABEL[source],
    long: long ?? PROVENANCE_LONG[source],
    icon: ICON[source]
  });
  const showConf = $derived(source === 'ai' && typeof confidence === 'number');
  const confPct = $derived(
    typeof confidence === 'number' ? `${Math.round(confidence * 100)}%` : ''
  );
  const Icon = $derived(meta.icon);
  const titleText = $derived(
    `${meta.label} · ${meta.long}${detail ? ' · ' + detail : ''}${showConf ? ' · ' + confPct : ''}`
  );
</script>

<span
  class="prov src-{source}"
  class:compact
  title={titleText}
  data-provenance={source}
  role="img"
  aria-label={titleText}
>
  <Icon size={compact ? 9 : 10} strokeWidth={1.75} />
  {#if !compact}<span class="label" aria-hidden="true">{meta.label}</span>{/if}
  {#if showConf}<span class="conf mono" aria-hidden="true">{confPct}</span>{/if}
  {#if !compact && detail}<span class="sep" aria-hidden="true">·</span><span
      class="detail"
      aria-hidden="true">{detail}</span
    >{/if}
</span>

<style>
  .prov {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
    border: 1px solid transparent;
    max-width: 100%;
    box-sizing: border-box;
  }
  .prov.compact {
    gap: 3px;
    padding: 1px 5px;
    font-size: 10px;
  }
  .src-plugin {
    background: var(--prov-plugin-bg);
    color: var(--prov-plugin-fg);
    border-color: var(--prov-plugin-bd);
  }
  .src-data {
    background: var(--prov-data-bg);
    color: var(--prov-data-fg);
    border-color: var(--prov-data-bd);
  }
  .src-ai {
    background: var(--prov-ai-bg);
    color: var(--prov-ai-fg);
    border-color: var(--prov-ai-bd);
  }
  .src-manual {
    background: var(--prov-manual-bg);
    color: var(--prov-manual-fg);
    border-color: var(--prov-manual-bd);
  }
  .src-fallback {
    background: var(--prov-fallback-bg);
    color: var(--prov-fallback-fg);
    border-color: var(--prov-fallback-bd);
  }
  .conf {
    font-size: 10px;
    font-weight: 600;
    opacity: 0.85;
  }
  .compact .conf {
    font-size: 9px;
  }
  .sep {
    opacity: 0.45;
  }
  .detail {
    min-width: 0;
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
    white-space: normal;
    overflow-wrap: anywhere;
  }
</style>
