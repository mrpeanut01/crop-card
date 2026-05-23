<script lang="ts">
  /**
   * ScheduleOptimizerSidebar (Phase 21b follow-up)
   *
   * Replaces the previous "Auto Schedule / Optimize" modal with a
   * right-side conversational sidebar. Top half summarizes what we
   * know about the current schedule + dependencies in plain English;
   * bottom half is a chat that proposes changes via the existing
   * /api/plan/schedule/refine endpoint. When the operator likes the
   * AI's proposed schedule, they hit "Apply to grid" and each row
   * is committed via the existing PATCH /api/crops/[id] action.
   *
   * Designed to be open-while-the-grid-is-visible — the operator can
   * watch their swim-lane while iterating. Doesn't block the
   * surrounding UI.
   */
  import { onMount } from 'svelte';

  type SwimPlantingLite = {
    cropId: string;
    blockId: string;
    cropPluginId: string;
    stockItemId?: string;
    varietyDisplayName: string;
    plantingDateMs: number;
    endMs?: number;
  };

  type BlockLite = {
    id: string;
    name: string;
  };

  interface ProposedRow {
    stockItemId: string;
    blockId: string;
    cropPluginId: string;
    varietyDisplayName: string;
    plantingDateMs: number;
    plants: number;
    successionIndex?: { i: number; n: number };
    rationale?: string;
  }

  interface Props {
    /** Active plantings on the swim-lane. Source of "what we know"
     *  and the seed for the chat's previousScheduled payload. */
    plantings: ReadonlyArray<SwimPlantingLite>;
    /** Blocks visible in the swim-lane (post-filter). Names are
     *  used in the summary text. */
    blocks: ReadonlyArray<BlockLite>;
    /** Optional plain-English notes the parent already computed
     *  (advisories, pollination constraints, etc.). Listed below
     *  the auto-generated facts. */
    extraFacts?: ReadonlyArray<string>;
    /** Called when the operator clicks "Apply to grid". Receives
     *  the AI's last proposed schedule. Parent persists per-row. */
    onApply: (rows: ProposedRow[]) => void | Promise<void>;
    onClose: () => void;
  }

  let { plantings, blocks, extraFacts = [], onApply, onClose }: Props = $props();

  type ChatMsg = { role: 'user' | 'assistant'; content: string };
  let messages = $state<ChatMsg[]>([]);
  let draft = $state('');
  let busy = $state(false);
  let chatError = $state<string | null>(null);

  /** Buffered proposal — set by every successful refine that doesn't
   *  fall back. Apply button is enabled while this is non-null. */
  let proposed = $state<ProposedRow[] | null>(null);
  let proposedRationale = $state<string>('');
  let applying = $state(false);
  let applyError = $state<string | null>(null);

  let chatLogEl: HTMLDivElement | undefined = $state();

  const facts = $derived.by(() => {
    if (plantings.length === 0) {
      return [
        'No plantings on the swim-lane yet. Schedule some first, then come back here to optimize.'
      ];
    }
    const blockNames = new Map(blocks.map((b) => [b.id, b.name]));
    const byBlock = new Map<string, number>();
    const byCrop = new Map<string, number>();
    const dates: number[] = [];
    for (const p of plantings) {
      byBlock.set(p.blockId, (byBlock.get(p.blockId) ?? 0) + 1);
      byCrop.set(p.varietyDisplayName, (byCrop.get(p.varietyDisplayName) ?? 0) + 1);
      dates.push(p.plantingDateMs);
    }
    const earliest = new Date(Math.min(...dates));
    const latest = new Date(Math.max(...dates));
    const fmtDate = (d: Date) =>
      d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

    const blockSummary = [...byBlock.entries()]
      .map(([id, n]) => `“${blockNames.get(id) ?? id}” (${n})`)
      .join(', ');
    const topCrops = [...byCrop.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, n]) => (n > 1 ? `${name} ×${n}` : name))
      .join(', ');

    return [
      `${plantings.length} planting${plantings.length === 1 ? '' : 's'} across ${byBlock.size} block${byBlock.size === 1 ? '' : 's'} — ${blockSummary}.`,
      `Earliest: ${fmtDate(earliest)}. Latest: ${fmtDate(latest)}.`,
      `Crops: ${topCrops}${byCrop.size > 6 ? ', …' : ''}.`
    ];
  });

  /** Seed the chat with the operator's opening prompt so the AI has
   *  context on the role + permitted moves before we send any user
   *  turn. */
  onMount(() => {
    messages = [
      {
        role: 'assistant',
        content:
          'Hi — I can re-arrange planting dates to honor cross-pollination staggers, companion offsets, and succession spacing. Tell me what you want to change. Examples:\n\n• "Plant all the corn the first week of May"\n• "Push the brassicas two weeks later so I\'m not behind on the sweet corn"\n• "I want the squash spread out, not all on the same day"\n• "Optimize the schedule for the longest possible harvest window"\n\nI\'ll propose new dates above and you can hit "Apply to grid" if you like what I came up with.'
      }
    ];
    queueScrollChat();
  });

  function queueScrollChat() {
    requestAnimationFrame(() => {
      if (chatLogEl) chatLogEl.scrollTop = chatLogEl.scrollHeight;
    });
  }

  async function sendChat(): Promise<void> {
    const text = draft.trim();
    if (!text || busy) return;
    const userTurn: ChatMsg = { role: 'user', content: text };
    messages = [...messages, userTurn];
    draft = '';
    queueScrollChat();
    busy = true;
    chatError = null;
    try {
      // Build the payload from current plantings so the AI sees the
      // exact swim-lane state. previousScheduled mirrors assignments
      // by design — the chat refine expects both shapes.
      const assignments = plantings.map((p) => ({
        stockItemId: p.stockItemId ?? p.cropId,
        blockId: p.blockId,
        cropPluginId: p.cropPluginId,
        varietyDisplayName: p.varietyDisplayName,
        plants: 1
      }));
      const previousScheduled = plantings.map((p) => ({
        stockItemId: p.stockItemId ?? p.cropId,
        blockId: p.blockId,
        cropPluginId: p.cropPluginId,
        varietyDisplayName: p.varietyDisplayName,
        plantingDateMs: p.plantingDateMs,
        plants: 1,
        rationale: ''
      }));
      const transcript = messages.slice(1).map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch('/api/plan/schedule/refine', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          assignments,
          pollinationConstraints: [],
          companionGroups: [],
          previousScheduled,
          previousRationale: '',
          previousAdvisories: [],
          transcript
        })
      });
      const body = await res.json();
      if (!res.ok) {
        chatError = body?.error ?? `HTTP ${res.status}`;
        // Pop the user message back into the draft so they can edit.
        messages = messages.slice(0, -1);
        draft = text;
        return;
      }
      const reply: string =
        typeof body.reply === 'string' && body.reply.trim().length > 0
          ? body.reply
          : 'Done — proposed new dates. Click "Apply to grid" when you\'re ready.';
      const fallback: string | undefined = body?.meta?.fallback;
      const violations: string[] = Array.isArray(body?.meta?.violations)
        ? body.meta.violations
        : [];
      let display = reply;
      if (fallback) {
        const header =
          fallback === 'no-api-key'
            ? '⚠ No Anthropic API key configured — proposal unchanged.'
            : '⚠ Could not apply that change cleanly. Validators rejected the proposal; the schedule above stays as it is.';
        const violationLine = violations.length > 0 ? `\n\nWhy:\n• ${violations.join('\n• ')}` : '';
        display = `${header}${violationLine}\n\n${reply}`;
        // Don't buffer a proposed schedule when the AI's output failed
        // validation — Apply would just write the previous dates back.
        proposed = null;
        proposedRationale = '';
      } else if (Array.isArray(body.scheduled) && body.scheduled.length > 0) {
        proposed = body.scheduled as ProposedRow[];
        proposedRationale = typeof body.rationale === 'string' ? body.rationale : '';
      }
      messages = [...messages, { role: 'assistant', content: display }];
      queueScrollChat();
    } catch (e) {
      chatError = e instanceof Error ? e.message : String(e);
      messages = messages.slice(0, -1);
      draft = text;
    } finally {
      busy = false;
    }
  }

  function onChatKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendChat();
    }
  }

  async function handleApply() {
    if (!proposed || proposed.length === 0) return;
    applying = true;
    applyError = null;
    try {
      await onApply(proposed);
      proposed = null;
      proposedRationale = '';
      messages = [
        ...messages,
        {
          role: 'assistant',
          content:
            '✅ Applied to the grid. Check the swim-lane behind this sidebar — the new dates are live.'
        }
      ];
      queueScrollChat();
    } catch (e) {
      applyError = e instanceof Error ? e.message : String(e);
    } finally {
      applying = false;
    }
  }

  /** Diff badge — show count of rows whose proposed date differs
   *  from the current one. Helps the operator gauge the size of the
   *  proposed change before committing. */
  const proposedDiffCount = $derived.by(() => {
    if (!proposed) return 0;
    const cur = new Map(
      plantings.map((p) => [`${p.stockItemId ?? p.cropId}:${p.blockId}`, p.plantingDateMs])
    );
    let n = 0;
    for (const r of proposed) {
      const k = `${r.stockItemId}:${r.blockId}`;
      const old = cur.get(k);
      if (old == null || old !== r.plantingDateMs) n++;
    }
    return n;
  });
</script>

<div class="optimizer-sidebar" role="dialog" aria-modal="false" aria-label="Schedule optimizer">
  <header class="opt-head">
    <h3>✨ Optimize schedule</h3>
    <button type="button" class="opt-close" onclick={onClose} aria-label="Close optimizer">×</button
    >
  </header>

  <section class="opt-facts">
    <h4>What we know</h4>
    <ul>
      {#each facts as f, i (i)}
        <li>{f}</li>
      {/each}
      {#each extraFacts as f, i (`extra-${i}`)}
        <li>{f}</li>
      {/each}
    </ul>
  </section>

  {#if proposed && proposed.length > 0}
    <section class="opt-proposal" aria-live="polite">
      <h4>
        Proposed changes
        <span class="diff-badge"
          >{proposedDiffCount} row{proposedDiffCount === 1 ? '' : 's'} differ</span
        >
      </h4>
      {#if proposedRationale}
        <p class="proposal-rationale">{proposedRationale}</p>
      {/if}
      <button type="button" class="apply-btn" onclick={handleApply} disabled={applying}>
        {applying ? 'Applying…' : 'Apply to grid'}
      </button>
      {#if applyError}
        <p class="opt-error" role="alert">Apply failed: {applyError}</p>
      {/if}
    </section>
  {/if}

  <section class="opt-chat" aria-label="Refinement chat">
    <div class="chat-log" bind:this={chatLogEl} role="log" aria-live="polite">
      {#each messages as m, i (i)}
        <div class={`chat-msg chat-${m.role}`}>
          <span class="chat-role" aria-hidden="true">{m.role === 'assistant' ? '🌱' : '👤'}</span>
          <pre class="chat-bubble">{m.content}</pre>
        </div>
      {/each}
      {#if busy}
        <div class="chat-msg chat-assistant">
          <span class="chat-role" aria-hidden="true">🌱</span>
          <span class="chat-bubble chat-thinking">Thinking…</span>
        </div>
      {/if}
    </div>
    {#if chatError}<p class="opt-error" role="alert">{chatError}</p>{/if}
    <form
      class="chat-input"
      onsubmit={(e) => {
        e.preventDefault();
        void sendChat();
      }}
    >
      <textarea
        rows="2"
        placeholder="Describe what to change, or paste a plan you have in mind…"
        bind:value={draft}
        onkeydown={onChatKeydown}
        disabled={busy}
        aria-label="Chat input"
      ></textarea>
      <button type="submit" class="send-btn" disabled={busy || !draft.trim()}>
        {busy ? '…' : 'Send'}
      </button>
    </form>
  </section>
</div>

<style>
  .optimizer-sidebar {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(440px, 100vw);
    background: #fff;
    border-left: 1px solid #d4d4d8;
    box-shadow: -8px 0 24px rgba(0, 0, 0, 0.12);
    display: flex;
    flex-direction: column;
    z-index: 90;
  }
  .opt-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    background: #f4f9f5;
    border-bottom: 1px solid #d4d4d8;
  }
  .opt-head h3 {
    margin: 0;
    font-size: 1.05rem;
    color: #1f5e3a;
  }
  .opt-close {
    background: none;
    border: none;
    font-size: 1.5rem;
    line-height: 1;
    cursor: pointer;
    color: #555;
    width: 32px;
    height: 32px;
  }
  .opt-close:hover {
    color: #000;
  }
  .opt-facts {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid #e4e4e7;
    background: #fafafa;
  }
  .opt-facts h4 {
    margin: 0 0 0.4rem;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #525252;
  }
  .opt-facts ul {
    margin: 0;
    padding-left: 1.1rem;
    color: #333;
    font-size: 0.9rem;
  }
  .opt-facts li {
    margin: 0.2rem 0;
  }
  .opt-proposal {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid #e4e4e7;
    background: #ecfdf5;
  }
  .opt-proposal h4 {
    margin: 0 0 0.4rem;
    font-size: 0.95rem;
    color: #064e3b;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .diff-badge {
    background: #064e3b;
    color: #fff;
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 600;
  }
  .proposal-rationale {
    margin: 0 0 0.5rem;
    color: #064e3b;
    font-size: 0.85rem;
  }
  .apply-btn {
    background: #1f5e3a;
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 0.6rem 1rem;
    font-weight: 600;
    font-size: 0.95rem;
    cursor: pointer;
    min-height: 44px;
  }
  .apply-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .opt-chat {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .chat-log {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem 1rem;
  }
  .chat-msg {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    margin: 0.5rem 0;
  }
  .chat-role {
    flex: 0 0 auto;
    font-size: 1.1rem;
  }
  .chat-bubble {
    background: #f4f4f5;
    padding: 0.5rem 0.7rem;
    border-radius: 8px;
    white-space: pre-wrap;
    margin: 0;
    font-family: inherit;
    font-size: 0.9rem;
    color: #18181b;
    flex: 1;
    min-width: 0;
  }
  .chat-user .chat-bubble {
    background: #dbeafe;
  }
  .chat-thinking {
    font-style: italic;
    color: #6b7280;
  }
  .opt-error {
    color: #b91c1c;
    margin: 0.4rem 1rem;
    font-size: 0.85rem;
  }
  .chat-input {
    display: flex;
    gap: 0.4rem;
    padding: 0.5rem 0.75rem 0.75rem;
    border-top: 1px solid #e4e4e7;
    background: #fafafa;
  }
  .chat-input textarea {
    flex: 1;
    resize: vertical;
    min-height: 44px;
    max-height: 120px;
    padding: 0.45rem 0.6rem;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 0.9rem;
    font-family: inherit;
  }
  .send-btn {
    background: #1f5e3a;
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 0 1rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 44px;
  }
  .send-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  @media (max-width: 720px) {
    .optimizer-sidebar {
      width: 100vw;
    }
  }
</style>
