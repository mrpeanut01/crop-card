<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
  import { cropDisplayName } from '$lib/i18n/cropName';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import AiLimitNudge from '$lib/components/billing/AiLimitNudge.svelte';
  import BriefForm from '$lib/components/garden/brief/BriefForm.svelte';
  import BriefChat from '$lib/components/garden/brief/BriefChat.svelte';
  import BriefShortlist from '$lib/components/garden/brief/BriefShortlist.svelte';
  import { SPRAY_REDIRECT } from '$lib/journal/photoHelp';
  import { designerHref } from '$lib/garden/design';
  import { designerCropsParam } from '$lib/garden/brief/handoff';
  import {
    MAX_BRIEF_CHAT_TURNS,
    transcriptLines,
    type BriefAnswers,
    type BriefChatLine,
    type BriefQuestion,
    type GardenBrief,
    type SharedGardenBrief
  } from '$lib/garden/brief/schema';
  import type { AiLimit } from '$lib/billing/aiLimit';

  const { data } = $props();
  const tr = $derived(createT(page.data?.locale));
  const locale = $derived(page.data?.locale ?? null);

  let ready = $state(false);
  onMount(() => {
    ready = true;
  });

  let brief = $state<GardenBrief | SharedGardenBrief | null>(untrack(() => data.brief));
  let answers = $state<BriefAnswers>(untrack(() => structuredClone(data.brief?.answers ?? {})));
  let turnsLeft = $state(untrack(() => data.turnsLeft));
  // #870 (FU870-3): a returning owner sees the turns stored with the brief.
  let lines = $state<BriefChatLine[]>(
    untrack(() =>
      transcriptLines(
        data.brief && 'transcript' in data.brief ? data.brief.transcript : undefined,
        tr('herbsa.chat.formReply')
      )
    )
  );
  const showChat = $derived(data.aiEnabled || lines.length > 0);
  let followUp = $state<BriefQuestion | null>(null);
  let busy = $state(false);
  let status = $state<string | null>(null);
  let failure = $state<string | null>(null);
  let banner = $state<string | null>(null);
  let aiLimit = $state<AiLimit | null>(null);
  let sprayRedirect = $state(false);
  let confirmStartOver = $state(false);
  let usageKey = $state(0);

  const rows = $derived(brief?.shortlist ?? []);
  const anyFallback = $derived(rows.some((r) => r.provenance === 'fallback'));
  const sunWarning = $derived(answers.sun?.value === 'half-day' || answers.sun?.value === 'shade');
  const designerLink = $derived(
    data.gardenAreaId && rows.length > 0
      ? `${designerHref(data.gardenAreaId)}?crops=${encodeURIComponent(designerCropsParam(rows))}`
      : null
  );
  const herbName = (id: string) => {
    const h = data.herbs.find((x) => x.pluginId === id);
    return h ? cropDisplayName(h.pluginId, h.displayName, locale) : id;
  };

  async function send(url: string, method: string, body?: unknown): Promise<unknown | null> {
    busy = true;
    status = null;
    failure = null;
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        failure = json.error ?? tr('herbsa.err.save');
        return null;
      }
      return json;
    } catch {
      failure = tr('herbsa.err.offline');
      return null;
    } finally {
      busy = false;
    }
  }

  async function save() {
    const out = (await send('/api/garden/brief', 'PUT', { answers })) as {
      brief: GardenBrief;
    } | null;
    if (!out) return;
    brief = out.brief;
    banner = null;
    sprayRedirect = false;
    status = tr('herbsa.status.saved');
  }

  async function remove(pluginId: string) {
    if (!brief) return;
    const shortlist = brief.shortlist.filter((r) => r.cropPluginId !== pluginId);
    const out = (await send('/api/garden/brief', 'PUT', { answers, shortlist })) as {
      brief: GardenBrief;
    } | null;
    if (out) brief = out.brief;
  }

  async function startOver() {
    if (!confirmStartOver) {
      confirmStartOver = true;
      return;
    }
    confirmStartOver = false;
    const out = await send('/api/garden/brief', 'DELETE');
    if (!out) return;
    brief = null;
    answers = {};
    lines = [];
    followUp = null;
    turnsLeft = MAX_BRIEF_CHAT_TURNS;
    status = tr('herbsa.status.cleared');
  }

  async function chat(message: string) {
    const history = lines
      .slice(-MAX_BRIEF_CHAT_TURNS * 2)
      .map((l) => ({ role: l.role, text: l.text }));
    lines = [...lines, { role: 'user', text: message }];
    const out = (await send('/api/garden/brief/chat', 'POST', {
      message,
      answers,
      history
    })) as {
      reply: string;
      followUp: BriefQuestion | null;
      provenance: 'ai' | 'fallback';
      message: string | null;
      sprayRedirect: boolean;
      turnsLeft: number;
      aiLimit?: AiLimit | null;
      brief: GardenBrief;
    } | null;
    usageKey += 1;
    if (!out) return;
    lines = [...lines, { role: 'assistant', text: out.reply, provenance: out.provenance }];
    followUp = out.followUp;
    banner = out.message;
    aiLimit = out.aiLimit ?? null;
    sprayRedirect = out.sprayRedirect;
    turnsLeft = out.turnsLeft;
    brief = out.brief;
  }
</script>

<svelte:head><title>{tr('herbsa.docTitle')} · CropCard</title></svelte:head>

<div class="brief" data-testid="garden-brief" data-ready={ready}>
  <header class="no-print">
    <Kicker>{tr('herbsa.kicker')}</Kicker>
    <h1 class="serif">{tr('herbsa.title')}</h1>
    <p class="lede">{tr('herbsa.lede')}</p>
    {#if !data.canEdit}
      <p class="ask" data-testid="brief-ask-owner">{tr('herbsa.askOwner')}</p>
    {/if}
  </header>

  {#if status}<p class="status no-print" role="status">{status}</p>{/if}
  {#if failure}<p class="error no-print" role="alert">{failure}</p>{/if}

  <div class="columns no-print" class:with-chat={showChat}>
    <section class="form-col" aria-labelledby="brief-form-title">
      <h2 id="brief-form-title" class="serif">{tr('herbsa.form.title')}</h2>
      <BriefForm bind:answers herbs={data.herbs} disabled={!data.canEdit || !ready} />
      {#if data.canEdit}
        <div class="actions">
          <button type="button" class="primary" disabled={busy || !ready} onclick={save}>
            {tr('herbsa.form.save')}
          </button>
          {#if brief}
            <button type="button" class="ghost" disabled={busy || !ready} onclick={startOver}>
              {confirmStartOver ? tr('herbsa.form.startOverConfirm') : tr('herbsa.form.startOver')}
            </button>
          {/if}
        </div>
      {/if}
    </section>
    {#if showChat}
      <BriefChat
        {lines}
        {turnsLeft}
        {busy}
        {followUp}
        refreshKey={usageKey}
        onSend={chat}
        readOnly={!data.aiEnabled}
      />
    {/if}
  </div>

  <section class="result" aria-labelledby="brief-result-title" data-testid="brief-result">
    <h2 id="brief-result-title" class="serif no-print">{tr('herbsa.result.title')}</h2>
    {#if banner}
      <p class="banner no-print" data-testid="brief-fallback">{banner}</p>
      <AiLimitNudge limit={aiLimit} isOwner={data.canEdit} />
    {/if}
    {#if sprayRedirect}
      <p class="banner no-print" lang="en" data-english-only="safety">{SPRAY_REDIRECT}</p>
    {/if}
    {#if rows.length === 0}
      <p class="empty no-print">{tr('herbsa.result.empty')}</p>
    {:else}
      {#if anyFallback}<p class="note no-print">{tr('herbsa.result.appSuggestions')}</p>{/if}
      {#if sunWarning}<p class="note no-print" data-testid="brief-sun-warning">
          {tr('herbsa.result.sunWarning')}
        </p>{/if}
      <div class="no-print">
        <BriefShortlist
          {rows}
          herbs={data.herbs}
          lifecycle={data.lifecycle}
          toxic={data.toxic}
          petSpecies={data.petSpecies}
          speciesPlural={data.speciesPlural}
          canEdit={data.canEdit}
          {busy}
          onRemove={remove}
        />
      </div>
      {#if data.canEdit}
        <div class="handoff no-print">
          <a class="primary" href="/plan?wizard=allocation&brief=1" data-testid="brief-plan"
            >{tr('herbsa.handoff.plan')}</a
          >
          {#if designerLink}
            <a class="ghost" href={designerLink} data-testid="brief-designer"
              >{tr('herbsa.handoff.designer')}</a
            >
          {/if}
        </div>
        <p class="note no-print">{tr('herbsa.handoff.seedlingNote')}</p>
      {/if}
      <section class="buy" aria-labelledby="brief-buy-title" data-testid="brief-buy">
        <h2 id="brief-buy-title" class="serif">{tr('herbsa.buy.title')}</h2>
        <p class="note">{tr('herbsa.buy.lede')}</p>
        <ul>
          {#each rows as row (row.cropPluginId)}
            <li><span class="box" aria-hidden="true"></span>{herbName(row.cropPluginId)}</li>
          {/each}
        </ul>
        <button type="button" class="ghost no-print" onclick={() => window.print()}>
          {tr('herbsa.buy.print')}
        </button>
      </section>
    {/if}
  </section>
</div>

<style>
  .brief {
    max-width: 1080px;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }
  h1 {
    margin: 0;
  }
  h2 {
    margin: 0 0 var(--space-2);
    font-size: 1.15rem;
  }
  .lede,
  .ask {
    margin: var(--space-1) 0 0;
  }
  .ask,
  .note,
  .empty {
    color: var(--color-ink-soft);
  }
  .note,
  .empty {
    margin: 0 0 var(--space-2);
  }
  .columns {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
  }
  .columns.with-chat {
    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
    align-items: start;
  }
  @media (max-width: 860px) {
    .columns.with-chat {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .form-col {
    min-width: 0;
  }
  .actions,
  .handoff {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }
  .primary,
  .ghost {
    min-height: 48px;
    display: inline-flex;
    align-items: center;
    padding: 0 var(--space-3);
    border-radius: var(--radius-input);
    border: 1px solid var(--color-forest);
    font: inherit;
    font-weight: 600;
    text-decoration: none;
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
  .status {
    margin: 0;
    color: var(--color-forest);
  }
  .error {
    margin: 0;
    color: var(--color-rust-deep, #8a2f1d);
  }
  .banner {
    margin: 0 0 var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-left: 4px solid var(--color-honey-deep, #6a4f00);
    background: var(--color-honey-tint, #fff4d6);
    border-radius: 6px;
  }
  .buy {
    margin-top: var(--space-3);
    border: 1px dashed var(--color-rule);
    border-radius: var(--radius-card, 12px);
    padding: var(--space-3);
  }
  .buy ul {
    list-style: none;
    margin: 0 0 var(--space-2);
    padding: 0;
    columns: 2 12rem;
  }
  .buy li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 32px;
  }
  .box {
    width: 14px;
    height: 14px;
    border: 1.5px solid var(--color-ink);
    border-radius: 2px;
    flex: none;
  }
  @media print {
    .no-print {
      display: none !important;
    }
    .buy {
      border: 0;
      padding: 0;
    }
  }
</style>
