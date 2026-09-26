<script lang="ts">
  import SettingsShell from '$lib/components/settings/SettingsShell.svelte';

  let { data } = $props();
</script>

<svelte:head><title>Planning assistant · CropCard</title></svelte:head>

<SettingsShell title="Planning assistant" kicker="Optional" backHref="/today" hideFooter>
  <div class="about" data-testid="assistant-about">
    <p class="lede">
      CropCard can ask Claude, an AI assistant, for planning ideas: which crop fits which spot, what
      to sow when, and how to read a product label from a photo.
    </p>
    <ul>
      <li>Everything in CropCard works without it. You won't lose anything by skipping.</li>
      <li>Suggestions are always marked as AI and you can change any of them.</li>
      <li>It needs an Anthropic account and key, which has its own small cost.</li>
    </ul>

    {#if data.canDecide}
      <div class="actions">
        <form method="POST" action="?/skip">
          <button type="submit" class="primary">Skip, everything works without it</button>
        </form>
        <a class="secondary" href="/settings/ai">Set it up</a>
      </div>
      {#if data.skipped}
        <p class="note" role="status">You skipped this. You can set it up here any time.</p>
      {/if}
    {:else}
      <p class="note" role="note">The farm owner decides whether to turn this on.</p>
    {/if}
  </div>
</SettingsShell>

<style>
  .about {
    max-width: 60ch;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .lede {
    margin: 0;
    color: var(--color-ink);
  }
  ul {
    margin: 0;
    padding-left: 1.2em;
    color: var(--color-ink-soft);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }
  .actions form {
    margin: 0;
  }
  .primary,
  .secondary {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    padding: 0 16px;
    border-radius: var(--radius-input);
    font: inherit;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
  }
  .primary {
    border: none;
    background: var(--color-forest);
    color: var(--color-cream);
  }
  .secondary {
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-forest-deep);
  }
  .note {
    margin: 0;
    color: var(--color-ink-soft);
  }
</style>
