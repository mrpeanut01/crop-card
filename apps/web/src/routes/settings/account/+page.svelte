<script lang="ts">
  import { User, Lock, FileText } from 'lucide-svelte';
  import SettingsShell from '$lib/components/settings/SettingsShell.svelte';
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte';
  import SettingsField from '$lib/components/settings/SettingsField.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';

  let { data } = $props();

  // Active sessions — we don't track concurrent sessions yet; the
  // current cookie is "this device". Sticking to one row keeps the
  // UX honest until the sessions table lands.
  const sessions = $derived([
    {
      device: 'This browser session',
      where: 'current',
      when: data.account.lastLogin,
      current: true
    }
  ]);
</script>

<svelte:head><title>Account & sign-in · CropCard</title></svelte:head>

<SettingsShell title="Account & sign-in" kicker="Owner profile" saveAction="?/save">
  <SettingsSection title="Profile" sub="Visible to helpers in your farm.">
    <div class="profile-grid">
      <div class="avatar">{data.account.name.charAt(0).toUpperCase()}</div>
      <div class="fields">
        <SettingsField label="Display name">
          <input class="s-input" type="text" value={data.account.name} name="name" />
        </SettingsField>
        <SettingsField label="Email" hint="magic-link sign-in">
          <input class="s-input" type="email" value={data.account.email} name="email" />
        </SettingsField>
        <SettingsField label="Time zone">
          <select class="s-input"><option>America/New_York (EST)</option></select>
        </SettingsField>
        <SettingsField label="Display units">
          <select class="s-input">
            <option value="us">US (acre · lb · °F)</option>
            <option value="metric">Metric (ha · kg · °C)</option>
          </select>
        </SettingsField>
      </div>
    </div>
  </SettingsSection>

  <SettingsSection
    title="Sign-in security"
    sub="Magic-link (no password) · optional 2FA when shipped."
  >
    <div class="security-grid">
      <SettingsField label="Sign-in method">
        <select class="s-input">
          <option value="magic">Magic-link email</option>
          <option disabled>Magic-link + passkey (coming)</option>
        </select>
      </SettingsField>
      <SettingsField label="Last sign-in" hint="HMAC cookie session">
        <input class="s-input mono" value={data.account.lastLogin} disabled />
      </SettingsField>
    </div>

    <div class="sessions">
      <div class="sessions-kicker">Active sessions · {sessions.length}</div>
      <ul class="session-list">
        {#each sessions as s (s.device)}
          <li class="session-row">
            <User size={15} strokeWidth={1.75} />
            <div class="s-text">
              <div class="s-device">{s.device}</div>
              <div class="s-meta mono">{s.where} · {s.when}</div>
            </div>
            {#if s.current}
              <Pill tone="forest">This device</Pill>
            {:else}
              <button type="button" class="ghost-sm">Sign out</button>
            {/if}
          </li>
        {/each}
      </ul>
      <form method="POST" action="/signout">
        <button type="submit" class="ghost-sm with-icon">
          <Lock size={11} strokeWidth={1.75} />
          Sign out everywhere
        </button>
      </form>
    </div>
  </SettingsSection>

  <SettingsSection
    title="Data export"
    sub="GDPR-style download · JSON manifest + linked PDF/CSV downloads."
  >
    <div class="export-row">
      <a class="ghost" href="/api/account/export.json" download>
        <FileText size={13} /> Download account data (JSON)
      </a>
      <a class="ghost" href="/api/records/export.vdacs.pdf" download>
        <FileText size={13} /> Download VDACS audit pack
      </a>
    </div>
  </SettingsSection>
</SettingsShell>

<style>
  .profile-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 18px;
    align-items: start;
  }
  .avatar {
    width: 64px;
    height: 64px;
    border-radius: 999px;
    background: var(--color-wheat, #d4a75c);
    color: var(--color-cream, #f8f3e8);
    display: grid;
    place-items: center;
    font-size: 26px;
    font-weight: 700;
    font-family: var(--font-serif, serif);
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
  .sessions-kicker {
    font-size: 11px;
    font-weight: 700;
    color: var(--color-ink-muted);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .session-list {
    list-style: none;
    margin: 8px 0 10px;
    padding: 0;
    border: 1px solid var(--color-divider-soft, var(--color-divider));
    border-radius: 8px;
    overflow: hidden;
  }
  .session-row {
    padding: 10px 14px;
    display: flex;
    align-items: center;
    gap: 12px;
    color: var(--color-ink-soft);
  }
  .session-row + .session-row {
    border-top: 1px solid var(--color-divider-soft, var(--color-divider));
  }
  .s-text {
    flex: 1;
    min-width: 0;
  }
  .s-device {
    font-size: 13px;
    color: var(--color-ink);
    font-weight: 600;
  }
  .s-meta {
    font-size: 11.5px;
    color: var(--color-ink-muted);
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
