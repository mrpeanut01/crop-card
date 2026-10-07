<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import '$lib/components/animals/animalForms.css';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';
  import SpeciesIcon from '$lib/components/animals/SpeciesIcon.svelte';
  import FoodChip from '$lib/components/animals/FoodChip.svelte';
  import HoldChips from '$lib/components/animals/HoldChips.svelte';
  import ToxicPlantsCallout from '$lib/components/animals/ToxicPlantsCallout.svelte';
  import FactList from '$lib/components/animals/FactList.svelte';
  import AnimalRow from '$lib/components/animals/AnimalRow.svelte';
  import MoveForm from '$lib/components/animals/MoveForm.svelte';
  import StatusForm from '$lib/components/animals/StatusForm.svelte';
  import FlagForm from '$lib/components/animals/FlagForm.svelte';
  import GroupEditForm from '$lib/components/animals/GroupEditForm.svelte';
  import History from '$lib/components/animals/History.svelte';
  import CarePlansPanel from '$lib/components/animals/CarePlansPanel.svelte';
  import {
    animalName,
    errorText,
    groupNoun,
    pageTitle,
    statusLabel
  } from '$lib/components/animals/labels';
  import { groupFacts } from '$lib/animals/facts';
  import { buildHistory } from '$lib/animals/history';
  import { activeMembers } from '$lib/animals/counts';
  import { DEFAULT_PREFS } from '$lib/prefs';
  import type { MoveOutcome } from '$lib/animals/moveClient';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  const { data } = $props();
  const tr = $derived(createT(page.data?.locale));

  type Init = NonNullable<Parameters<typeof fetch>[1]>;

  const prefs = $derived(data.prefs ?? DEFAULT_PREFS);
  const group = $derived(data.group);
  const layout = $derived(data.profile.layout);
  const noun = $derived(data.species?.groupNoun ?? 'group');
  const nounText = $derived(groupNoun(tr, noun));
  const title = $derived(pageTitle(tr, layout));
  const archived = $derived(group.status === 'archived');
  const areaNames = $derived(new Map(data.areas.map((a) => [a.id, a.name])));
  const groupNames = $derived(new Map(data.groupNames.map((g) => [g.id, g.name])));
  const here = $derived(activeMembers(data.members));
  const goneMembers = $derived(data.members.filter((m) => m.status !== 'active'));
  const facts = $derived(
    groupFacts(
      {
        ...group,
        species: data.species ?? undefined,
        livesAt: group.housingFieldId ? (areaNames.get(group.housingFieldId) ?? null) : null
      },
      layout,
      page.data?.locale
    )
  );
  const flagIsDefault = $derived(
    data.species ? group.effectiveFoodProducing === data.species.foodProducingDefault : false
  );
  const history = $derived(
    buildHistory({
      locations: data.locations,
      statusEvents: data.statusEvents,
      flagChanges: data.flagChanges,
      areaName: (id) => areaNames.get(id) ?? tr('animals.history.removedPlace'),
      groupName: (id) => groupNames.get(id) ?? tr('animals.history.anotherGroup'),
      canUndo: data.canEdit,
      canVoid: data.canVoidHolds,
      locale: page.data?.locale
    })
  );

  let panel = $state<'none' | 'move' | 'status' | 'edit'>('none');
  let message = $state<string | null>(null);
  let emptied = $state(false);
  let actionError = $state<string | null>(null);
  let busy = $state(false);

  async function refresh(text?: string) {
    panel = 'none';
    if (text) message = text;
    await invalidateAll();
  }

  async function moved(outcome: MoveOutcome, text: string) {
    panel = 'none';
    message = text;
    if (outcome.status === 'saved') await invalidateAll();
  }

  async function send(url: string, init: Init, done: string | (() => void)) {
    busy = true;
    actionError = null;
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        actionError = await errorText(res, tr);
        return;
      }
      if (typeof done === 'string') await refresh(done);
      else done();
    } catch {
      actionError = tr('animals.offline');
    } finally {
      busy = false;
    }
  }

  const patch = (body: unknown): Init => ({
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

  function archive() {
    emptied = false;
    void send(
      `/api/animal-groups/${group.id}`,
      patch({ status: 'archived' }),
      tr('animals.archivedDone')
    );
  }

  function remove() {
    if (!confirm(tr('animals.detail.confirmDelete', { name: group.name }))) return;
    void send(`/api/animal-groups/${group.id}`, { method: 'DELETE' }, () => {
      void goto('/animals');
    });
  }
</script>

<svelte:head>
  <title>{group.name} · {title} · CropCard</title>
</svelte:head>

<div class="detail-page">
  <nav class="crumbs" aria-label={tr('animals.breadcrumb')}>
    <a href="/animals">{title}</a>
  </nav>

  <article class="sheet" aria-labelledby="group-title">
    <header class="head">
      <span class="badge"><SpeciesIcon icon={data.species?.icon} size={26} /></span>
      <div class="titles">
        <Kicker>
          {data.species?.label ?? tr('animals.detail.animals')} · {nounText}{archived
            ? ` · ${tr('animals.archived')}`
            : ''}
        </Kicker>
        <h1 id="group-title" class="serif">{group.name}</h1>
      </div>
    </header>
    <div class="chips">
      <FoodChip
        foodProducing={group.effectiveFoodProducing}
        explanation={flagIsDefault
          ? (data.species?.explanation ?? null)
          : tr('animals.detail.groupOwnerChanged')}
      />
      {#if archived}<Pill tone="neutral">{tr('animals.archived')}</Pill>{/if}
    </div>

    <HoldChips
      holds={data.holds}
      foods={data.foods}
      timeZone={prefs.timeZone}
      isOwner={data.canEdit}
      healthHref="/animals/{group.id}/health"
    />
    {#if group.housingFieldId}
      <ToxicPlantsCallout
        crops={data.toxicPlants[group.housingFieldId]}
        speciesIds={[group.speciesId]}
        speciesPlural={data.speciesPlural}
      />
    {/if}
    <nav class="record-links" aria-label={tr('animals.records')}>
      <a class="af-ghost" href="/animals/{group.id}/health">{tr('animals.health')}</a>
      <a class="af-ghost" href="/animals/{group.id}/log">{tr('animals.eggsMilkWeights')}</a>
    </nav>
    <FactList {facts} />
    {#if group.notes}
      <p class="notes">{group.notes}</p>
    {/if}
  </article>

  {#if message}<p class="af-ok" role="status">{message}</p>{/if}

  {#if data.care.plans.length > 0 || (data.canEdit && group.status === 'active')}
    <CarePlansPanel
      subjectId={group.id}
      subjectName={group.name}
      plans={data.care.plans}
      cards={data.care.cards}
      todayYmd={data.todayYmd}
      isOwner={data.canEdit}
      canAct={data.canLog && group.status === 'active'}
      active={group.status === 'active'}
      products={data.care.products}
      stock={data.care.stock}
      suggestionsLeft={data.care.suggestionsLeft}
      onChanged={(t) => refresh(t)}
    />
  {/if}
  {#if emptied && data.canEdit && !archived}
    <div class="af-note" role="status">
      <p class="emptied">{tr('animals.detail.noneLeft', { noun: nounText })}</p>
      <div class="action-row">
        <button type="button" class="af-primary" disabled={busy} onclick={archive}>
          {tr('animals.detail.archiveThis', { noun: nounText })}
        </button>
        <button type="button" class="af-ghost" onclick={() => (emptied = false)}
          >{tr('animals.detail.keepIt')}</button
        >
      </div>
    </div>
  {/if}
  {#if actionError}<p class="af-error" role="alert">{actionError}</p>{/if}

  {#if data.canLog && !archived}
    <section class="actions" aria-label={tr('animals.actions')}>
      <div class="action-row">
        <button
          type="button"
          class={panel === 'move' ? 'af-primary' : 'af-ghost'}
          aria-expanded={panel === 'move'}
          onclick={() => (panel = panel === 'move' ? 'none' : 'move')}
        >
          {tr('animals.moveAction')}
        </button>
        <button
          type="button"
          class={panel === 'status' ? 'af-primary' : 'af-ghost'}
          aria-expanded={panel === 'status'}
          onclick={() => (panel = panel === 'status' ? 'none' : 'status')}
        >
          {tr('animals.recordChange')}
        </button>
        {#if data.canEdit}
          <button
            type="button"
            class={panel === 'edit' ? 'af-primary' : 'af-ghost'}
            aria-expanded={panel === 'edit'}
            onclick={() => (panel = panel === 'edit' ? 'none' : 'edit')}
          >
            {tr('animals.edit')}
          </button>
        {/if}
      </div>
      {#if panel === 'move'}
        <MoveForm
          subjectType="group"
          subjectId={group.id}
          areas={data.housingAreas}
          currentFieldId={group.housingFieldId}
          group={{
            headCount: group.headCount,
            total: group.total,
            noun,
            members: here.map((m) => ({ id: m.id, label: animalName(tr, m) }))
          }}
          forage
          toxic={{
            byArea: data.toxicPlants,
            speciesIds: [group.speciesId],
            speciesPlural: data.speciesPlural
          }}
          onDone={moved}
        />
      {:else if panel === 'status'}
        <StatusForm
          subjectType="group"
          subjectId={group.id}
          headCount={group.headCount}
          {noun}
          meatChoices={group.effectiveFoodProducing}
          onDone={async (result, text) => {
            emptied = result.emptied;
            await refresh(text);
          }}
        />
      {:else if panel === 'edit' && data.canEdit}
        <GroupEditForm {group} {noun} onDone={() => refresh(tr('animals.saved'))} />
      {/if}
    </section>
  {/if}

  {#if here.length > 0}
    <section aria-labelledby="members-h">
      <h2 id="members-h" class="section-title">
        {tr('animals.detail.namedIn', { noun: nounText })}
      </h2>
      <ul class="rows">
        {#each here as m (m.id)}
          <li>
            <AnimalRow
              href="/animals/{m.id}"
              icon={data.species?.icon}
              title={animalName(tr, m)}
              meta={[data.species?.displayName]}
              foodProducing={m.foodProducing}
            />
          </li>
        {/each}
      </ul>
    </section>
  {/if}
  {#if goneMembers.length > 0}
    <details class="gone">
      <summary>{tr('animals.list.noLongerHere', { count: goneMembers.length })}</summary>
      <ul class="rows">
        {#each goneMembers as m (m.id)}
          <li>
            <AnimalRow
              href="/animals/{m.id}"
              icon={data.species?.icon}
              title={animalName(tr, m)}
              foodProducing={m.foodProducing}
              status={statusLabel(tr, m.status)}
            />
          </li>
        {/each}
      </ul>
    </details>
  {/if}

  {#if data.canEdit}
    <section class="owner" aria-labelledby="owner-h">
      <h2 id="owner-h" class="section-title">{tr('animals.ownerSettings')}</h2>
      <div class="action-col">
        {#if !archived}
          <FlagForm
            subjectType="group"
            subjectId={group.id}
            flag="foodProducing"
            current={group.foodProducing}
            onDone={(t) => refresh(t)}
          />
        {/if}
        <div class="action-row">
          {#if archived}
            <button
              type="button"
              class="af-ghost"
              disabled={busy}
              onclick={() =>
                send(
                  `/api/animal-groups/${group.id}`,
                  patch({ status: 'active' }),
                  tr('animals.restored')
                )}
            >
              {tr('animals.restore')}
            </button>
          {:else}
            <button type="button" class="af-ghost" disabled={busy} onclick={archive}>
              {tr('animals.archive')}
            </button>
          {/if}
          <button type="button" class="af-danger" disabled={busy} onclick={remove}
            >{tr('animals.delete')}</button
          >
        </div>
        <p class="af-help">
          {tr('animals.detail.groupArchiveHelp')}
        </p>
      </div>
    </section>
  {/if}

  <section aria-labelledby="history-h">
    <h2 id="history-h" class="section-title">{tr('animals.history')}</h2>
    <History
      entries={history}
      {prefs}
      onChanged={() => refresh(tr('animals.removed'))}
      onVoided={() => refresh('Voided.')}
    />
  </section>
</div>

<style>
  .detail-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    max-width: 720px;
    min-width: 0;
  }
  .crumbs {
    display: flex;
    gap: var(--space-2);
    font-size: var(--font-size-caption);
  }
  .crumbs a {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
  }
  .sheet {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--card-padding);
    border: 1px solid var(--color-divider);
    border-left: 4px solid var(--color-forest);
    border-radius: var(--radius-card);
    background: var(--color-paper);
    min-width: 0;
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .badge {
    flex: none;
    width: 48px;
    height: 48px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-pill);
    background: var(--pill-forest-bg);
    color: var(--color-forest-deep);
  }
  .titles {
    min-width: 0;
  }
  h1 {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  .notes {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .section-title {
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-card-title);
  }
  .actions,
  .owner {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .action-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .action-col {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-3);
  }
  .emptied {
    margin: 0 0 var(--space-2);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .gone summary {
    min-height: 48px;
    display: flex;
    align-items: center;
    cursor: pointer;
    font-weight: 600;
  }
  .record-links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .record-links a {
    display: inline-flex;
    align-items: center;
    text-decoration: none;
  }
</style>
