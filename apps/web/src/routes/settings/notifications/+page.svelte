<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import SettingsShell from '$lib/components/settings/SettingsShell.svelte';
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';
  import { createT } from '$lib/i18n';
  import {
    ANIMAL_PUSH_KINDS,
    DEFAULT_PUSH_PREFS,
    OWNER_ONLY_PUSH_KINDS,
    PUSH_ALERT_KINDS,
    pushAlertText,
    type PushAlertKind,
    type PushPrefs
  } from '$lib/push/prefs';
  import { EMAIL_ALERT_CATEGORIES, type EmailAlertCategory } from '$lib/email/alertCategories';
  import {
    detectPushSupport,
    serializeSubscription,
    urlBase64ToUint8Array,
    type PushSupport
  } from '$lib/client/pushClient';

  const { data } = $props();

  const tr = $derived(createT(data.locale));
  function kindText(kind: PushAlertKind, part: 'label' | 'sub'): string {
    return pushAlertText(kind, part, data.locale);
  }

  function shown(kind: PushAlertKind): boolean {
    if (ANIMAL_PUSH_KINDS.includes(kind) && !data.hasAnimals) return false;
    return !OWNER_ONLY_PUSH_KINDS.includes(kind) || data.isOwner;
  }
  const pushKinds = $derived(PUSH_ALERT_KINDS.filter(shown));
  const emailKinds = $derived(EMAIL_ALERT_CATEGORIES.filter(shown));

  let support = $state<PushSupport | 'checking'>('checking');
  let endpoint = $state<string | null>(null);
  let busy = $state(false);
  let message = $state('');
  let draftPrefs = $state<PushPrefs>({ ...DEFAULT_PUSH_PREFS });

  const serverSub = $derived(
    endpoint ? (data.subscriptions.find((s) => s.endpoint === endpoint) ?? null) : null
  );
  const enabled = $derived(serverSub !== null);
  const prefs = $derived<PushPrefs>(serverSub ? serverSub.prefs : draftPrefs);

  async function registration(): Promise<ServiceWorkerRegistration | null> {
    if (!('serviceWorker' in navigator)) return null;
    return (await navigator.serviceWorker.getRegistration('/').catch(() => undefined)) ?? null;
  }

  onMount(async () => {
    const reg = await registration();
    support = detectPushSupport({
      hasServiceWorker: 'serviceWorker' in navigator,
      hasPushManager: 'PushManager' in window,
      hasNotification: 'Notification' in window,
      permission: 'Notification' in window ? Notification.permission : null,
      registered: reg !== null
    });
    if (reg && 'pushManager' in reg) {
      const sub = await reg.pushManager.getSubscription().catch(() => null);
      endpoint = sub?.endpoint ?? null;
    }
  });

  async function readError(res: Response): Promise<string> {
    const body = await res.json().catch(() => null);
    return (
      (body && (body.message || body.error)) ||
      tr('settings.notif.requestFailed', { status: res.status })
    );
  }

  async function enable() {
    if (!data.publicKey) return;
    busy = true;
    message = '';
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        if (permission === 'denied') support = 'permission-denied';
        message = tr('settings.notif.notAllowed');
        return;
      }
      const reg = await registration();
      if (!reg) {
        support = 'no-service-worker';
        return;
      }
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await Promise.race([
          reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(data.publicKey).buffer as ArrayBuffer
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(tr('settings.notif.pushNoAnswer'))), 20_000)
          )
        ]));
      const serialized = serializeSubscription(sub);
      if (!serialized) {
        message = tr('settings.notif.incomplete');
        return;
      }
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: serialized, prefs: draftPrefs })
      });
      if (!res.ok) {
        message = await readError(res);
        return;
      }
      endpoint = serialized.endpoint;
      await invalidateAll();
      message = tr('settings.notif.pushOn');
    } catch (err) {
      message = err instanceof Error ? err.message : tr('settings.notif.couldNotTurnOn');
    } finally {
      busy = false;
    }
  }

  async function disable() {
    if (!endpoint) return;
    busy = true;
    message = '';
    try {
      const res = await fetch('/api/push/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint })
      });
      if (!res.ok) {
        message = await readError(res);
        return;
      }
      await invalidateAll();
      message = tr('settings.notif.pushOff');
    } finally {
      busy = false;
    }
  }

  async function togglePref(kind: PushAlertKind) {
    const next = !prefs[kind];
    if (!enabled || !endpoint) {
      draftPrefs = { ...draftPrefs, [kind]: next };
      return;
    }
    busy = true;
    message = '';
    try {
      const res = await fetch('/api/push/subscribe', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, prefs: { [kind]: next } })
      });
      if (!res.ok) message = await readError(res);
      await invalidateAll();
    } finally {
      busy = false;
    }
  }

  let emailBusy = $state(false);
  let emailMessage = $state('');
  const emailPrefs = $derived(data.email.prefs);
  const anyEmailOn = $derived(Object.values(emailPrefs).some(Boolean));
  const emailLocked = $derived(
    !data.email.address || !data.canSubscribe || data.email.impersonating || emailBusy
  );

  async function toggleEmail(category: EmailAlertCategory) {
    emailBusy = true;
    emailMessage = '';
    try {
      const res = await fetch('/api/email/prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, enabled: !emailPrefs[category] })
      });
      if (!res.ok) {
        emailMessage = await readError(res);
        return;
      }
      await invalidateAll();
      emailMessage = tr('settings.notif.saved');
    } finally {
      emailBusy = false;
    }
  }

  async function sendTestEmail() {
    emailBusy = true;
    emailMessage = '';
    try {
      const res = await fetch('/api/email/test', { method: 'POST' });
      emailMessage = res.ok
        ? tr('settings.notif.testEmailSent', { address: data.email.address ?? '' })
        : await readError(res);
    } finally {
      emailBusy = false;
    }
  }

  async function sendTest() {
    if (!endpoint) return;
    busy = true;
    message = '';
    try {
      const res = await fetch('/api/push/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint })
      });
      if (!res.ok) {
        message = await readError(res);
        return;
      }
      const summary = await res.json();
      message =
        summary.sent > 0 ? tr('settings.notif.testSent') : tr('settings.notif.testRejected');
      await invalidateAll();
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>{tr('settings.notif.pageTitle')}</title></svelte:head>

<SettingsShell title={tr('settings.notif.title')} kicker={tr('settings.notif.kicker')} hideFooter>
  {#snippet badge()}
    {#if enabled}<Pill tone="forest">{tr('settings.notif.onDevice')}</Pill>{/if}
  {/snippet}

  <SettingsSection title={tr('settings.notif.pushTitle')} sub={tr('settings.notif.pushSub')}>
    {#if !data.configured}
      <p class="notice" role="status">{tr('settings.notif.notConfigured')}</p>
    {:else if !data.canSubscribe}
      <p class="notice" role="status">{tr('settings.notif.inspectorReadOnly')}</p>
    {:else if support === 'checking'}
      <p class="muted">{tr('settings.notif.checking')}</p>
    {:else if support === 'unsupported'}
      <p class="notice" role="status">
        {tr('settings.notif.unsupported')}
      </p>
    {:else if support === 'no-service-worker'}
      <p class="notice" role="status">
        {tr('settings.notif.noWorker')}
      </p>
    {:else if support === 'permission-denied'}
      <p class="notice" role="status">
        {tr('settings.notif.blocked')}
      </p>
    {:else}
      <div class="device-row">
        {#if enabled}
          <button type="button" class="btn ghost" disabled={busy} onclick={disable}>
            {tr('settings.notif.turnOffDevice')}
          </button>
          <button type="button" class="btn ghost" disabled={busy} onclick={sendTest}>
            {tr('settings.notif.sendTest')}
          </button>
        {:else}
          <button type="button" class="btn primary" disabled={busy} onclick={enable}>
            {tr('settings.notif.turnOn')}
          </button>
        {/if}
      </div>
      {#if serverSub && serverSub.failureCount > 0}
        <p class="muted">
          {tr('settings.notif.failures', { count: serverSub.failureCount })}
        </p>
      {/if}
    {/if}
    <p class="status" aria-live="polite">{message}</p>
  </SettingsSection>

  <SettingsSection title={tr('settings.notif.typesTitle')} sub={tr('settings.notif.typesSub')}>
    <ul class="kinds">
      {#each pushKinds as kind (kind)}
        <li>
          <label class="kind-row">
            <input
              type="checkbox"
              checked={prefs[kind]}
              disabled={busy || !data.configured || !data.canSubscribe}
              onchange={() => togglePref(kind)}
            />
            <span class="kind-text">
              <span class="kind-label">{kindText(kind, 'label')}</span>
              <span class="kind-sub">{kindText(kind, 'sub')}</span>
            </span>
          </label>
          {#if kind === 'frost-tonight' && data.frostNeedsLocation}
            <p class="kind-note">
              {tr('settings.notif.needsLocation')}
              <a href="/settings/farm">{tr('settings.notif.setLocation')}</a>.
            </p>
          {/if}
        </li>
      {/each}
    </ul>
  </SettingsSection>

  <SettingsSection title={tr('settings.notif.emailTitle')} sub={tr('settings.notif.emailSub')}>
    {#if !data.canSubscribe}
      <p class="notice" role="status">{tr('settings.notif.inspectorReadOnly')}</p>
    {:else if !data.email.address}
      <p class="notice" role="status">
        {tr('settings.notif.noEmailA')}
        <a href="/settings/account">{tr('settings.notif.noEmailLink')}</a>
        {tr('settings.notif.noEmailB')}
      </p>
    {:else}
      <p class="muted email-to">
        {tr('settings.notif.sendsTo')} <strong>{data.email.address}</strong>.
      </p>
      {#if data.email.impersonating}
        <p class="notice" role="status">{tr('settings.notif.selfOnly')}</p>
      {/if}
      {#if data.email.suppressed}
        <p class="notice" role="status">
          {tr('settings.notif.suppressed')}
        </p>
      {/if}
      {#if data.email.transportOff}
        <p class="notice" role="status">{tr('settings.notif.emailOff')}</p>
      {/if}
      <ul class="kinds">
        {#each emailKinds as category (category)}
          <li>
            <label class="kind-row">
              <input
                type="checkbox"
                checked={emailPrefs[category]}
                disabled={emailLocked}
                onchange={() => toggleEmail(category)}
              />
              <span class="kind-text">
                <span class="kind-label"
                  >{tr('settings.notif.emailMe', { label: kindText(category, 'label') })}</span
                >
                <span class="kind-sub">{kindText(category, 'sub')}</span>
              </span>
            </label>
          </li>
        {/each}
      </ul>
      <p class="muted">
        {tr('settings.notif.unsubNote')}
      </p>
      {#if data.isOwner}
        <p class="muted">
          {tr('settings.notif.receipts')}
          <a href="/settings/billing">{tr('settings.notif.seeBilling')}</a>.
        </p>
      {/if}
      {#if anyEmailOn}
        <div class="device-row email-actions">
          <button
            type="button"
            class="btn ghost"
            disabled={emailBusy || data.email.impersonating}
            onclick={sendTestEmail}
          >
            {tr('settings.notif.sendTestEmail')}
          </button>
        </div>
      {/if}
    {/if}
    <p class="status" aria-live="polite">{emailMessage}</p>
  </SettingsSection>
</SettingsShell>

<style>
  .notice {
    margin: 0;
    padding: 12px 14px;
    border-radius: 8px;
    background: var(--color-cream);
    border: 1px solid var(--color-divider);
    color: var(--color-ink);
    font-size: 14px;
  }
  .muted {
    color: var(--color-ink-muted);
    font-size: 13px;
    margin: 8px 0 0;
  }
  .status {
    min-height: 1.2em;
    margin: 10px 0 0;
    font-size: 13.5px;
    color: var(--color-ink);
  }
  .device-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .btn {
    min-height: 48px;
    padding: 0 18px;
    border-radius: var(--radius-input, 6px);
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  .btn:disabled {
    opacity: 0.6;
    cursor: progress;
  }
  .btn.primary {
    background: var(--color-forest-deep);
    color: var(--color-cream, #f8f3e8);
    border: 1px solid var(--color-forest-deep);
  }
  .btn.ghost {
    background: var(--color-paper);
    color: var(--color-ink);
    border: 1px solid var(--color-divider);
  }
  .btn.ghost:hover {
    border-color: var(--color-forest-deep);
  }
  .kinds {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .kind-row {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 56px;
    padding: 8px 14px;
    border: 1px solid var(--color-divider);
    border-radius: 8px;
    background: var(--color-paper);
    cursor: pointer;
  }
  .kind-row input {
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    accent-color: var(--color-forest-deep);
  }
  .kind-text {
    display: grid;
    gap: 2px;
  }
  .kind-label {
    font-weight: 600;
    color: var(--color-ink);
    font-size: 14px;
  }
  .kind-sub {
    color: var(--color-ink-muted);
    font-size: 12.5px;
  }
  .kind-note {
    margin: 4px 0 0 52px;
    color: var(--color-ink-muted);
    font-size: 12.5px;
  }
  .kind-note a {
    color: var(--color-ink);
  }
  .notice a {
    color: var(--color-ink);
  }
  .email-to {
    margin: 0 0 10px;
    overflow-wrap: anywhere;
  }
  .email-actions {
    margin-top: 12px;
  }
</style>
