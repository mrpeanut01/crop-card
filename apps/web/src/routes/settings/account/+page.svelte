<script lang="ts">
  import { browser } from '$app/environment';
  import { Lock, FileText } from 'lucide-svelte';
  import SettingsShell from '$lib/components/settings/SettingsShell.svelte';
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte';
  import SettingsField from '$lib/components/settings/SettingsField.svelte';
  import SignInMethods from '$lib/components/settings/SignInMethods.svelte';
  import AvatarUpload from '$lib/components/settings/AvatarUpload.svelte';
  import { DISPLAY_NAME_MAX, DISPLAY_UNITS, TIME_ZONES } from '$lib/profile';
  import Pill from '$lib/components/ui/Pill.svelte';
  import { createT, type MessageKey } from '$lib/i18n';
  import { localizedLine } from '$lib/components/billing/localize';

  const { data, form } = $props();

  const tr = $derived(createT(data.locale));
  const optionLabel = (
    prefix: 'settings.tz' | 'settings.units',
    o: { id: string; label: string }
  ) => localizedLine(tr, o.label, `${prefix}.${o.id}` as MessageKey);

  const timeZoneOptions = $derived(
    TIME_ZONES.some((tz) => tz.id === data.account.timeZone)
      ? TIME_ZONES
      : [{ id: data.account.timeZone, label: data.account.timeZone }, ...TIME_ZONES]
  );
</script>

<svelte:head><title>{tr('account.pageTitle')}</title></svelte:head>

<SettingsShell title={tr('account.title')} kicker={tr('account.kicker')} saveAction="?/save">
  <SettingsSection title={tr('account.profile.title')} sub={tr('account.profile.sub')}>
    <div class="profile-grid">
      <AvatarUpload name={data.account.name} avatarUrl={data.account.avatarUrl} />
      <div class="fields">
        <SettingsField
          label={tr('account.profile.displayName')}
          hint={tr('account.profile.displayNameHint')}
        >
          <input
            class="s-input"
            type="text"
            name="name"
            value={form?.submitted?.name ?? data.account.displayName}
            placeholder={data.account.name}
            maxlength={DISPLAY_NAME_MAX}
            autocomplete="name"
            disabled={data.account.impersonating}
          />
        </SettingsField>
        <SettingsField label={tr('account.profile.timeZone')}>
          <select
            class="s-input"
            name="timeZone"
            value={form?.submitted?.timeZone ?? data.account.timeZone}
            disabled={data.account.impersonating}
          >
            {#each timeZoneOptions as tz (tz.id)}
              <option value={tz.id}>{optionLabel('settings.tz', tz)}</option>
            {/each}
          </select>
        </SettingsField>
        <SettingsField label={tr('account.profile.displayUnits')}>
          <select
            class="s-input"
            name="displayUnits"
            value={form?.submitted?.displayUnits ?? data.account.displayUnits}
            disabled={data.account.impersonating}
          >
            {#each DISPLAY_UNITS as u (u.id)}
              <option value={u.id}>{optionLabel('settings.units', u)}</option>
            {/each}
          </select>
        </SettingsField>
      </div>
    </div>
    {#if form?.error}
      <p class="form-msg error" role="alert">{form.error}</p>
    {:else if form?.ok}
      <p class="form-msg" role="status">{tr('account.profile.saved')}</p>
    {/if}
  </SettingsSection>

  {#if data.language}
    <SettingsSection title={tr('account.language.title')} sub={tr('account.language.sub')}>
      <div class="language-row">
        <div class="language-field">
          <SettingsField label={tr('account.language.label')}>
            <select
              class="s-input tall"
              name="locale"
              form="locale-form"
              value={data.language.current}
              disabled={data.account.impersonating}
            >
              {#each data.language.choices as l (l.id)}
                <option value={l.id} lang={l.id}>{l.name}</option>
              {/each}
            </select>
          </SettingsField>
        </div>
        <button
          type="submit"
          class="ghost tall"
          form="locale-form"
          disabled={data.account.impersonating}
        >
          {tr('account.language.save')}
        </button>
      </div>
      {#if form?.localeError}
        <p class="form-msg error" role="alert">{form.localeError}</p>
      {:else if form?.localeSaved}
        <p class="form-msg" role="status">{tr('account.language.saved')}</p>
      {/if}
    </SettingsSection>
  {/if}

  <SettingsSection title={tr('account.signIn.title')} sub={tr('account.signIn.sub')}>
    <SignInMethods email={data.account.email} phone={data.account.phone} />
  </SettingsSection>

  <SettingsSection title={tr('account.sessions.title')} sub={tr('account.sessions.sub')}>
    <div class="security-grid">
      <SettingsField
        label={tr('account.sessions.lastSignIn')}
        hint={tr('account.sessions.lastSignInHint')}
      >
        <input class="s-input mono" value={data.account.lastLogin} disabled />
      </SettingsField>
    </div>

    <div class="sessions">
      <p class="sessions-hint">{tr('account.sessions.everywhereHint')}</p>
      <form method="POST" action="?/signOutEverywhere">
        <button
          type="submit"
          class="ghost-sm with-icon"
          disabled={data.account.impersonating}
          aria-describedby={data.account.impersonating ? 'signout-everywhere-note' : undefined}
        >
          <!-- #258 / CT-004 — lucide@^1.0.1 <Lock> has an SSR/hydration
               edge case in this slot (element.getAttribute() runtime
               error). Render client-side only to skip SSR until a
               lucide-svelte bump. -->
          {#if browser}<Lock size={11} strokeWidth={1.75} />{/if}
          {tr('account.sessions.signOutEverywhere')}
        </button>
        {#if data.account.impersonating}
          <p id="signout-everywhere-note" class="sessions-hint">
            {tr('account.sessions.impersonating')}
          </p>
        {/if}
      </form>
    </div>
  </SettingsSection>

  <SettingsSection title={tr('account.export.title')} sub={tr('account.export.sub')}>
    <div class="export-row">
      <a class="ghost" href="/api/account/export.json" data-sveltekit-reload>
        <FileText size={13} />
        {tr('account.export.json')}
      </a>
      <a class="ghost" href="/api/records/export.vdacs.pdf" data-sveltekit-reload>
        <FileText size={13} />
        {tr('account.export.vdacs')}
      </a>
    </div>
  </SettingsSection>
</SettingsShell>

{#if data.language}
  <form id="locale-form" method="POST" action="?/locale" hidden></form>
{/if}

<style>
  .profile-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 18px;
    align-items: start;
  }
  .form-msg {
    margin: 12px 0 0;
    font-size: 12.5px;
    color: var(--color-forest-deep);
  }
  .form-msg.error {
    color: var(--color-rust, #a3472a);
  }
  .fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .security-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
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
  .s-input.mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .s-input:focus {
    border-color: var(--color-forest-deep);
    box-shadow: 0 0 0 2px rgba(44, 82, 55, 0.15);
  }
  .s-input:disabled {
    background: var(--color-cream);
    cursor: not-allowed;
  }
  .sessions {
    margin-top: 14px;
  }
  .sessions-hint {
    margin: 0 0 8px;
    font-size: 12.5px;
    color: var(--color-ink-soft);
    max-width: 60ch;
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
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
  .ghost-sm:hover {
    border-color: var(--color-forest-deep);
  }
  .ghost-sm.with-icon {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-top: 4px;
    padding: 6px 12px;
    font-size: 12px;
    min-height: 48px;
  }
  .ghost-sm:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
  .language-row {
    display: flex;
    align-items: flex-end;
    gap: 12px;
    flex-wrap: wrap;
  }
  .language-field {
    flex: 1 1 200px;
    min-width: 0;
  }
  .s-input.tall,
  .ghost.tall {
    min-height: 48px;
  }
  .export-row {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .ghost {
    background: var(--color-paper);
    color: var(--color-ink);
    border: 1px solid var(--color-divider);
    padding: 8px 14px;
    border-radius: var(--radius-input, 6px);
    text-decoration: none;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 36px;
  }
  .ghost:hover {
    border-color: var(--color-forest-deep);
  }
  @media (max-width: 700px) {
    .profile-grid {
      grid-template-columns: 1fr;
    }
    .fields,
    .security-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
