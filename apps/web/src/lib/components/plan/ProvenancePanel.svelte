<script lang="ts">
  import { Sparkles, Pencil, Sprout } from 'lucide-svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';

  /**
   * Phase 25d (#89, #81) — provenance panel for the Plan v2 view.
   * Shows the chain of revisions for the active plan so the operator
   * sees where the current state came from (wizard? AI refinement?
   * manual edit?).
   *
   * Pure presentational — Plan v2 loader queries `listPlanRevisions`
   * + passes the result here. Empty list = the plan was constructed
   * pre-#89 (no revision tracking back then) → render an empty-state
   * card with the "Future revisions will be tracked" hint.
   *
   * Each revision maps to a `<Provenance>` source:
   *   wizard         → plugin (deterministic wizard fallback)
   *   manual         → manual
   *   ai-refinement  → ai
   */

  export type RevisionSource = 'wizard' | 'manual' | 'ai-refinement';

  export interface RevisionEntry {
    id: string;
    revisionNumber: number;
    source: RevisionSource;
    createdAt: number;
    createdByEmail?: string;
    note?: string;
  }

  interface Props {
    revisions: RevisionEntry[];
    /** Optional plan id label for the kicker. */
    planLabel?: string;
  }

  const { revisions, planLabel }: Props = $props();

  function sourceToProv(s: RevisionSource): 'plugin' | 'manual' | 'ai' {
    switch (s) {
      case 'wizard':
        return 'plugin';
      case 'manual':
        return 'manual';
      case 'ai-refinement':
        return 'ai';
    }
  }

  function sourceIcon(s: RevisionSource) {
    switch (s) {
      case 'wizard':
        return Sprout;
      case 'manual':
        return Pencil;
      case 'ai-refinement':
        return Sparkles;
    }
  }

  function whenLabel(ms: number): string {
    const diff = Date.now() - ms;
    const hours = Math.floor(diff / 3_600_000);
    if (hours < 1) return 'just now';
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(ms).toLocaleDateString();
  }
</script>

<section class="panel" aria-labelledby="provenance-heading">
  <header>
    <div class="kicker">
      Where this plan came from{#if planLabel}
        · {planLabel}{/if}
    </div>
    <h3 id="provenance-heading" class="serif">Revisions</h3>
  </header>

  {#if revisions.length === 0}
    <p class="empty">
      No revision history yet. New plan-commits, wizard refinements, and manual edits will appear
      here automatically.
    </p>
  {:else}
    <ol class="rev-list">
      {#each revisions as r (r.id)}
        {@const Icon = sourceIcon(r.source)}
        <li>
          <div class="rev-marker" aria-hidden="true">
            <Icon size={11} strokeWidth={1.75} />
          </div>
          <div class="rev-body">
            <div class="rev-head">
              <span class="rev-num mono">#{r.revisionNumber}</span>
              <Provenance source={sourceToProv(r.source)} />
              <span class="rev-when">{whenLabel(r.createdAt)}</span>
            </div>
            {#if r.note}
              <p class="rev-note">{r.note}</p>
            {/if}
            {#if r.createdByEmail}
              <p class="rev-by">by {r.createdByEmail}</p>
            {/if}
          </div>
        </li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  .panel {
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card, 8px);
    padding: 14px 18px;
  }
  header {
    margin-bottom: 12px;
  }
  .kicker {
    font-size: 10.5px;
    color: var(--color-ink-muted);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    font-weight: 700;
  }
  h3 {
    margin: 2px 0 0;
    font-size: var(--font-size-card-title);
    color: var(--color-forest-deep);
    letter-spacing: var(--letter-tight);
  }
  .empty {
    font-size: 13px;
    color: var(--color-ink-soft);
    line-height: 1.5;
    margin: 0;
    font-style: italic;
  }
  .rev-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .rev-list li {
    display: flex;
    gap: 10px;
    padding: 10px 12px;
    background: var(--color-cream);
    border: 1px solid var(--color-divider-soft);
    border-radius: var(--radius-input, 6px);
  }
  .rev-marker {
    width: 24px;
    height: 24px;
    border-radius: 999px;
    background: var(--color-paper);
    color: var(--color-ink-soft);
    display: grid;
    place-items: center;
    flex-shrink: 0;
    border: 1px solid var(--color-divider);
  }
  .rev-body {
    flex: 1;
    min-width: 0;
  }
  .rev-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .rev-num {
    font-size: 12px;
    color: var(--color-ink);
    font-weight: 700;
  }
  .rev-when {
    margin-left: auto;
    font-size: 11.5px;
    color: var(--color-ink-muted);
    font-style: italic;
  }
  .rev-note {
    margin: 4px 0 0;
    font-size: 12.5px;
    color: var(--color-ink-soft);
    line-height: 1.4;
  }
  .rev-by {
    margin: 2px 0 0;
    font-size: 11px;
    color: var(--color-ink-muted);
  }
</style>
