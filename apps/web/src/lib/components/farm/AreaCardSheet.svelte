<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import Modal from '$lib/components/ui/Modal.svelte';
  import CardView from '$lib/components/cards/CardView.svelte';
  import AreaDetailsFields from './AreaDetailsFields.svelte';
  import { buildAreaCard } from '$lib/cards/build';
  import { areaDisplayName, blockDisplayName, dueLabel, monthDay } from '$lib/cards/build/common';
  import type { FarmSnapshot } from '$lib/cards/snapshot';
  import {
    AREA_KINDS,
    AREA_KIND_LABELS,
    type AreaDetails,
    type AreaKind
  } from '$lib/farm/areaKinds';
  import {
    detailsFromDraft,
    detailsSummary,
    draftFromDetails,
    hasDetailFields,
    type DetailsDraft
  } from '$lib/farm/areaDetailsForm';
  import { designerHref, designerState } from '$lib/farm/designerRoute';
  import { kindStyle } from '$lib/farm/kindStyle';
  import { currentPrefs } from '$lib/prefsState.svelte';

  type Tab = 'details' | 'plantings' | 'tasks' | 'history';

  const {
    open,
    onClose,
    snapshot,
    area,
    canEdit,
    onEditShape,
    designerAvailable
  }: {
    open: boolean;
    onClose: () => void;
    snapshot: FarmSnapshot;
    area: { id: string; name: string; kind: AreaKind; details: AreaDetails | null };
    canEdit: boolean;
    onEditShape?: () => void;
    designerAvailable?: boolean;
  } = $props();

  let tab = $state<Tab>('details');
  let editing = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let draftName = $state('');
  let draftKind = $state<AreaKind>('field');
  let draftDetails = $state<DetailsDraft>({});

  const prefs = $derived(currentPrefs());
  const card = $derived(buildAreaCard(snapshot, area.id, { prefs }));
  const title = $derived(areaDisplayName(area));
  const style = $derived(kindStyle(area.kind));
  const designer = $derived(designerState(area.kind, designerAvailable));
  const summary = $derived(detailsSummary(area.kind, area.details));

  const blocks = $derived(snapshot.blocks.filter((b) => b.areaId === area.id));
  const blockById = $derived(new Map(blocks.map((b) => [b.id, b])));
  const plantings = $derived(snapshot.plantings.filter((p) => blockById.has(p.blockId)));
  const current = $derived(
    plantings.filter((p) => p.status === 'active' || p.status === 'planned')
  );
  const history = $derived(
    plantings
      .filter((p) => p.status === 'harvested')
      .sort((a, b) =>
        (b.harvestedAt ?? b.plantingDate ?? '').localeCompare(a.harvestedAt ?? a.plantingDate ?? '')
      )
  );
  const plantingIds = $derived(new Set(plantings.map((p) => p.id)));
  const tasks = $derived(
    snapshot.tasks
      .filter(
        (t) =>
          (t.blockId !== null && blockById.has(t.blockId)) ||
          (t.cropId !== null && plantingIds.has(t.cropId))
      )
      .sort((a, b) => a.scheduledFor - b.scheduledFor)
  );

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'details', label: 'Details' },
    { id: 'plantings', label: 'Plantings' },
    { id: 'tasks', label: 'Tasks' },
    { id: 'history', label: 'History' }
  ];

  $effect(() => {
    if (open) {
      void area.id;
      tab = 'details';
      editing = false;
      error = null;
    }
  });

  function where(blockId: string): string {
    const b = blockById.get(blockId);
    return b ? ` · ${blockDisplayName(b)}` : '';
  }

  function startEdit() {
    draftName = area.name;
    draftKind = area.kind;
    draftDetails = draftFromDetails(area.kind, area.details);
    error = null;
    editing = true;
  }

  function changeKind(kind: AreaKind) {
    draftKind = kind;
    draftDetails = draftFromDetails(kind, kind === area.kind ? area.details : null);
  }

  async function save() {
    const checked = detailsFromDraft(draftKind, draftDetails);
    if (!checked.ok) {
      error = 'Some details don’t look right. Check them and try again.';
      return;
    }
    if (!draftName.trim()) {
      error = 'Give it a name.';
      return;
    }
    saving = true;
    error = null;
    try {
      const res = await fetch(`/api/fields/${encodeURIComponent(area.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: draftName.trim(), kind: draftKind, details: checked.details })
      });
      if (!res.ok) {
        const out = await res.json().catch(() => ({}));
        error = out.error ?? `Couldn’t save (HTTP ${res.status}).`;
        return;
      }
      editing = false;
      await invalidateAll();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  function onTabKey(e: KeyboardEvent, i: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = (i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
    tab = TABS[next].id;
    document.getElementById(`area-tab-${TABS[next].id}`)?.focus();
  }
</script>

<Modal {open} {onClose} {title}>
  <div
    class="sheet"
    data-testid="area-card-sheet"
    data-area-kind={area.kind}
    style:--kind={style.color}
  >
    <div class="kind-row">
      <span class="swatch" aria-hidden="true"></span>
      <span class="kind">{AREA_KIND_LABELS[area.kind]}</span>
    </div>

    {#if designer !== 'none'}
      {#if designer === 'available'}
        <a class="designer primary" href={designerHref(area.id)}>Open designer</a>
      {:else}
        <button type="button" class="designer primary" disabled aria-describedby="designer-soon">
          Open designer
        </button>
        <p class="soon" id="designer-soon">Coming soon: lay out beds on a grid and place crops.</p>
      {/if}
    {/if}

    <div class="tabs" role="tablist" aria-label="Area card sections">
      {#each TABS as t, i (t.id)}
        <button
          type="button"
          role="tab"
          id="area-tab-{t.id}"
          aria-selected={tab === t.id}
          aria-controls="area-panel-{t.id}"
          tabindex={tab === t.id ? 0 : -1}
          class:active={tab === t.id}
          onclick={() => (tab = t.id)}
          onkeydown={(e) => onTabKey(e, i)}
        >
          {t.label}
          {#if t.id === 'plantings' && current.length}<span class="count">{current.length}</span
            >{/if}
          {#if t.id === 'tasks' && tasks.length}<span class="count">{tasks.length}</span>{/if}
        </button>
      {/each}
    </div>

    <div class="panel" role="tabpanel" id="area-panel-{tab}" aria-labelledby="area-tab-{tab}">
      {#if tab === 'details'}
        {#if editing}
          <form
            class="edit"
            onsubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label class="field">
              <span>Name</span>
              <input type="text" bind:value={draftName} maxlength="120" />
            </label>
            <label class="field">
              <span>Kind</span>
              <select
                value={draftKind}
                onchange={(e) => changeKind(e.currentTarget.value as AreaKind)}
              >
                {#each AREA_KINDS as k (k)}
                  <option value={k}>{AREA_KIND_LABELS[k]}</option>
                {/each}
              </select>
            </label>
            <AreaDetailsFields
              kind={draftKind}
              bind:draft={draftDetails}
              idPrefix="edit-{area.id}"
            />
            {#if error}<p class="error" role="alert">{error}</p>{/if}
            <div class="actions">
              <button type="submit" class="primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save details'}
              </button>
              <button type="button" class="secondary" onclick={() => (editing = false)}
                >Cancel</button
              >
            </div>
          </form>
        {:else}
          {#if card}<CardView {card} {prefs} />{/if}
          {#if summary.length}
            <dl class="details">
              {#each summary as row (row.label)}
                <div>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              {/each}
            </dl>
          {:else if hasDetailFields(area.kind) && canEdit}
            <p class="muted">No details yet. Add watering, structure or organic status any time.</p>
          {/if}
          {#if canEdit}
            <div class="actions">
              <button type="button" class="secondary" onclick={startEdit}>Edit details</button>
              {#if onEditShape}
                <button type="button" class="secondary" onclick={onEditShape}>Edit outline</button>
              {/if}
            </div>
          {/if}
        {/if}
      {:else if tab === 'plantings'}
        {#if current.length}
          <ul class="rows">
            {#each current as p (p.id)}
              <li>
                <span class="row-title">{p.varietyDisplayName}</span>
                <span class="row-meta">
                  {p.status === 'planned' ? 'Planned' : 'Growing'}{where(p.blockId)}{p.plantingDate
                    ? ` · ${monthDay(p.plantingDate)}`
                    : ''}
                </span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="muted">Nothing planted here yet.</p>
        {/if}
      {:else if tab === 'tasks'}
        {#if tasks.length}
          <ul class="rows">
            {#each tasks as t (t.id)}
              <li>
                <a class="row-link" href="/today?task={encodeURIComponent(t.id)}">
                  <span class="row-title">{t.title}</span>
                  <span class="row-meta"
                    >{dueLabel(t.scheduledFor, snapshot.generatedAt, prefs)}</span
                  >
                </a>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="muted">No open tasks here for the next month.</p>
        {/if}
      {:else if history.length}
        <ul class="rows">
          {#each history as p (p.id)}
            <li>
              <span class="row-title">{p.varietyDisplayName}</span>
              <span class="row-meta">
                {p.plantingDate ? monthDay(p.plantingDate) : 'Undated'}{where(
                  p.blockId
                )}{p.harvestedAt ? ` · harvested ${monthDay(p.harvestedAt)}` : ''}
              </span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="muted">No past plantings recorded here yet.</p>
      {/if}
    </div>
  </div>
</Modal>

<style>
  .sheet {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .kind-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--font-size-kicker, 11px);
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-ink-soft);
  }
  .swatch {
    width: 14px;
    height: 14px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--kind) 35%, transparent);
    border: 2px solid var(--kind);
  }
  .designer {
    align-self: flex-start;
  }
  .soon {
    margin: -6px 0 0;
    font-size: 12.5px;
    color: var(--color-ink-muted);
  }
  .tabs {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid var(--color-divider);
    overflow-x: auto;
  }
  .tabs button {
    min-height: 48px;
    padding: 0 14px;
    border: 0;
    border-bottom: 3px solid transparent;
    background: none;
    color: var(--color-ink-soft);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  .tabs button.active {
    color: var(--color-forest-deep);
    border-bottom-color: var(--color-forest);
  }
  .tabs button:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .count {
    margin-left: 6px;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--pill-forest-bg);
    color: var(--pill-forest-fg);
    font-size: 12px;
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .details {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 8px 16px;
    margin: 0;
  }
  .details dt {
    font-size: var(--font-size-meta, 11px);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-ink-soft);
  }
  .details dd {
    margin: 0;
    color: var(--color-ink);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .rows li {
    border-bottom: 1px solid var(--color-divider-soft);
  }
  .rows li,
  .row-link {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-height: 48px;
  }
  .rows li {
    padding: 6px 0;
  }
  .row-link {
    color: inherit;
    text-decoration: none;
  }
  .row-link:hover .row-title {
    text-decoration: underline;
  }
  .row-title {
    font-weight: 600;
    color: var(--color-ink);
  }
  .row-meta {
    font-size: 13px;
    color: var(--color-ink-muted);
  }
  .muted {
    margin: 0;
    color: var(--color-ink-muted);
    font-size: 14px;
  }
  .edit {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: var(--color-ink-soft);
  }
  .field input,
  .field select {
    min-height: 48px;
    padding: 0 10px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    background: var(--color-paper);
    color: var(--color-ink);
    font: inherit;
    font-size: 15px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .primary,
  .secondary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    padding: 0 18px;
    border-radius: var(--radius-input, 8px);
    font: inherit;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
  }
  .primary {
    background: var(--color-forest-deep);
    color: var(--color-paper);
    border: 0;
  }
  .primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .secondary {
    background: var(--color-paper);
    color: var(--color-forest-deep);
    border: 1px solid var(--color-divider);
  }
  .error {
    margin: 0;
    color: var(--color-rust);
    font-size: 13px;
  }
</style>
