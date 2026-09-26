<script lang="ts">
  import { Plus } from 'lucide-svelte';
  import SettingsShell from '$lib/components/settings/SettingsShell.svelte';
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';
  import Avatar from '$lib/components/ui/Avatar.svelte';
  import { fmt } from '$lib/prefsState.svelte';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const activeOwners = $derived(
    data.members.filter((m) => m.status === 'active' && m.roleWithinOwner === 'owner')
  );
  const activeMembers = $derived(
    data.members.filter((m) => m.status === 'active' && m.roleWithinOwner !== 'owner')
  );
  const pendingInvites = $derived(data.invites.filter((i) => i.status === 'pending'));

  let showInviteForm = $state(false);
  let inviteEmail = $state('');
  let inviteEmailEl = $state<HTMLInputElement | null>(null);

  // #206 / CT-RS-005 — when the form opens, scroll it into view + focus
  // the first field. Without this, the form appears below the 844px
  // viewport edge and keyboard users get no signal that the click did
  // anything.
  $effect(() => {
    if (showInviteForm && inviteEmailEl) {
      inviteEmailEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      inviteEmailEl.focus();
    }
  });
</script>

<svelte:head><title>Helpers & invites · CropCard</title></svelte:head>

<SettingsShell title="Helpers & invites" kicker="Tenant access">
  {#snippet badge()}
    {#if pendingInvites.length > 0}
      <Pill tone="wheat">{pendingInvites.length} pending</Pill>
    {/if}
  {/snippet}

  <SettingsSection
    title="Roles"
    sub="Server-enforced. Helpers can't edit locked records or override custom rates."
  >
    <div class="role-grid">
      <div class="role-card">
        <div class="role-head">
          <span class="role-label">Owner</span>
          <span class="role-count mono" data-tone="forest">{activeOwners.length}</span>
        </div>
        <p class="role-blurb">Full edit. Manages safety bypasses, helpers and billing.</p>
      </div>
      <div class="role-card">
        <div class="role-head">
          <span class="role-label">Helper</span>
          <span class="role-count mono" data-tone="sky">{activeMembers.length}</span>
        </div>
        <p class="role-blurb">Spray, scout and harvest. No bypasses. No billing.</p>
      </div>
    </div>
  </SettingsSection>

  <SettingsSection
    title={`Active helpers · ${activeMembers.length}`}
    sub={`${data.seats.used} of ${data.seats.limit} helper seats in use, counting pending invites. Inspectors never take a seat.`}
  >
    {#snippet right()}
      <button
        type="button"
        class="primary-sm"
        disabled={!data.seats.canInvite}
        onclick={() => (showInviteForm = !showInviteForm)}
      >
        <Plus size={11} /> Invite helper
      </button>
    {/snippet}

    {#if !data.seats.canInvite}
      <div class="seat-limit" data-testid="seat-limit" role="status">
        <strong>Seat limit reached (grandfathered helpers stay active)</strong>
        <p>
          All {data.seats.limit} helper seats on your plan are in use. Everyone already on the farm keeps
          working and logging sprays. To invite someone new, revoke a pending invite or
          <a href="/settings/billing">move to a plan with more seats</a>.
        </p>
      </div>
    {/if}

    {#if showInviteForm && data.seats.canInvite}
      <form method="POST" action="?/invite" class="invite-form">
        <label class="iv-field">
          <span>Email</span>
          <input
            type="email"
            name="email"
            bind:value={inviteEmail}
            bind:this={inviteEmailEl}
            required
            class="s-input"
          />
        </label>
        <button type="submit" class="primary-sm">Send invite</button>
      </form>
      {#if form && 'error' in form && form.error}
        <p class="err">{form.error}</p>
      {/if}
      {#if form && 'acceptUrl' in form && form.acceptUrl}
        {#if 'emailSent' in form && form.emailSent === false}
          <p class="err" role="alert">
            Invite created, but the email could not be delivered. Send this link to your helper
            yourself: <span class="mono">{form.acceptUrl}</span>
          </p>
        {:else}
          <p class="ok">Invite sent. Accept URL: <span class="mono">{form.acceptUrl}</span></p>
        {/if}
      {/if}
    {/if}

    {#if activeMembers.length === 0}
      <p class="empty">No helpers yet. Click "Invite helper" to send the first invite.</p>
    {/if}
    {#each activeMembers as m (m.userId)}
      <div class="row member">
        <Avatar name={m.name} src={m.avatarUrl} size={36} />
        <div class="row-text">
          <div class="row-title">{m.name}</div>
          {#if m.name !== m.email}<div class="row-sub">{m.email}</div>{/if}
        </div>
        <Pill tone="sky">Helper</Pill>
        <form method="POST" action="?/remove">
          <input type="hidden" name="userId" value={m.userId} />
          <button type="submit" class="ghost-sm">Remove</button>
        </form>
      </div>
    {/each}
  </SettingsSection>

  <SettingsSection
    title={`Pending invites · ${pendingInvites.length}`}
    sub="Tokens are SHA-256 hashed in the DB. Plain token shows once at send."
  >
    {#if pendingInvites.length === 0}
      <p class="empty">No pending invites.</p>
    {/if}
    {#each pendingInvites as inv (inv.id)}
      <div class="invite-row">
        <div class="row-text">
          <div class="row-title mono">{inv.id}</div>
          <div class="row-sub mono">
            email hashed (SHA-256) · sent {fmt.instant(inv.createdAt, 'month-day')}
          </div>
        </div>
        <Pill tone="wheat">Helper</Pill>
        <span class="expires mono">
          expires {fmt.instant(inv.expiresAt, 'month-day')}
        </span>
        <form method="POST" action="?/revoke">
          <input type="hidden" name="inviteId" value={inv.id} />
          <button type="submit" class="ghost-sm rust">Revoke</button>
        </form>
      </div>
    {/each}
  </SettingsSection>
</SettingsShell>

<style>
  .role-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }
  .role-card {
    padding: 10px 12px;
    border: 1px solid var(--color-divider-soft, var(--color-divider));
    border-radius: 8px;
  }
  .role-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .role-label {
    font-size: 12.5px;
    color: var(--color-ink);
    font-weight: 700;
  }
  .role-count {
    font-size: 11px;
    font-weight: 700;
  }
  .role-count[data-tone='forest'] {
    color: var(--color-forest-deep);
  }
  .role-count[data-tone='sky'] {
    color: #6f8fa8;
  }
  .role-blurb {
    margin: 4px 0 0;
    font-size: 11.5px;
    color: var(--color-ink-soft);
    line-height: 1.45;
  }

  .seat-limit {
    margin: 0 0 12px;
    padding: 12px 14px;
    border-radius: 8px;
    background: #f3ead2;
    border: 1px solid #e0cf9f;
    color: #4a3b12;
    font-size: 13px;
    line-height: 1.5;
  }
  .seat-limit p {
    margin: 4px 0 0;
  }
  .seat-limit a {
    color: var(--color-forest-deep);
    font-weight: 600;
  }
  .invite-form {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 10px;
    align-items: end;
    margin-bottom: 14px;
    padding: 12px;
    background: var(--color-cream);
    border: 1px solid var(--color-divider-soft, var(--color-divider));
    border-radius: 8px;
  }
  .iv-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .iv-field > span {
    font-size: 11px;
    font-weight: 700;
    color: var(--color-ink-muted);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .err {
    margin: 0 0 12px;
    color: var(--color-rust, #ba4b38);
    font-size: 13px;
  }
  .ok {
    margin: 0 0 12px;
    color: var(--color-forest-deep);
    font-size: 13px;
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
  .s-input:focus {
    border-color: var(--color-forest-deep);
    box-shadow: 0 0 0 2px rgba(44, 82, 55, 0.15);
  }

  .row,
  .invite-row {
    padding: 10px 0;
    display: grid;
    gap: 12px;
    align-items: center;
    border-top: 1px solid var(--color-divider-soft, var(--color-divider));
  }
  .row:first-child {
    border-top: 0;
  }
  .row.member {
    grid-template-columns: auto 1fr auto auto;
  }
  .invite-row {
    grid-template-columns: 1fr auto auto auto;
    padding: 10px 12px;
    background: rgba(212, 167, 92, 0.08);
    border: 1px solid rgba(212, 167, 92, 0.3);
    border-radius: 8px;
    margin-top: 8px;
  }
  .invite-row:first-of-type {
    margin-top: 0;
  }
  .row-text {
    min-width: 0;
  }
  .row-title {
    font-size: 13px;
    color: var(--color-ink);
    font-weight: 600;
  }
  .row-sub {
    font-size: 11px;
    color: var(--color-ink-soft);
    margin-top: 2px;
  }
  .expires {
    font-size: 11px;
    color: var(--color-wheat, #d4a75c);
    font-weight: 600;
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .empty {
    margin: 0;
    color: var(--color-ink-soft);
    font-size: 13px;
    font-style: italic;
  }

  .primary-sm {
    background: var(--color-forest-deep);
    color: var(--color-paper);
    border: 0;
    padding: 6px 12px;
    border-radius: var(--radius-input, 6px);
    text-decoration: none;
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 32px;
  }
  .primary-sm:hover {
    filter: brightness(1.08);
  }
  .primary-sm:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ghost-sm {
    background: var(--color-paper);
    color: var(--color-ink);
    border: 1px solid var(--color-divider);
    padding: 5px 10px;
    border-radius: var(--radius-input, 6px);
    font-family: inherit;
    font-size: 11.5px;
    cursor: pointer;
  }
  .ghost-sm.rust {
    color: var(--color-rust, #ba4b38);
    border-color: rgba(186, 75, 56, 0.3);
  }
  .ghost-sm:hover {
    border-color: var(--color-forest-deep);
  }
  .ghost-sm.rust:hover {
    border-color: var(--color-rust, #ba4b38);
  }

  @media (max-width: 700px) {
    .role-grid {
      grid-template-columns: 1fr;
    }
    .invite-form {
      grid-template-columns: 1fr;
    }
  }
</style>
