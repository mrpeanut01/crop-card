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
  import PhotoField from '$lib/components/animals/PhotoField.svelte';
  import MoveForm from '$lib/components/animals/MoveForm.svelte';
  import StatusForm from '$lib/components/animals/StatusForm.svelte';
  import FlagForm from '$lib/components/animals/FlagForm.svelte';
  import History from '$lib/components/animals/History.svelte';
  import AnimalEditForm from '$lib/components/animals/AnimalEditForm.svelte';
  import CarePlansPanel from '$lib/components/animals/CarePlansPanel.svelte';
  import {
    OFFLINE_MESSAGE,
    STATUS_LABEL,
    animalLabel,
    errorFromResponse
  } from '$lib/animals/display';
  import { animalFacts } from '$lib/animals/facts';
  import { buildHistory } from '$lib/animals/history';
  import { isOutcomeStatus } from '$lib/animals/model';
  import { DEFAULT_PREFS } from '$lib/prefs';
  import type { MoveOutcome } from '$lib/animals/moveClient';

  const { data } = $props();

  type Init = NonNullable<Parameters<typeof fetch>[1]>;

  const prefs = $derived(data.prefs ?? DEFAULT_PREFS);
  const animal = $derived(data.animal);
  const layout = $derived(data.profile.layout);
  const label = $derived(animalLabel(animal));
  const gone = $derived(isOutcomeStatus(animal.status));
  const archived = $derived(animal.status === 'archived');
  const areaNames = $derived(new Map(data.areas.map((a) => [a.id, a.name])));
  const groupNames = $derived(new Map(data.groupNames.map((g) => [g.id, g.name])));
  const livesAtId = $derived(animal.housingFieldId ?? data.group?.housingFieldId ?? null);
  const facts = $derived(
    animalFacts(
      {
        ...animal,
        speciesName: data.species?.displayName ?? 'Unknown kind',
        livesAt: livesAtId ? (areaNames.get(livesAtId) ?? null) : null,
        groupName: data.group?.name ?? null
      },
      layout
    )
  );
  const flagIsDefault = $derived(
    data.species ? animal.foodProducing === data.species.foodProducingDefault : false
  );
  const history = $derived(
    buildHistory({
      locations: data.locations,
      statusEvents: data.statusEvents,
      flagChanges: data.flagChanges,
      areaName: (id) => areaNames.get(id) ?? 'a place that was removed',
      groupName: (id) => groupNames.get(id) ?? 'a group',
      canUndo: data.canEdit,
      canVoid: data.canVoidHolds
    })
  );

  let panel = $state<'none' | 'move' | 'status' | 'edit'>('none');
  let message = $state<string | null>(null);
  let warnings = $state<{ message: string; animalId: string }[]>([]);
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
        actionError = await errorFromResponse(res);
        return;
      }
      if (typeof done === 'string') await refresh(done);
      else done();
    } catch {
      actionError = OFFLINE_MESSAGE;
    } finally {
      busy = false;
    }
  }

  const json = (body: unknown): Init => ({
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

  function stillHere() {
    void send(
      '/api/animals/status',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subjectType: 'animal', subjectId: animal.id, status: 'active' })
      },
      'Marked as still here.'
    );
  }

  function remove() {
    if (!confirm(`Delete ${label}? Use this only for a mistaken entry.`)) return;
    void send(`/api/animals/${animal.id}?ifEmpty=1`, { method: 'DELETE' }, () => {
      void goto('/animals');
    });
  }
</script>

<svelte:head>
  <title>{label} · {data.profile.title} · CropCard</title>
</svelte:head>

<div class="detail-page">
  <nav class="crumbs" aria-label="Breadcrumb">
    <a href="/animals">{data.profile.title}</a>
    {#if data.group}
      <span aria-hidden="true">›</span>
      <a href="/animals/groups/{data.group.id}">{data.group.name}</a>
    {/if}
  </nav>

  <article class="sheet" aria-labelledby="animal-title">
    <header class="head">
      <span class="badge"><SpeciesIcon icon={data.species?.icon} size={26} /></span>
      <div class="titles">
        <Kicker>
          {data.species?.displayName ?? 'Animal'}{animal.status !== 'active'
            ? ` · ${STATUS_LABEL[animal.status]}`
            : ''}
        </Kicker>
        <h1 id="animal-title" class="serif">{label}</h1>
      </div>
    </header>

    <div class="chips">
      <FoodChip
        foodProducing={animal.foodProducing}
        explanation={flagIsDefault
          ? (data.species?.explanation ?? null)
          : 'The owner changed this. The history shows why.'}
      />
      {#if animal.notForSlaughter}<Pill tone="sky">Not for slaughter</Pill>{/if}
      {#if gone}<Pill tone="neutral">No longer here</Pill>{/if}
      {#if archived}<Pill tone="neutral">Archived</Pill>{/if}
    </div>

    <HoldChips
      holds={data.holds}
      foods={data.foods}
      timeZone={prefs.timeZone}
      isOwner={data.canEdit}
      healthHref="/animals/{animal.id}/health"
    />
    {#if livesAtId}
      <ToxicPlantsCallout
        crops={data.toxicPlants[livesAtId]}
        speciesIds={[animal.speciesId]}
        speciesPlural={data.speciesPlural}
      />
    {/if}
    <nav class="record-links" aria-label="Records">
      <a class="af-ghost" href="/animals/{animal.id}/health">Health</a>
      <a class="af-ghost" href="/animals/{animal.id}/log">Eggs, milk and weights</a>
    </nav>

    <FactList {facts} />

    <PhotoField
      animalId={animal.id}
      name={label}
      hasPhoto={animal.hasPhoto}
      version={animal.updatedAt}
      canEdit={data.canLog}
      onDone={() => refresh('Photo saved.')}
    />

    {#if animal.notes}
      <section>
        <h2 class="section-title">Notes</h2>
        <p class="notes">{animal.notes}</p>
      </section>
    {/if}
  </article>

  {#if message}<p class="af-ok" role="status">{message}</p>{/if}

  {#if data.care.plans.length > 0 || (data.canEdit && animal.status === 'active')}
    <CarePlansPanel
      subjectId={animal.id}
      subjectName={label}
      plans={data.care.plans}
      cards={data.care.cards}
      todayYmd={data.todayYmd}
      isOwner={data.canEdit}
      canAct={data.canLog && animal.status === 'active'}
      active={animal.status === 'active'}
      products={data.care.products}
      stock={data.care.stock}
      onChanged={(t) => refresh(t)}
    />
  {/if}
  {#if warnings.length > 0}
    <ul class="af-note warn-list" role="status">
      {#each warnings as w (w.animalId + w.message)}
        <li><a href="/animals/{w.animalId}">{w.message}</a></li>
      {/each}
    </ul>
  {/if}
  {#if actionError}<p class="af-error" role="alert">{actionError}</p>{/if}

  {#if data.canLog && animal.status === 'active'}
    <section class="actions" aria-label="Actions">
      <div class="action-row">
        <button
          type="button"
          class={panel === 'move' ? 'af-primary' : 'af-ghost'}
          aria-expanded={panel === 'move'}
          onclick={() => (panel = panel === 'move' ? 'none' : 'move')}
        >
          Move
        </button>
        <button
          type="button"
          class={panel === 'status' ? 'af-primary' : 'af-ghost'}
          aria-expanded={panel === 'status'}
          onclick={() => (panel = panel === 'status' ? 'none' : 'status')}
        >
          Record a change
        </button>
        {#if data.canEdit}
          <button
            type="button"
            class={panel === 'edit' ? 'af-primary' : 'af-ghost'}
            aria-expanded={panel === 'edit'}
            onclick={() => (panel = panel === 'edit' ? 'none' : 'edit')}
          >
            Edit details
          </button>
        {/if}
      </div>
      {#if panel === 'move'}
        <MoveForm
          subjectType="animal"
          subjectId={animal.id}
          areas={data.housingAreas}
          currentFieldId={animal.groupId ? null : animal.housingFieldId}
          joinGroups={data.joinGroups}
          inGroup={data.group ? { id: data.group.id, name: data.group.name } : null}
          toxic={{
            byArea: data.toxicPlants,
            speciesIds: [animal.speciesId],
            speciesPlural: data.speciesPlural
          }}
          onDone={moved}
        />
      {:else if panel === 'status'}
        <StatusForm
          subjectType="animal"
          subjectId={animal.id}
          meatChoices={animal.foodProducing}
          onDone={(_, text) => refresh(text)}
        />
      {/if}
    </section>
  {:else if data.canLog && gone}
    <section class="actions" aria-label="Actions">
      <p class="af-help">Recorded by mistake? Mark it as still here. The history keeps both.</p>
      <div class="action-row">
        <button type="button" class="af-ghost" disabled={busy} onclick={stillHere}>
          It is still here
        </button>
        {#if data.canEdit}
          <button
            type="button"
            class={panel === 'edit' ? 'af-primary' : 'af-ghost'}
            onclick={() => (panel = panel === 'edit' ? 'none' : 'edit')}
          >
            Edit notes
          </button>
        {/if}
      </div>
    </section>
  {/if}

  {#if panel === 'edit' && data.canEdit}
    <AnimalEditForm
      {animal}
      {layout}
      notesOnly={gone}
      onDone={async (w) => {
        warnings = w;
        await refresh('Details saved.');
      }}
    />
  {/if}

  {#if data.canEdit && !gone}
    <section class="owner" aria-labelledby="owner-h">
      <h2 id="owner-h" class="section-title">Owner settings</h2>
      <div class="action-col">
        {#if !archived}
          <FlagForm
            subjectType="animal"
            subjectId={animal.id}
            flag="foodProducing"
            current={animal.foodProducing}
            onDone={(t) => refresh(t)}
          />
          {#if data.species?.notForSlaughterToggle}
            <FlagForm
              subjectType="animal"
              subjectId={animal.id}
              flag="notForSlaughter"
              current={animal.notForSlaughter}
              onDone={(t) => refresh(t)}
            />
          {/if}
        {/if}
        <div class="action-row">
          {#if archived}
            <button
              type="button"
              class="af-ghost"
              disabled={busy}
              onclick={() =>
                send(`/api/animals/${animal.id}`, json({ status: 'active' }), 'Restored.')}
            >
              Restore
            </button>
          {:else}
            <button
              type="button"
              class="af-ghost"
              disabled={busy}
              onclick={() =>
                send(`/api/animals/${animal.id}`, json({ status: 'archived' }), 'Archived.')}
            >
              Archive
            </button>
          {/if}
          <button type="button" class="af-danger" disabled={busy} onclick={remove}>Delete</button>
        </div>
        <p class="af-help">
          Archive hides it from lists and keeps its history. Delete is only for a mistaken entry
          with no records.
        </p>
      </div>
    </section>
  {/if}

  <section aria-labelledby="history-h">
    <h2 id="history-h" class="section-title">History</h2>
    <History
      entries={history}
      {prefs}
      onChanged={() => refresh('Removed.')}
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
    flex-wrap: wrap;
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
  .section-title {
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-card-title);
  }
  .notes {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
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
  .warn-list {
    margin: 0;
    padding-left: 2em;
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
