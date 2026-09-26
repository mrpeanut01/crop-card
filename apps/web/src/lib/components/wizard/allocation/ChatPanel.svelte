<script lang="ts">
  import AiUsageChip from '$lib/components/billing/AiUsageChip.svelte';
  import { aiProgressLabel, fmtElapsed } from './format';
  import { getWizardContext } from './wizardState.svelte';

  const w = getWizardContext();
  const aiEnabled = $derived(w.props.aiEnabled);

  function onChatKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void w.sendChat();
    }
  }
</script>

<!-- #171 — header now surfaces the model identity ("haiku-4-5 ·
     grounded on your plugins") when AI is enabled, and swaps to a
     distinct "AI assistant is off" variant otherwise. The full
     right-rail layout pull-out from the design mockup remains a
     follow-on refactor (touches every step's aw-body shape); the
     in-step chat panel keeps working in the meantime and now reads
     correctly across all modes. -->
<section class="aw-chat" aria-label="Refine plan with AI">
  {#if aiEnabled}
    <header class="aw-chat-header">
      <h3>💬 Refine with AI</h3>
      <span class="muted aw-chat-model"> claude-haiku-4-5 · grounded on your plugins </span>
      <span class="muted">
        {#if w.step === 'schedule'}Ask for date changes; the schedule above updates each turn.
        {:else}Ask for changes; the plan above updates each turn.
        {/if}
      </span>
    </header>
    <AiUsageChip refreshKey={w.chatMessages.length} />
  {:else}
    <header class="aw-chat-header aw-chat-header-off">
      <h3>AI assistant is off</h3>
      <span class="muted">
        Add an Anthropic API key on
        <a href="/settings/ai" class="aw-chat-key-link">Settings → AI</a>
        to refine this plan with Claude. Without a key, every value above is the deterministic engine's
        output — edit by hand or regenerate.
      </span>
    </header>
  {/if}
  <div class="aw-chat-log" bind:this={w.chatLogEl} role="log" aria-live="polite">
    {#each w.chatMessages as msg, i (i)}
      <div class={`chat-msg chat-${msg.role}`}>
        <span class="chat-role" aria-hidden="true">{msg.role === 'assistant' ? '🌱' : '👤'}</span>
        <pre class="chat-bubble">{msg.content}</pre>
      </div>
    {/each}
    {#if w.chatBusy}
      <div class="chat-msg chat-assistant">
        <span class="chat-role" aria-hidden="true">🌱</span>
        <span class="chat-bubble chat-thinking">
          {aiProgressLabel(
            w.step === 'schedule' ? 'chat-schedule' : 'chat-allocate',
            w.chatStartMs == null ? 0 : Math.max(0, w.nowMs - w.chatStartMs)
          )}
          <span class="chat-elapsed"
            >{fmtElapsed(w.chatStartMs == null ? 0 : Math.max(0, w.nowMs - w.chatStartMs))}</span
          >
        </span>
      </div>
    {/if}
  </div>
  {#if w.chatError}<p class="aw-error chat-error" role="alert">{w.chatError}</p>{/if}
  {#if w.step === 'review' && w.lastRejectedAssignments && w.lastRejectedAssignments.length > 0}
    <div class="aw-override-row" role="region" aria-label="Override validators">
      <button
        type="button"
        class="btn-secondary btn-override"
        onclick={() => w.applyRejectedAnyway()}
        title="Apply the AI's proposed plan even though it failed agronomic validation."
      >
        🛠 Apply anyway ({w.lastRejectedAssignments.length} rows)
      </button>
      <span class="muted override-hint">
        Bypasses density / capacity checks. Spray-time safety rules are NOT affected.
      </span>
    </div>
  {/if}
  {#if aiEnabled}
    <form
      class="aw-chat-input"
      onsubmit={(e) => {
        e.preventDefault();
        void w.sendChat();
      }}
    >
      <textarea
        rows="2"
        placeholder={w.step === 'schedule'
          ? 'e.g. "Plant the corn the first week of May" or "Push brassicas two weeks later"'
          : 'e.g. "Move the corn off the narrow block" or "Give the brassicas more room"'}
        bind:value={w.chatDraft}
        onkeydown={onChatKeydown}
        disabled={w.chatBusy}
        aria-label="Refinement request"
      ></textarea>
      <button
        type="submit"
        class="btn-primary chat-send"
        disabled={w.chatBusy || !w.chatDraft.trim()}
      >
        {w.chatBusy ? '…' : 'Send'}
      </button>
    </form>
  {/if}
</section>

<style>
  .muted {
    color: #6a7d6a;
    font-size: 0.9rem;
  }
  .aw-chat {
    margin: 1rem 0 0.25rem;
    border: 1px solid #cbd5cb;
    border-radius: 10px;
    background: #fafcfa;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .aw-chat-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 0.55rem 0.9rem;
    background: #eef4ef;
    border-bottom: 1px solid #d8e2d8;
    gap: 0.75rem;
  }
  .aw-chat-header h3 {
    margin: 0;
    font-size: 0.95rem;
    color: var(--color-forest);
  }
  .aw-chat-header-off {
    background: var(--color-wheat-soft, #fbf3df);
    border-color: #e0d5b0;
    flex-direction: column;
    align-items: flex-start;
  }
  .aw-chat-header-off h3 {
    color: var(--color-wheat-deep, #8a6722);
  }
  .aw-chat-model {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.78rem;
    color: var(--color-ink-muted);
  }
  .aw-chat-key-link {
    color: var(--color-forest-deep, #1f3522);
    text-decoration: underline;
  }
  .aw-chat-log {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.75rem 0.9rem;
    max-height: 280px;
    overflow-y: auto;
    background: white;
  }
  .chat-msg {
    display: flex;
    align-items: flex-start;
    gap: 0.55rem;
  }
  .chat-msg.chat-user {
    flex-direction: row-reverse;
  }
  .chat-role {
    font-size: 1.05rem;
    line-height: 1.6;
    flex-shrink: 0;
  }
  .chat-bubble {
    margin: 0;
    padding: 0.5rem 0.75rem;
    border-radius: 10px;
    font-size: 0.92rem;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
    max-width: 80%;
    font-family: inherit;
  }
  .chat-msg.chat-assistant .chat-bubble {
    background: #f3f9f4;
    color: #1f3a26;
    border-top-left-radius: 4px;
  }
  .chat-msg.chat-user .chat-bubble {
    background: var(--color-forest);
    color: white;
    border-top-right-radius: 4px;
  }
  .chat-thinking {
    font-style: italic;
    color: #4a5d4a;
  }
  .chat-error {
    margin: 0.25rem 0.9rem 0;
    font-size: 0.85rem;
  }
  .aw-override-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
    padding: 0.5rem 0.75rem;
    margin: 0 0.75rem;
    background: #fff8e1;
    border: 1px solid #f1c40f;
    border-radius: 6px;
  }
  .btn-override {
    background: #fff;
    color: #5b3a00;
    border: 1px solid #f1c40f;
    font-weight: 600;
    padding: 0.4rem 0.9rem;
    border-radius: 6px;
    min-height: 40px;
    cursor: pointer;
  }
  .btn-override:hover {
    background: #fff3c4;
  }
  .override-hint {
    font-size: 0.85rem;
    flex: 1;
    min-width: 12rem;
  }
  .aw-chat-input {
    display: flex;
    gap: 0.5rem;
    padding: 0.6rem 0.75rem 0.75rem;
    background: #fafcfa;
    border-top: 1px solid #e4e9e4;
  }
  .aw-chat-input textarea {
    flex: 1;
    min-height: 44px;
    max-height: 140px;
    resize: vertical;
    padding: 0.5rem 0.6rem;
    border: 1px solid #cbd5cb;
    border-radius: 6px;
    font-size: 0.95rem;
    font-family: inherit;
    line-height: 1.4;
  }
  .aw-chat-input textarea:focus {
    outline: 2px solid var(--color-forest);
    outline-offset: 1px;
  }
  .chat-send {
    align-self: stretch;
    min-height: 44px;
    padding: 0 1rem;
  }
  .chat-elapsed {
    display: block;
    font-size: 0.72rem;
    color: #4a5d4a;
    font-variant-numeric: tabular-nums;
    margin-top: 0.15rem;
    font-style: normal;
  }
  .aw-error {
    color: #b22222;
    font-weight: 600;
  }
  .btn-primary,
  .btn-secondary {
    min-height: 44px;
    padding: 0 1rem;
    border-radius: 6px;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid #cbd5cb;
  }
  .btn-primary {
    background: var(--color-forest);
    color: white;
    border-color: var(--color-forest);
  }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-secondary {
    background: white;
    color: #4a5d4a;
  }
</style>
