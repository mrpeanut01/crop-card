<script lang="ts">
  import { untrack } from 'svelte';
  import SetupSheet from '$lib/components/setup/SetupSheet.svelte';
  import {
    FEEDBACK_KINDS,
    FEEDBACK_KIND_LABELS,
    FEEDBACK_MESSAGE_MAX,
    sanitizeFeedbackPath,
    type FeedbackKind
  } from '$lib/feedback/model';

  interface Props {
    open: boolean;
    /** The page the person was on; only its pathname is ever sent. */
    pathname: string;
    onClose: () => void;
    fetcher?: typeof fetch;
  }

  const { open, pathname, onClose, fetcher }: Props = $props();

  let kind = $state<FeedbackKind>('bug');
  let message = $state('');
  let sending = $state(false);
  let error = $state<string | null>(null);
  let sent = $state(false);

  const path = $derived(sanitizeFeedbackPath(pathname) ?? '/');
  const tooShort = $derived(message.trim().length < 3);

  $effect(() => {
    if (!open) return;
    untrack(() => {
      error = null;
      if (sent) {
        sent = false;
        message = '';
        kind = 'bug';
      }
    });
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (sending || tooShort) return;
    sending = true;
    error = null;
    try {
      const res = await (fetcher ?? fetch)('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, message: message.trim(), pagePath: path })
      });
      if (res.ok) {
        sent = true;
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        error =
          res.status === 400 || res.status === 429
            ? (body.error ?? 'That did not go through. Please try again.')
            : 'That did not go through. Please try again in a moment.';
      }
    } catch {
      error = "You're offline. Your note is still here, so send it when you're back online.";
    } finally {
      sending = false;
    }
  }
</script>

<SetupSheet {open} title="Send feedback" kicker="CropCard alpha" {onClose}>
  {#if sent}
    <div class="done" role="status" data-testid="feedback-sent">
      <p class="big">Thanks, we got it.</p>
      <p>We read every note. There is no reply thread here, so this is all you need to do.</p>
      <button type="button" class="primary" onclick={onClose} data-autofocus>Close</button>
    </div>
  {:else}
    <form onsubmit={submit} class="feedback-form" novalidate>
      <fieldset>
        <legend>What is it about?</legend>
        {#each FEEDBACK_KINDS as k, i (k)}
          <label class="choice" class:checked={kind === k}>
            <input
              type="radio"
              name="feedback-kind"
              value={k}
              bind:group={kind}
              data-autofocus={i === 0 ? true : undefined}
            />
            <span>{FEEDBACK_KIND_LABELS[k]}</span>
          </label>
        {/each}
      </fieldset>
      <label class="text">
        <span>{kind === 'bug' ? 'What happened, and what did you expect?' : 'Tell us more'}</span>
        <textarea
          bind:value={message}
          rows="5"
          maxlength={FEEDBACK_MESSAGE_MAX}
          required
          name="message"
        ></textarea>
      </label>
      <p class="context">
        We also send the page you are on (<code>{path}</code>), the app version and your browser
        type. Only the CropCard team reads your note. We may copy it, with personal details taken
        out, into our public issue list on GitHub. Please leave out passwords, addresses, phone
        numbers and anything else private.
      </p>
      {#if error}
        <p class="error" role="alert">{error}</p>
      {/if}
      <button type="submit" class="primary" disabled={sending || tooShort}>
        {sending ? 'Sending...' : 'Send feedback'}
      </button>
    </form>
  {/if}
</SetupSheet>

<style>
  .feedback-form {
    display: grid;
    gap: var(--space-3);
  }
  fieldset {
    border: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 6px;
  }
  legend {
    font-weight: 600;
    margin-bottom: 6px;
  }
  .choice {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    padding: 0 12px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    cursor: pointer;
  }
  .choice.checked {
    border-color: var(--color-forest);
    background: var(--pill-forest-bg);
    color: var(--pill-forest-fg);
    font-weight: 600;
  }
  .choice input {
    width: 20px;
    height: 20px;
    margin: 0;
    accent-color: var(--color-forest);
  }
  .text {
    display: grid;
    gap: 6px;
    font-weight: 600;
  }
  textarea {
    font: inherit;
    font-weight: 400;
    padding: 10px 12px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    background: var(--color-paper);
    color: var(--color-ink);
    min-height: 120px;
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
  }
  .context {
    margin: 0;
    font-size: var(--font-size-caption);
    color: var(--color-ink-muted);
    overflow-wrap: anywhere;
  }
  .error {
    margin: 0;
    color: var(--color-rust);
    font-weight: 600;
  }
  .primary {
    min-height: 48px;
    padding: 0 20px;
    border-radius: var(--radius-input);
    border: 1px solid var(--color-forest);
    background: var(--color-forest);
    color: var(--color-cream);
    font-weight: 700;
    font-size: 15px;
    cursor: pointer;
  }
  .primary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .done {
    display: grid;
    gap: var(--space-2);
  }
  .done p {
    margin: 0;
  }
  .big {
    font-size: 18px;
    font-weight: 700;
    color: var(--color-forest-deep);
  }
</style>
