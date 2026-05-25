<script lang="ts">
  import { Plus } from 'lucide-svelte';
  import SettingsShell from '$lib/components/settings/SettingsShell.svelte';
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const ROLE_META = [
    {
      role: 'owner',
      label: 'Owner',
      blurb: 'Full edit. Manages safety bypasses + billing.',
      tone: 'forest' as const
    },
    {
      role: 'helper',
      label: 'Helper',
      blurb: 'Spray + scout + harvest. No bypasses. No billing.',
      tone: 'sky' as const
    },
    {
      role: 'inspector',
      label: 'Inspector',
      blurb: 'Read-only · time-boxed link · no login.',
      tone: 'wheat' as const
    }
  ];

  const roleCounts = $derived(
    ROLE_META.map((r) => ({
      ...r,
      count: data.members.filter((m) => m.roleWithinOwner === r.role && m.status === 'active')
        .length
    }))
  );

  const activeMembers = $derived(
    data.members.filter((m) => m.status === 'active' && m.roleWithinOwner !== 'owner')
  );
  const pendingInvites = $derived(data.invites.filter((i) => i.status === 'pending'));

  let showInviteForm = $state(false);
  let inviteEmail = $state('');
  let inviteRole = $state<'helper' | 'inspector' | 'custom-operator'>('helper');
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
      {#each roleCounts as r (r.role)}
        <div class="role-card">
          <div class="role-head">
            <span class="role-label">{r.label}</span>
            <span class="role-count mono" data-tone={r.tone}>{r.count}</span>
          </div>
          <p class="role-blurb">{r.blurb}</p>
        </div>
      {/each}
    </div>
  </SettingsSection>

  <SettingsSection title={`Active helpers · ${activeMembers.length}`}>
    {#snippet right()}
      <button type="button" class="primary-sm" onclick={() => (showInviteForm = !showInviteForm)}>
        <Plus size={11} /> Invite helper
      </button>
    {/snippet}

    {#if showInviteForm}
      <form method="POST" action="?/invite" class="invite-form">
        <label class="iv-field">
          <span>Email</span>
          <input type="email" name="email" bind:value={inviteEmail} required class="s-input" />
        </label>
        <label class="iv-field">
          <span>Role</span>
          <select name="role" bind:value={inviteRole} class="s-input">
            <option value="helper">Helper</option>
            <option value="inspector">Inspector</option>
            <option value="custom-operator">Custom operator</option>
          </select>
        </label>
        <button type="submit" class="primary-sm">Send invite</button>
      </form>
      {#if form && 'error' in form && form.error}
        <p class="err">{form.error}</p>
      {/if}
      {#if form && 'acceptUrl' in form && form.acceptUrl}
        <p class="ok">Invite sent. Accept URL: <span class="mono">{form.acceptUrl}</span></p>
      {/if}
    {/if}

    {#if activeMembers.length === 0}
      <p class="empty">No helpers yet. Click "Invite helper" to send the first invite.</p>
    {/if}
    {#each activeMembers as m (m.userId)}
      <div class="row member">
        <div class="avatar">{m.email.charAt(0).toUpperCase()}</div>
        <div class="row-text">
          <div class="row-title">{m.email}</div>
        </div>
        <Pill tone="sky">{m.roleWithinOwner}</Pill>
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
            email hashed (SHA-256) · sent {new Date(inv.createdAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric'
            })}
          </div>
        </div>
        <Pill tone="wheat">{inv.roleWithinOwner}</Pill>
        <span class="expires mono">
          expires {new Date(inv.expiresAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
          })}
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
    grid-template-columns: repeat(3, 1fr);
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
  .role-count[data-tone='wheat'] {
    color: var(--color-wheat, #d4a75c);
  }
  .role-blurb {
    margin: 4px 0 0;
    font-size: 11.5px;
    color: var(--color-ink-soft);
    line-height: 1.45;
  }

  .invite-form {
    display: grid;
    grid-template-columns: 2fr 1fr auto;
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
  .avatar {
    width: 36px;
    height: 36px;
    border-radius: 999px;
    background: #6f8fa8;
    color: var(--color-cream, #f8f3e8);
    display: grid;
    place-items: center;
    font-weight: 700;
    font-size: 14px;
    font-family: var(--font-serif, serif);
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
