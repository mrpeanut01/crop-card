<script lang="ts">
  import { User, Shield, RefreshCw, LogOut } from 'lucide-svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';

  let { data } = $props();
</script>

<svelte:head>
  <title>Account · CropCard</title>
</svelte:head>

<a class="back-link" href="/settings">← All settings</a>
<header class="page-head">
  <Kicker>Account · sign-in</Kicker>
  <h1>Account & sign-in</h1>
</header>

<section class="card">
  <div class="card-row">
    <div class="icon" aria-hidden="true"><User size={20} /></div>
    <div class="body">
      <div class="label">Email</div>
      <div class="value mono">{data.user.email}</div>
    </div>
  </div>

  <div class="card-row">
    <div class="icon" aria-hidden="true"><Shield size={20} /></div>
    <div class="body">
      <div class="label">Role within {data.activeOwner?.name ?? 'this owner'}</div>
      <div class="value">
        {data.user.role}
        {#if data.user.isSuperadmin}
          <Pill tone="rust">superadmin</Pill>
        {/if}
        {#if data.user.impersonating}
          <Pill tone="wheat">impersonating</Pill>
        {/if}
      </div>
    </div>
  </div>

  {#if data.activeOwner}
    <div class="card-row">
      <div class="icon" aria-hidden="true"><RefreshCw size={20} /></div>
      <div class="body">
        <div class="label">Active owner</div>
        <div class="value">
          {data.activeOwner.name} <span class="mono">({data.activeOwner.slug})</span>
        </div>
        {#if data.otherOwnerCount > 0}
          <p class="hint">
            You have access to {data.otherOwnerCount} other owner{data.otherOwnerCount === 1
              ? ''
              : 's'}.
            <a href="/owner-picker">Switch owner →</a>
          </p>
        {/if}
      </div>
    </div>
  {/if}
</section>

<section class="card actions">
  <h2>Sign out</h2>
  <p class="lede">
    Signing out clears your session cookie. You'll land on the sign-in page next visit.
  </p>
  <form method="POST" action="/signout">
    <button type="submit" class="danger">
      <LogOut size={16} strokeWidth={1.75} />
      Sign out
    </button>
  </form>
</section>

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
    margin: 4px 0 16px;
    font-family: var(--font-serif, serif);
    font-size: 26px;
    color: var(--color-forest-deep);
  }
  .card {
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card, 8px);
    padding: 18px;
    margin-bottom: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .card-row {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  .icon {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-input, 6px);
    background: rgba(44, 82, 55, 0.06);
    color: var(--color-forest-deep);
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .body {
    min-width: 0;
    flex: 1;
  }
  .label {
    font-size: 11.5px;
    color: var(--color-ink-muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 700;
  }
  .value {
    font-size: 14.5px;
    color: var(--color-ink);
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .mono {
    font-family: var(--font-mono, monospace);
    font-size: 13px;
  }
  .hint {
    margin: 6px 0 0;
    font-size: 12.5px;
    color: var(--color-ink-soft);
  }
  .actions h2 {
    margin: 0 0 6px;
    font-size: 16px;
    color: var(--color-ink);
  }
  .lede {
    margin: 0 0 12px;
    font-size: 13px;
    color: var(--color-ink-soft);
  }
  .danger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--color-rust, #ba4b38);
    color: var(--color-paper);
    border: 0;
    padding: 9px 18px;
    border-radius: var(--radius-input, 6px);
    font-family: inherit;
    font-size: 13.5px;
    font-weight: 600;
    cursor: pointer;
    min-height: 38px;
  }
  .danger:hover {
    filter: brightness(0.95);
  }
</style>
