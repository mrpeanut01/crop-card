<script lang="ts">
  import { Lock, FileText, Sparkles, Pencil, RefreshCw } from 'lucide-svelte';

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
  }

  const { source, detail, compact = false, confidence }: Props = $props();

  type LucideIcon = typeof Lock;
  const META: Record<ProvenanceSource, { label: string; long: string; icon: LucideIcon }> = {
    plugin: {
      label: 'Plugin',
      long: 'From a crop, input, or safety-kernel plugin',
      icon: Lock
    },
    data: {
      label: 'Your data',
      long: 'Derived from your records — scout, calibration, prior season',
      icon: FileText
    },
    ai: {
      label: 'AI',
      long: 'Claude proposed this · always editable · falls back when off',
      icon: Sparkles
    },
    manual: {
      label: 'You typed',
      long: 'Entered or edited by you · the safety kernel still checks it',
      icon: Pencil
    },
    fallback: {
      label: 'Fallback',
      long: 'AI was off or unavailable — used the deterministic default',
      icon: RefreshCw
    }
  };

  const meta = $derived(META[source]);
  const showConf = $derived(source === 'ai' && typeof confidence === 'number');
  const confPct = $derived(
    typeof confidence === 'number' ? `${Math.round(confidence * 100)}%` : ''
  );
  const Icon = $derived(meta.icon);
  const titleText = $derived(
    `${meta.label} · ${meta.long}${detail ? ' · ' + detail : ''}${showConf ? ' · ' + confPct : ''}`
  );
</script>

<span class="prov src-{source}" class:compact title={titleText} data-provenance={source}>
  <Icon size={compact ? 9 : 10} strokeWidth={1.75} />
  {#if !compact}<span class="label">{meta.label}</span>{/if}
  {#if showConf}<span class="conf mono">{confPct}</span>{/if}
  {#if !compact && detail}<span class="sep" aria-hidden="true">·</span><span class="detail"
      >{detail}</span
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
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
  }
</style>
