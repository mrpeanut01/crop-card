<script lang="ts">
  import { Settings, Tag, Box, Key, AlertTriangle } from 'lucide-svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';

  let { data } = $props();
</script>

<svelte:head>
  <title>Advanced & export-all · CropCard</title>
</svelte:head>

<a class="back-link" href="/settings">← All settings</a>
<header class="page-head">
  <Kicker>Power tools · maintenance</Kicker>
  <h1>Advanced & export-all</h1>
  <p class="lede">
    Operations the typical farm-day operator never touches: taxonomy curation, inventory
    maintenance, API tokens, and the danger zone. Each links into the form where the action
    actually happens.
  </p>
</header>

<ul class="link-list">
  <li>
    <a class="link-card" href="/settings/api-tokens">
      <div class="icon"><Key size={20} strokeWidth={1.75} /></div>
      <div class="body">
        <span class="title">API tokens</span>
        <span class="sub">
          {data.apiTokenCount} token{data.apiTokenCount === 1 ? '' : 's'} active. Bearer-auth
          surface for external agents.
        </span>
      </div>
    </a>
  </li>
  <li>
    <a class="link-card" href="/settings/system#types">
      <div class="icon"><Tag size={20} strokeWidth={1.75} /></div>
      <div class="body">
        <span class="title">Types taxonomy</span>
        <span class="sub">
          Categories for inventory, equipment, and tasks. Used by the spray + harvest UIs to
          group rows.
        </span>
      </div>
    </a>
  </li>
  <li>
    <a class="link-card" href="/settings/system#inventory">
      <div class="icon"><Box size={20} strokeWidth={1.75} /></div>
      <div class="body">
        <span class="title">Inventory maintenance</span>
        <span class="sub">
          Regenerate short names across {data.stockItemCount} stock item{data.stockItemCount ===
          1
            ? ''
            : 's'}. Refresh AI-derived metadata for incomplete entries.
        </span>
      </div>
    </a>
  </li>
  <li>
    <a class="link-card danger" href="/settings/system#danger">
      <div class="icon"><AlertTriangle size={20} strokeWidth={1.75} /></div>
      <div class="body">
        <span class="title">Danger zone</span>
        <span class="sub">
          Wipe-and-restart actions. These are intentionally hard to reach — the form requires
          typed confirmations.
        </span>
      </div>
    </a>
  </li>
  <li>
    <a class="link-card subtle" href="/settings/system">
      <div class="icon"><Settings size={20} strokeWidth={1.75} /></div>
      <div class="body">
        <span class="title">Legacy tabbed page</span>
        <span class="sub">
          The pre-Phase-25c monolith — all the above tabs in one place. Sticks around until each
          tab fully migrates to its own subroute.
        </span>
      </div>
    </a>
  </li>
</ul>

<style>
  .back-link {
    display: inline-block;
    margin-bottom: 12px;
    font-size: 13px;
    color: var(--color-forest-deep);
    text-decoration: none;
  }
  .back-link:hover {
    text-decoration: underline;
  }
  .page-head h1 {
    margin: 4px 0 8px;
    font-family: var(--font-serif, serif);
    font-size: 26px;
    color: var(--color-forest-deep);
  }
  .lede {
    margin: 0 0 18px;
    font-size: 13.5px;
    color: var(--color-ink-soft);
    line-height: 1.5;
    max-width: 60ch;
  }
  .link-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .link-card {
    display: flex;
    gap: 12px;
    padding: 14px 16px;
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card, 8px);
    text-decoration: none;
    color: var(--color-ink);
  }
  .link-card:hover {
    border-color: var(--color-forest-deep);
  }
  .link-card.danger {
    border-left: 3px solid var(--color-rust, #ba4b38);
  }
  .link-card.danger:hover {
    border-color: var(--color-rust, #ba4b38);
  }
  .link-card.danger .icon {
    background: rgba(186, 75, 56, 0.08);
    color: var(--color-rust, #ba4b38);
  }
  .link-card.subtle {
    background: var(--color-cream);
    border-style: dashed;
  }
  .icon {
    width: 40px;
    height: 40px;
    border-radius: var(--radius-input, 6px);
    background: rgba(44, 82, 55, 0.06);
    color: var(--color-forest-deep);
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .title {
    font-size: 14.5px;
    font-weight: 700;
    color: var(--color-ink);
  }
  .sub {
    font-size: 12.5px;
    color: var(--color-ink-soft);
    line-height: 1.4;
  }
</style>
