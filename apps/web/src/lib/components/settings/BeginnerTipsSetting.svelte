<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
  import { forgetTips } from '$lib/client/hints';

  interface Props {
    enabled: boolean;
    /** Inspector accounts cannot write through the API. */
    canChange?: boolean;
    /** Test seam. */
    fetcher?: typeof fetch;
  }

  const { enabled, canChange = true, fetcher = fetch }: Props = $props();
  const tr = $derived(createT(page.data?.locale));

  let on = $derived(enabled);
  let busy = $state(false);
  let note = $state<'on' | 'off' | 'reset' | 'error' | null>(null);

  async function post(body: { enabled?: boolean; reset?: true }): Promise<boolean> {
    busy = true;
    try {
      const res = await fetcher('/api/me/beginner-tips', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      busy = false;
    }
  }

  async function toggle(next: boolean) {
    on = next;
    note = null;
    if (await post({ enabled: next })) {
      note = next ? 'on' : 'off';
      await invalidateAll();
    } else {
      on = !next;
      note = 'error';
    }
  }

  async function showAgain() {
    note = null;
    if (await post({ reset: true })) {
      forgetTips();
      note = 'reset';
      await invalidateAll();
    } else {
      note = 'error';
    }
  }
</script>

<div class="tips-setting" data-testid="beginner-tips-setting">
  <label class="switch-row">
    <input
      type="checkbox"
      role="switch"
      checked={on}
      disabled={busy || !canChange}
      onchange={(e) => toggle(e.currentTarget.checked)}
    />
    <span class="track" aria-hidden="true"><span class="knob"></span></span>
    <span class="label">{tr('tips.settings.switch')}</span>
  </label>
  <button type="button" class="again" onclick={showAgain} disabled={busy || !canChange || !on}>
    {tr('tips.settings.reset')}
  </button>
  {#if !canChange}
    <p class="msg">{tr('tips.settings.askOwner')}</p>
  {:else if note === 'error'}
    <p class="msg error" role="alert">{tr('tips.settings.error')}</p>
  {:else if note}
    <p class="msg" role="status">
      {tr(
        note === 'reset'
          ? 'tips.settings.resetDone'
          : note === 'on'
            ? 'tips.settings.on'
            : 'tips.settings.off'
      )}
    </p>
  {/if}
</div>

<style>
  .tips-setting {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
  }
  .switch-row {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 12px;
    min-height: 48px;
    cursor: pointer;
    font-weight: 600;
    color: var(--color-ink);
  }
  input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
  }
  .track {
    width: 52px;
    height: 30px;
    flex-shrink: 0;
    border-radius: 999px;
    background: var(--color-divider);
    border: 1px solid var(--color-ink-soft);
    position: relative;
    transition: background 120ms;
  }
  .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 24px;
    height: 24px;
    border-radius: 999px;
    background: var(--color-paper);
    box-shadow: 0 1px 3px rgba(26, 31, 26, 0.3);
    transition: transform 120ms;
  }
  input:checked + .track {
    background: var(--color-forest);
    border-color: var(--color-forest);
  }
  input:checked + .track .knob {
    transform: translateX(22px);
  }
  input:focus-visible + .track {
    outline: 2px solid var(--color-forest-deep);
    outline-offset: 2px;
  }
  input:disabled + .track {
    opacity: 0.6;
  }
  .again {
    font: inherit;
    font-weight: 600;
    min-height: 48px;
    padding: 0 16px;
    border-radius: var(--radius-input);
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-forest-deep);
    cursor: pointer;
  }
  .again:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
  .again:focus-visible {
    outline: 2px solid var(--color-forest-deep);
    outline-offset: 2px;
  }
  .msg {
    flex-basis: 100%;
    margin: 0;
    font-size: 13px;
    color: var(--color-ink-soft);
  }
  .msg.error {
    color: var(--color-rust, #8a3b1e);
  }
  @media (prefers-reduced-motion: reduce) {
    .track,
    .knob {
      transition: none;
    }
  }
</style>
