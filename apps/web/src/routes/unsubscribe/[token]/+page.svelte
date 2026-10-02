<script lang="ts">
  import { emailAlertLabel, type EmailAlertCategory } from '$lib/email/alertCategories';
  import type { ActionData, PageData } from './$types';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  const { data, form }: { data: PageData; form: ActionData } = $props();
  const tr = $derived(createT(page.data?.locale));

  const farm = $derived((data.status === 'ready' && data.farmName) || tr('entry.unsub.thisFarm'));
  const scopeLabel = $derived(
    data.status === 'ready' && data.scope !== 'all'
      ? tr('entry.unsub.scopeOne', {
          label: emailAlertLabel(data.scope as EmailAlertCategory, page.data?.locale)
        })
      : tr('entry.unsub.scopeAll')
  );
  const alreadyOff = $derived(
    data.status === 'ready' &&
      (data.scope === 'all'
        ? !Object.values(data.prefs).some(Boolean)
        : !data.prefs[data.scope as EmailAlertCategory])
  );
  const turnedOff = $derived<EmailAlertCategory[]>(
    form && 'done' in form && form.done === 'unsubscribed'
      ? (form.turnedOff as EmailAlertCategory[])
      : []
  );
  const restorable = $derived<EmailAlertCategory[]>(
    turnedOff.length > 0
      ? turnedOff
      : data.status === 'ready' && data.scope !== 'all'
        ? [data.scope as EmailAlertCategory]
        : []
  );
  const done = $derived(form && 'done' in form ? form.done : null);
</script>

<svelte:head><title>{tr('entry.unsub.title')}</title></svelte:head>

<section class="card" aria-labelledby="unsub-title">
  {#if data.status !== 'ready'}
    <h1 id="unsub-title">{tr('entry.unsub.unusable')}</h1>
    <p role="alert">
      {tr('entry.unsub.invalidBody')}
    </p>
    <a class="ghost" href="/settings/notifications">{tr('entry.unsub.openSettings')}</a>
  {:else if done === 'resubscribed' && form && 'turnedOn' in form}
    <h1 id="unsub-title">{tr('entry.unsub.backOn')}</h1>
    <p role="status">{tr('entry.unsub.backOnBody', { farm })}</p>
    <ul>
      {#each form.turnedOn as c (c)}<li>
          {emailAlertLabel(c as EmailAlertCategory, page.data?.locale)}
        </li>{/each}
    </ul>
    <a class="ghost" href="/settings/notifications">{tr('entry.unsub.manage')}</a>
  {:else if done === 'unsubscribed'}
    <h1 id="unsub-title">{tr('entry.unsub.done')}</h1>
    {#if turnedOff.length > 0}
      <p role="status">{tr('entry.unsub.turnedOff', { farm })}</p>
      <ul>
        {#each turnedOff as c (c)}<li>{emailAlertLabel(c, page.data?.locale)}</li>{/each}
      </ul>
    {:else}
      <p role="status">{tr('entry.unsub.alreadyOff')}</p>
    {/if}
    <p class="hint">
      {tr('entry.unsub.pushNote')}
    </p>
    {#if form && 'error' in form && form.error}
      <p class="error" role="alert">{form.error}</p>
    {/if}
    {#if data.isMember && restorable.length > 0}
      <form method="POST" action="?/resubscribe">
        {#each restorable as c (c)}<input type="hidden" name="category" value={c} />{/each}
        <button class="secondary" type="submit">{tr('entry.unsub.undo')}</button>
      </form>
    {/if}
    <a class="ghost" href="/settings/notifications">{tr('entry.unsub.manage')}</a>
  {:else}
    <h1 id="unsub-title">{tr('entry.unsub.stop')}</h1>
    <p>
      {tr('entry.unsub.turnsOffPre')}{scopeLabel}{tr('entry.unsub.turnsOffMid')}<strong
        >{farm}</strong
      >.
    </p>
    {#if alreadyOff}
      <p class="hint" role="status">{tr('entry.unsub.nowOff')}</p>
    {/if}
    {#if form && 'error' in form && form.error}
      <p class="error" role="alert">{form.error}</p>
      {#if 'signIn' in form && form.signIn}
        <a class="ghost" href="/settings/notifications">{tr('entry.unsub.openSettings')}</a>
      {/if}
    {/if}
    <form method="POST" action="?/unsubscribe">
      <button class="primary" type="submit">{tr('entry.unsub.submit')}</button>
    </form>
    {#if data.scope !== 'all'}
      <form method="POST" action="?/unsubscribe">
        <input type="hidden" name="everything" value="1" />
        <button class="secondary" type="submit">{tr('entry.unsub.everything')}</button>
      </form>
    {/if}
    <p class="hint">{tr('entry.unsub.noSignIn')}</p>
  {/if}
</section>

<style>
  .card {
    box-sizing: border-box;
    width: calc(100% - 32px);
    max-width: 460px;
    margin: 48px auto;
    padding: 28px 24px;
    background: var(--color-paper, #fff);
    border: 1px solid var(--color-divider, #d9ddd5);
    border-radius: 12px;
    display: grid;
    gap: 1rem;
  }
  h1 {
    margin: 0;
    font-size: 1.5rem;
    color: var(--color-ink, #1d2420);
  }
  p,
  li {
    margin: 0;
    line-height: 1.5;
    color: var(--color-ink-soft, #3d4742);
    overflow-wrap: anywhere;
  }
  ul {
    margin: 0;
    padding-left: 1.25rem;
    display: grid;
    gap: 0.25rem;
  }
  form {
    display: grid;
  }
  .primary,
  .secondary {
    min-height: 48px;
    padding: 0.75rem 1.25rem;
    border-radius: 0.5rem;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .primary {
    background: var(--color-forest, #1f5e3a);
    color: #fff;
    border: none;
  }
  .secondary {
    background: var(--color-paper, #fff);
    color: var(--color-ink, #1d2420);
    border: 1px solid var(--color-divider, #c9d2c9);
  }
  .ghost {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    color: var(--color-forest, #1f5e3a);
    font-weight: 600;
    text-decoration: none;
  }
  .error {
    background: #fdecec;
    border: 1px solid #e3a8a8;
    color: #6b1717;
    padding: 0.625rem 0.875rem;
    border-radius: 0.375rem;
  }
  .hint {
    font-size: 0.875rem;
  }
</style>
