<script lang="ts">
  import { page } from '$app/state';
  import { LOCALE_NAMES, createT, isKnownLocale, type Locale } from '$lib/i18n';

  interface Props {
    /** Reload after saving so the page, `<html lang>` and the offline cache all follow. */
    onChanged?: () => void;
  }

  const { onChanged = () => window.location.reload() }: Props = $props();

  const tr = $derived(createT(page.data?.locale));
  const current = $derived(isKnownLocale(page.data?.locale) ? page.data.locale : 'en');
  const choices = $derived((page.data?.locales ?? []).filter(isKnownLocale) as Locale[]);

  let busy = $state(false);
  let failed = $state(false);

  async function choose(locale: Locale) {
    if (busy || locale === current) return;
    busy = true;
    failed = false;
    try {
      const res = await fetch('/api/me/locale', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale })
      });
      if (!res.ok) throw new Error(String(res.status));
      onChanged();
    } catch {
      failed = true;
      busy = false;
    }
  }
</script>

{#if choices.length > 1}
  <div class="lang" role="group" aria-label={tr('nav.language')}>
    {#each choices as l (l)}
      <button
        type="button"
        class="mono"
        class:on={l === current}
        aria-pressed={l === current}
        lang={l}
        title={LOCALE_NAMES[l]}
        aria-label={LOCALE_NAMES[l]}
        disabled={busy}
        onclick={() => choose(l)}>{l.toUpperCase()}</button
      >
    {/each}
    {#if failed}
      <span class="sr-only" role="alert">{tr('nav.languageFailed')}</span>
    {/if}
  </div>
{/if}

<style>
  .lang {
    display: inline-flex;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    overflow: hidden;
  }
  button {
    min-width: 44px;
    min-height: 48px;
    padding: 0 10px;
    background: transparent;
    color: inherit;
    border: 0;
    font-size: 12px;
    letter-spacing: 0.06em;
    cursor: pointer;
  }
  button.on {
    background: var(--color-forest-deep);
    color: var(--color-paper);
    font-weight: 700;
  }
  button:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: -3px;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
</style>
