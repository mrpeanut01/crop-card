<script lang="ts">
  import { enhance } from '$app/forms';
  import { fmt } from '$lib/prefsState.svelte';
  import type { PageData } from './$types';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  let { data }: { data: PageData } = $props();
  const tr = $derived(createT(page.data?.locale));

  // #333 — surface the specific redemption failure so the helper knows
  // whether to ask for a fresh link, sign in under a different email, or
  // just log in. `reason` is only present on the invalid branch.
  const INVALID_COPY = $derived({
    expired: {
      title: tr('entry.invite.reason.expired.title'),
      hint: tr('entry.invite.reason.expired.hint')
    },
    revoked: {
      title: tr('entry.invite.reason.revoked.title'),
      hint: tr('entry.invite.reason.revoked.hint')
    },
    accepted: {
      title: tr('entry.invite.reason.accepted.title'),
      hint: tr('entry.invite.reason.accepted.hint')
    },
    'needs-email': {
      title: tr('entry.invite.reason.needsEmail.title'),
      hint: tr('entry.invite.reason.needsEmail.hint')
    },
    'not-found': {
      title: tr('entry.invite.reason.notFound.title'),
      hint: tr('entry.invite.reason.notFound.hint')
    }
  });
  const invalid = $derived(
    data.status === 'invalid' ? INVALID_COPY[data.reason ?? 'not-found'] : null
  );

  function roleLabel(role: string): string {
    if (role === 'owner') return tr('entry.role.owner');
    if (role === 'helper') return tr('entry.role.helper');
    if (role === 'inspector') return tr('entry.role.inspector');
    return role;
  }
</script>

<svelte:head>
  <title>{tr('entry.invite.title')}</title>
</svelte:head>

<div class="invite">
  {#if data.status === 'invalid'}
    <h1>{invalid?.title}</h1>
    <p class="hint">{invalid?.hint}</p>
    {#if data.reason === 'needs-email'}
      <a href="/settings/account" class="back">{tr('entry.invite.addEmail')}</a>
    {/if}
    <a href="/today" class="back">{tr('entry.invite.back')}</a>
  {:else}
    <h1>{tr('entry.invite.join', { name: data.ownerName })}</h1>
    <p class="hint">
      {tr('entry.invite.invitedPre')}<strong>{roleLabel(data.roleWithinOwner)}</strong>{tr(
        'entry.invite.invitedMid'
      )}<strong>{data.ownerName}</strong>.
    </p>
    <form method="POST" action="?/accept" use:enhance>
      <button class="accept" type="submit">{tr('entry.invite.accept')}</button>
    </form>
    <p class="expires">
      {tr('entry.invite.expires', {
        when: `${fmt.instant(data.expiresAt)} ${fmt.zone(data.expiresAt)}`
      })}
    </p>
  {/if}
</div>

<style>
  .invite {
    max-width: 32rem;
    margin: 4rem auto;
    padding: 1.5rem;
  }
  h1 {
    margin-top: 0;
  }
  .hint {
    color: var(--color-ink-muted);
    margin-bottom: 1.5rem;
  }
  .accept {
    min-height: 48px;
    padding: 0.75rem 1.25rem;
    background: var(--color-forest-deep);
    color: var(--color-paper);
    border: none;
    border-radius: var(--radius-input, 6px);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .accept:hover {
    filter: brightness(1.1);
  }
  .expires {
    color: var(--color-ink-muted);
    font-size: 0.875rem;
    margin-top: 1rem;
  }
  .back {
    color: var(--color-forest-deep);
  }
</style>
