<script lang="ts">
  import SettingsShell from '$lib/components/settings/SettingsShell.svelte';

  import { createT } from '$lib/i18n';

  let { data } = $props();

  const tr = $derived(createT(data.locale));
</script>

<svelte:head><title>{tr('settings.aiAbout.pageTitle')}</title></svelte:head>

<SettingsShell
  title={tr('settings.aiAbout.title')}
  kicker={tr('settings.aiAbout.kicker')}
  backHref="/today"
  hideFooter
>
  <div class="about" data-testid="assistant-about">
    <p class="lede">
      {tr('settings.aiAbout.lede')}
    </p>
    <ul>
      <li>{tr('settings.aiAbout.b1')}</li>
      <li>{tr('settings.aiAbout.b2')}</li>
      <li>{tr('settings.aiAbout.b3')}</li>
    </ul>

    {#if data.canDecide}
      <div class="actions">
        <form method="POST" action="?/skip">
          <button type="submit" class="primary">{tr('settings.aiAbout.skip')}</button>
        </form>
        <a class="secondary" href="/settings/ai">{tr('settings.aiAbout.setup')}</a>
      </div>
      {#if data.skipped}
        <p class="note" role="status">{tr('settings.aiAbout.skipped')}</p>
      {/if}
    {:else}
      <p class="note" role="note">{tr('settings.aiAbout.ownerDecides')}</p>
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
