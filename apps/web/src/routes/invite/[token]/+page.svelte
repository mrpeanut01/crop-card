<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // #333 — surface the specific redemption failure so the helper knows
  // whether to ask for a fresh link, sign in under a different email, or
  // just log in. `reason` is only present on the invalid branch.
  const INVALID_COPY = {
    expired: {
      title: 'This invite has expired',
      hint: 'Invite links are valid for 7 days. Ask the farm owner to send a fresh one.'
    },
    revoked: {
      title: 'This invite was revoked',
      hint: 'The farm owner cancelled this invite. Ask them to send a new one if you still need access.'
    },
    accepted: {
      title: 'This invite was already used',
      hint: 'You (or someone on this email) already accepted it. Just sign in to reach the farm.'
    },
    'not-found': {
      title: 'Invite no longer valid',
      hint: "This link doesn't match your signed-in email, or it never existed. Check you're signed in under the address the invite was sent to, or ask for a fresh invite."
    }
  } as const;
  const invalid = $derived(
    data.status === 'invalid' ? INVALID_COPY[data.reason ?? 'not-found'] : null
  );
</script>

<svelte:head>
  <title>Accept invite — CropCard</title>
</svelte:head>

<main class="invite">
  {#if data.status === 'invalid'}
    <h1>{invalid?.title}</h1>
    <p class="hint">{invalid?.hint}</p>
    <a href="/today" class="back">← Back</a>
  {:else}
    <h1>Join {data.ownerName}</h1>
    <p class="hint">
      You've been invited to act as a <strong>{data.roleWithinOwner}</strong> on
      <strong>{data.ownerName}</strong>.
    </p>
    <form method="POST" action="?/accept" use:enhance>
      <button class="accept" type="submit">Accept invite →</button>
    </form>
    <p class="expires">
      Expires {new Date(data.expiresAt).toLocaleString()}.
    </p>
  {/if}
</main>

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
