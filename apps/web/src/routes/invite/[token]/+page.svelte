<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>Accept invite — CropCard</title>
</svelte:head>

<main class="invite">
  {#if data.status === 'invalid'}
    <h1>Invite no longer valid</h1>
    <p class="hint">
      This invite link has expired, been revoked, or doesn't match your email. Ask the farm owner to
      send a fresh invite.
    </p>
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
