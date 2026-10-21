<script lang="ts">
  import { page } from '$app/state';
  import { createT, type MessageKey } from '$lib/i18n';
  import AiUsageChip from '$lib/components/billing/AiUsageChip.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import {
    MAX_CHAT_MESSAGE_CHARS,
    type BriefChatLine,
    type BriefQuestion
  } from '$lib/garden/brief/schema';

  interface Props {
    lines: readonly BriefChatLine[];
    turnsLeft: number;
    busy?: boolean;
    followUp?: BriefQuestion | null;
    refreshKey?: unknown;
    onSend: (message: string) => void | Promise<void>;
    /** #870: Claude is off, so the stored conversation shows without the form. */
    readOnly?: boolean;
  }

  const {
    lines,
    turnsLeft,
    busy = false,
    followUp = null,
    refreshKey,
    onSend,
    readOnly = false
  }: Props = $props();

  const tr = $derived(createT(page.data?.locale));
  let draft = $state('');

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    draft = '';
    await onSend(text);
  }

  function goTo(q: BriefQuestion) {
    const el = document.getElementById(`q-${q}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el?.querySelector<HTMLElement>('input, button')?.focus();
  }
</script>

<section class="chat" aria-labelledby="brief-chat-title" data-testid="brief-chat">
  <header>
    <h2 id="brief-chat-title" class="serif">
      {readOnly ? tr('herbsg.brief.earlierTitle') : tr('herbsa.chat.title')}
    </h2>
    {#if !readOnly}<AiUsageChip {refreshKey} />{/if}
  </header>
  <p class="help">{readOnly ? tr('herbsg.brief.readOnlyNote') : tr('herbsa.chat.help')}</p>
  <ol class="log" aria-live="polite">
    {#each lines as line, i (i)}
      <li class="line {line.role}">
        {#if line.role === 'assistant'}
          <span class="who">{tr('herbsa.chat.claude')}</span>
          {#if line.provenance}<Provenance source={line.provenance} compact />{/if}
        {:else}
          <span class="who">{tr('herbsa.chat.you')}</span>
        {/if}
        <p lang={line.role === 'assistant' && line.provenance === 'ai' ? 'en' : undefined}>
          {line.text}
        </p>
      </li>
    {/each}
  </ol>
  {#if followUp && !readOnly}
    <p class="follow">
      <span
        >{tr('herbsa.chat.followUp', {
          question: tr(`herbsa.q.${followUp}.title` as MessageKey)
        })}</span
      >
      <button type="button" class="ghost" onclick={() => goTo(followUp)}>
        {tr('herbsa.chat.goToQuestion')}
      </button>
    </p>
  {/if}
  {#if !readOnly}<form onsubmit={submit}>
      <label for="brief-chat-input">{tr('herbsa.chat.label')}</label>
      <textarea
        id="brief-chat-input"
        rows="3"
        maxlength={MAX_CHAT_MESSAGE_CHARS}
        bind:value={draft}
        disabled={busy || turnsLeft <= 0}
        placeholder={tr('herbsa.chat.placeholder')}></textarea>
      <div class="actions">
        <span class="turns" data-testid="brief-turns"
          >{tr('herbsa.chat.turnsLeft', { count: turnsLeft })}</span
        >
        <button type="submit" class="primary" disabled={busy || turnsLeft <= 0 || !draft.trim()}>
          {busy ? tr('herbsa.chat.sending') : tr('herbsa.chat.send')}
        </button>
      </div>
    </form>{/if}
</section>

<style>
  .chat {
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-card, 12px);
    padding: var(--space-3);
    background: var(--color-surface, var(--color-cream));
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  h2 {
    margin: 0;
    font-size: 1.1rem;
  }
  .help {
    margin: 0;
    color: var(--color-ink-soft);
    font-size: 0.92rem;
  }
  .log {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    max-height: 24rem;
    overflow-y: auto;
  }
  .line {
    border-radius: 10px;
    padding: var(--space-2);
    background: var(--color-paper, #fff);
    overflow-wrap: anywhere;
  }
  .line.user {
    background: var(--color-forest-tint, #e8f0e9);
  }
  .line p {
    margin: 4px 0 0;
  }
  .who {
    font-weight: 700;
    font-size: 0.85rem;
    margin-right: var(--space-1);
  }
  .follow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
  }
  label {
    display: block;
    font-size: 0.9rem;
    color: var(--color-ink-soft);
    margin-bottom: 4px;
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    min-height: 72px;
    padding: var(--space-2);
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-input);
    font: inherit;
  }
  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
  .turns {
    color: var(--color-ink-soft);
    font-size: 0.9rem;
  }
  .primary,
  .ghost {
    min-height: 48px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-input);
    border: 1px solid var(--color-forest);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .primary {
    background: var(--color-forest);
    color: var(--color-paper, #fff);
  }
  .ghost {
    background: transparent;
    color: var(--color-forest);
  }
</style>
