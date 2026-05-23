<script lang="ts">
  import type { PluginDiff } from '$lib/plugins/diff';

  type TimelineRow = {
    id: string;
    version: string;
    hash: string;
    changedByEmail?: string;
    changeReason?: string;
    diffSummary?: PluginDiff;
    createdAt: number;
    supersededAt?: number | null;
    retiredAt?: number | null;
  };

  let {
    rows,
    canRollback = false,
    onRollback
  }: {
    rows: TimelineRow[];
    canRollback?: boolean;
    onRollback?: (version: string) => void;
  } = $props();

  function formatDate(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
  }

  function isCurrent(row: TimelineRow): boolean {
    return !row.supersededAt;
  }

  function diffSummary(d: PluginDiff | undefined): string | null {
    if (!d) return null;
    const a = d.addedKeys.length;
    const r = d.removedKeys.length;
    const c = d.changedKeys.length;
    if (a + r + c === 0) return null;
    const parts = [];
    if (a) parts.push(`+${a}`);
    if (r) parts.push(`−${r}`);
    if (c) parts.push(`~${c}`);
    return parts.join(' ');
  }

  function diffTitle(d: PluginDiff | undefined): string {
    if (!d) return '';
    const lines: string[] = [];
    if (d.addedKeys.length) lines.push(`Added:\n  ${d.addedKeys.join('\n  ')}`);
    if (d.removedKeys.length) lines.push(`Removed:\n  ${d.removedKeys.join('\n  ')}`);
    if (d.changedKeys.length) lines.push(`Changed:\n  ${d.changedKeys.join('\n  ')}`);
    return lines.join('\n\n');
  }
</script>

<ul class="timeline">
  {#each rows as row (row.id)}
    <li class:current={isCurrent(row)} class:retired={!!row.retiredAt}>
      <span class="version">v{row.version}</span>
      {#if isCurrent(row)}<span class="chip current-chip">current</span>{/if}
      {#if row.retiredAt}<span class="chip retired-chip">retired</span>{/if}
      <span class="when">{formatDate(row.createdAt)}</span>
      {#if row.changedByEmail}<span class="who">{row.changedByEmail}</span>{/if}
      {#if diffSummary(row.diffSummary)}
        <span class="diff" title={diffTitle(row.diffSummary)}>{diffSummary(row.diffSummary)}</span>
      {/if}
      {#if row.changeReason}
        <span class="reason" title={row.changeReason}>{row.changeReason}</span>
      {:else if !diffSummary(row.diffSummary)}
        <span class="reason muted">initial import</span>
      {/if}
      <code class="hash" title={`SHA-256: ${row.hash}`}>{row.hash.slice(0, 8)}</code>
      {#if canRollback && !isCurrent(row) && onRollback}
        <button class="link" onclick={() => onRollback?.(row.version)}>Rollback</button>
      {/if}
    </li>
  {/each}
</ul>

<style>
  .timeline {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .timeline li {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.45rem 0.75rem;
    border-bottom: 1px solid #eee;
    font-size: 0.85rem;
    flex-wrap: nowrap;
    overflow: hidden;
  }
  .timeline li:last-child {
    border-bottom: 0;
  }
  .timeline li.current {
    background: #f3f9f5;
    border-left: 3px solid #1f5e3a;
    padding-left: calc(0.75rem - 3px);
  }
  .timeline li.retired {
    opacity: 0.7;
  }
  .version {
    font-weight: 700;
    color: #1f5e3a;
    flex: 0 0 auto;
    min-width: 4ch;
  }
  .chip {
    font-size: 0.65rem;
    padding: 0.05rem 0.35rem;
    border-radius: 3px;
    background: #eee;
    color: #333;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    flex: 0 0 auto;
  }
  .current-chip {
    background: #1f5e3a;
    color: white;
  }
  .retired-chip {
    background: #b00020;
    color: white;
  }
  .when {
    color: #777;
    flex: 0 0 auto;
    font-variant-numeric: tabular-nums;
  }
  .who {
    color: #555;
    flex: 0 0 auto;
    max-width: 18ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .diff {
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
    color: #8a5a00;
    background: #fff4d8;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    flex: 0 0 auto;
    cursor: help;
  }
  .reason {
    color: #444;
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .reason.muted {
    color: #888;
    font-style: italic;
  }
  .hash {
    color: #888;
    font-size: 0.78rem;
    flex: 0 0 auto;
    font-family: ui-monospace, monospace;
  }
  .link {
    background: none;
    border: 0;
    color: #1f5e3a;
    text-decoration: underline;
    cursor: pointer;
    padding: 0;
    font: inherit;
    font-size: 0.85rem;
    flex: 0 0 auto;
  }
</style>
