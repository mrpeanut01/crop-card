<script lang="ts">
  import { Lock, FileText, Sparkles, Pencil, RefreshCw } from 'lucide-svelte';

  /**
   * Phase 25 v2-addendum stub (#90, fully implemented in #89).
   *
   * Single-line badge indicating where a pre-populated value came from.
   * Five sources, fixed contract — see
   * `docs/design/almanac/AI_PROVENANCE_ADDENDUM.md` and the canonical JSX
   * at `docs/design/almanac/direction-almanac-ai-provenance.jsx`
   * (PROV_SOURCES token table + A_Provenance component).
   *
   * Prop contract MUST match the spec so designer-shipped markup pastes
   * cleanly in #89. Do not rename or repurpose props.
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
  const META: Record<
    ProvenanceSource,
    { label: string; long: string; icon: LucideIcon; tone: string }
  > = {
    plugin: {
      label: 'Plugin',
      long: 'From a crop, input, or safety-kernel plugin',
      icon: Lock,
      tone: 'forest'
    },
    data: {
      label: 'Your data',
      long: 'Derived from your records — scout, calibration, prior season',
      icon: FileText,
      tone: 'sky'
    },
    ai: {
      label: 'AI',
      long: 'Claude proposed this · always editable · falls back when off',
      icon: Sparkles,
      tone: 'wheat'
    },
    manual: {
      label: 'You typed',
      long: 'Entered or edited by you · the safety kernel still checks it',
      icon: Pencil,
      tone: 'neutral'
    },
    fallback: {
      label: 'Fallback',
      long: 'AI was off or unavailable — used the deterministic default',
      icon: RefreshCw,
      tone: 'rust'
    }
  };

  const meta = $derived(META[source]);
  const showConf = $derived(source === 'ai' && typeof confidence === 'number');
  const confPct = $derived(
    typeof confidence === 'number' ? `${Math.round(confidence * 100)}%` : ''
  );
  const Icon = $derived(meta.icon);
  const titleText = $derived(
    `${meta.label} · ${meta.long}${detail ? ' · ' + detail : ''}${
      showConf ? ' · ' + confPct : ''
    }`
  );
</script>

<span class="prov {meta.tone}" class:compact title={titleText}>
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
  .forest {
    background: var(--pill-forest-bg);
    color: var(--pill-forest-fg);
    border-color: var(--pill-forest-bd);
  }
  .sky {
    background: var(--pill-sky-bg);
    color: var(--pill-sky-fg);
    border-color: var(--pill-sky-bd);
  }
  .wheat {
    background: var(--pill-wheat-bg);
    color: var(--pill-wheat-fg);
    border-color: var(--pill-wheat-bd);
  }
  .neutral {
    background: var(--pill-neutral-bg);
    color: var(--pill-neutral-fg);
    border-color: var(--pill-neutral-bd);
  }
  .rust {
    background: var(--pill-rust-bg);
    color: var(--pill-rust-fg);
    border-color: var(--pill-rust-bd);
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
