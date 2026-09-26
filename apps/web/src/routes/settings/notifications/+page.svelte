<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import SettingsShell from '$lib/components/settings/SettingsShell.svelte';
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';
  import {
    DEFAULT_PUSH_PREFS,
    PUSH_ALERT_KINDS,
    PUSH_ALERT_LABELS,
    type PushAlertKind,
    type PushPrefs
  } from '$lib/push/prefs';
  import {
    detectPushSupport,
    serializeSubscription,
    urlBase64ToUint8Array,
    type PushSupport
  } from '$lib/client/pushClient';

  const { data } = $props();

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
    return (body && (body.message || body.error)) || `Request failed (${res.status})`;
  }

  async function enable() {
    if (!data.publicKey) return;
    busy = true;
    message = '';
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        if (permission === 'denied') support = 'permission-denied';
        message = 'Notifications were not allowed for this site.';
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
            setTimeout(
              () => reject(new Error("The browser's push service didn't answer. Try again.")),
              20_000
            )
          )
        ]));
      const serialized = serializeSubscription(sub);
      if (!serialized) {
        message = 'This browser returned an incomplete push subscription.';
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
      message = 'Push alerts are on for this device.';
    } catch (err) {
      message = err instanceof Error ? err.message : 'Could not turn on push alerts.';
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
      message = 'Push alerts are off for this device.';
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
        summary.sent > 0
          ? 'Test notification sent — it should appear in a few seconds.'
          : 'The push service did not accept the test. Try turning alerts off and on again.';
      await invalidateAll();
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Notifications · CropCard</title></svelte:head>

<SettingsShell title="Notifications" kicker="Push alerts" hideFooter>
  {#snippet badge()}
    {#if enabled}<Pill tone="forest">On for this device</Pill>{/if}
  {/snippet}

  <SettingsSection
    title="This device"
    sub="Alerts arrive even when CropCard is closed. Each device opts in separately, per farm."
  >
    {#if !data.configured}
      <p class="notice" role="status">Push isn't configured on this server.</p>
    {:else if !data.canSubscribe}
      <p class="notice" role="status">Inspector accounts are read-only and can't receive alerts.</p>
    {:else if support === 'checking'}
      <p class="muted">Checking this browser…</p>
    {:else if support === 'unsupported'}
      <p class="notice" role="status">
        This browser doesn't support web push. On iPhone, add CropCard to the Home Screen first.
      </p>
    {:else if support === 'no-service-worker'}
      <p class="notice" role="status">
        The offline service worker isn't running yet. Reload the page once, then try again.
      </p>
    {:else if support === 'permission-denied'}
      <p class="notice" role="status">
        Notifications are blocked for this site. Allow them in the browser's site settings, then
        reload.
      </p>
    {:else}
      <div class="device-row">
        {#if enabled}
          <button type="button" class="btn ghost" disabled={busy} onclick={disable}>
            Turn off on this device
          </button>
          <button type="button" class="btn ghost" disabled={busy} onclick={sendTest}>
            Send a test notification
          </button>
        {:else}
          <button type="button" class="btn primary" disabled={busy} onclick={enable}>
            Turn on push alerts
          </button>
        {/if}
      </div>
      {#if serverSub && serverSub.failureCount > 0}
        <p class="muted">
          {serverSub.failureCount} recent delivery failure{serverSub.failureCount === 1 ? '' : 's'}.
        </p>
      {/if}
    {/if}
    <p class="status" aria-live="polite">{message}</p>
  </SettingsSection>

  <SettingsSection
    title="Alert types"
    sub="Reminders only — the safety kernel and the 48-hour record lock enforce regardless."
  >
    <ul class="kinds">
      {#each PUSH_ALERT_KINDS as kind (kind)}
        <li>
          <label class="kind-row">
            <input
              type="checkbox"
              checked={prefs[kind]}
              disabled={busy || !data.configured || !data.canSubscribe}
              onchange={() => togglePref(kind)}
            />
            <span class="kind-text">
              <span class="kind-label">{PUSH_ALERT_LABELS[kind].label}</span>
              <span class="kind-sub">{PUSH_ALERT_LABELS[kind].sub}</span>
            </span>
          </label>
          {#if kind === 'frost-tonight' && data.frostNeedsLocation}
            <p class="kind-note">
              Needs your farm's location: <a href="/settings/farm">set it in Farm settings</a>.
            </p>
          {/if}
        </li>
      {/each}
    </ul>
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
</style>
