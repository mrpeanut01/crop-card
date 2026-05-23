<!--
  GroupInspector.svelte (Phase 15)
  ────────────────────────────────
  Right-rail panel surfaced when a group bracket is opened on the swim-lane.
  Lists anchor + companions, materialized tasks per member, and exposes the
  Disband action. Companion-check tasks render with a "Confirm + nudge" UX so
  the operator can shift the companion's planting date when they verify the
  anchor's growth stage in field.
-->
<script lang="ts">
  type GroupMember = {
    cropId: string;
    cropPluginId: string;
    varietyDisplayName: string;
    cropFamily: string;
    plantingDateMs: number | null;
    role: 'anchor' | 'companion';
    offsetDays?: number;
  };

  type GroupTask = {
    id: string;
    title: string;
    cropId: string | null;
    scheduledForMs: number;
    completedAtMs?: number;
    pluginTemplateKey?: string;
    /** Set true when title looks like a companion-check task. */
    isCompanionCheck?: boolean;
    staleAnchor?: boolean;
  };

  let {
    groupId,
    systemKind,
    members,
    tasks,
    onClose,
    onDisband,
    onNudgeCompanion
  }: {
    groupId: string;
    systemKind: 'three-sisters' | 'succession' | 'manual';
    members: GroupMember[];
    tasks: GroupTask[];
    onClose: () => void;
    onDisband: () => void;
    onNudgeCompanion: (cropId: string, deltaDays: number) => void;
  } = $props();

  let confirmingDisband = $state(false);
  let nudgeOpenForCropId = $state<string | null>(null);
  let nudgeDelta = $state(0);

  function systemLabel(kind: 'three-sisters' | 'succession' | 'manual'): string {
    if (kind === 'three-sisters') return 'Three Sisters';
    if (kind === 'succession') return 'Succession';
    return 'Manual group';
  }

  function tasksForCrop(cropId: string): GroupTask[] {
    return tasks
      .filter((t) => t.cropId === cropId)
      .sort((a, b) => a.scheduledForMs - b.scheduledForMs);
  }

  function fmtDate(ms: number | null | undefined): string {
    return ms ? new Date(ms).toLocaleDateString() : '—';
  }

  const anchor = $derived(members.find((m) => m.role === 'anchor') ?? null);
  const companions = $derived(members.filter((m) => m.role === 'companion'));

  function startNudge(cropId: string) {
    nudgeOpenForCropId = cropId;
    nudgeDelta = 0;
  }
  function commitNudge() {
    if (nudgeOpenForCropId !== null && nudgeDelta !== 0) {
      onNudgeCompanion(nudgeOpenForCropId, nudgeDelta);
    }
    nudgeOpenForCropId = null;
    nudgeDelta = 0;
  }
  function cancelNudge() {
    nudgeOpenForCropId = null;
    nudgeDelta = 0;
  }
</script>

<aside class="group-inspector" aria-label="Planting group inspector">
  <header class="head">
    <div>
      <h3>{systemLabel(systemKind)}</h3>
      <p class="group-id">id: {groupId.slice(0, 8)}…</p>
    </div>
    <button type="button" class="close" onclick={onClose} aria-label="Close inspector">×</button>
  </header>

  <section class="members">
    {#if anchor}
      <article class="member member-anchor">
        <header>
          <span class="role-badge" aria-hidden="true">⚓</span>
          <strong>{anchor.varietyDisplayName}</strong>
          <span class="family">{anchor.cropFamily}</span>
        </header>
        <p class="meta">Plant date: {fmtDate(anchor.plantingDateMs)}</p>
        <ul class="task-list">
          {#each tasksForCrop(anchor.cropId) as t (t.id)}
            <li class:done={!!t.completedAtMs} class:stale={t.staleAnchor}>
              <span class="task-date">{fmtDate(t.scheduledForMs)}</span>
              <span class="task-title">{t.title}</span>
              {#if t.completedAtMs}<span class="badge done-badge">done</span>{/if}
              {#if t.staleAnchor}<span class="badge stale-badge">stale</span>{/if}
            </li>
          {/each}
        </ul>
      </article>
    {/if}

    {#each companions as c (c.cropId)}
      <article class="member member-companion">
        <header>
          <strong>{c.varietyDisplayName}</strong>
          <span class="family">{c.cropFamily}</span>
          {#if c.offsetDays !== undefined}
            <span class="offset">+{c.offsetDays}d</span>
          {/if}
        </header>
        <p class="meta">
          Plant date: {fmtDate(c.plantingDateMs)}
          <button
            type="button"
            class="nudge-toggle"
            onclick={() => startNudge(c.cropId)}
            aria-label="Nudge {c.varietyDisplayName} planting date">Nudge ±days</button
          >
        </p>
        {#if nudgeOpenForCropId === c.cropId}
          <div class="nudge-form">
            <label>
              Δ days
              <input type="number" min="-30" max="30" bind:value={nudgeDelta} />
            </label>
            <button type="button" class="btn-primary" onclick={commitNudge}>Apply</button>
            <button type="button" class="btn-secondary" onclick={cancelNudge}>Cancel</button>
          </div>
        {/if}
        <ul class="task-list">
          {#each tasksForCrop(c.cropId) as t (t.id)}
            <li
              class:done={!!t.completedAtMs}
              class:stale={t.staleAnchor}
              class:check={t.isCompanionCheck}
            >
              <span class="task-date">{fmtDate(t.scheduledForMs)}</span>
              <span class="task-title">
                {#if t.isCompanionCheck}<span class="check-glyph" aria-hidden="true">⚑</span>{/if}
                {t.title}
              </span>
              {#if t.completedAtMs}<span class="badge done-badge">done</span>{/if}
              {#if t.staleAnchor}<span class="badge stale-badge">stale</span>{/if}
            </li>
          {/each}
        </ul>
      </article>
    {/each}
  </section>

  <footer class="foot">
    {#if !confirmingDisband}
      <button type="button" class="btn-danger" onclick={() => (confirmingDisband = true)}>
        Disband group
      </button>
    {:else}
      <p class="disband-warn">Members keep their plantings; group link clears. Confirm?</p>
      <button type="button" class="btn-danger" onclick={onDisband}>Yes, disband</button>
      <button type="button" class="btn-secondary" onclick={() => (confirmingDisband = false)}>
        Cancel
      </button>
    {/if}
  </footer>
</aside>

<style>
  .group-inspector {
    width: 280px;
    max-height: 75vh;
    overflow-y: auto;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
    background: #fff;
    display: flex;
    flex-direction: column;
    font-size: 0.85rem;
  }
  .head {
    display: flex;
    justify-content: space-between;
    padding: 0.6rem 0.8rem;
    border-bottom: 1px solid #e5e7eb;
    background: #f9fafb;
  }
  .head h3 {
    margin: 0;
    font-size: 0.95rem;
    color: #312e81;
  }
  .group-id {
    margin: 0;
    font-size: 0.7rem;
    color: #6b7280;
  }
  .close {
    background: transparent;
    border: none;
    font-size: 1.4rem;
    line-height: 1;
    cursor: pointer;
  }
  .members {
    padding: 0.6rem 0.8rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    flex: 1;
  }
  .member {
    border-left: 3px solid #cbd5e1;
    padding: 0.4rem 0.6rem;
    background: #fafafa;
    border-radius: 0 0.3rem 0.3rem 0;
  }
  .member-anchor {
    border-left-color: #b45309;
  }
  .member-companion {
    border-left-color: #312e81;
  }
  .member header {
    display: flex;
    gap: 0.4rem;
    align-items: baseline;
    flex-wrap: wrap;
  }
  .family {
    font-size: 0.7rem;
    background: #ede9fe;
    color: #5b21b6;
    padding: 0 0.3rem;
    border-radius: 2px;
    text-transform: capitalize;
  }
  .offset {
    background: #ecfeff;
    color: #0e7490;
    padding: 0 0.3rem;
    border-radius: 2px;
    font-size: 0.72rem;
  }
  .meta {
    margin: 0.3rem 0;
    font-size: 0.78rem;
    color: #4b5563;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .nudge-toggle {
    margin-left: auto;
    border: 1px solid #cbd5e1;
    background: #fff;
    padding: 0.15rem 0.4rem;
    border-radius: 2px;
    font-size: 0.7rem;
    cursor: pointer;
  }
  .nudge-form {
    display: flex;
    gap: 0.3rem;
    align-items: end;
    background: #f1f5f9;
    padding: 0.4rem;
    border-radius: 0.3rem;
    margin-bottom: 0.4rem;
  }
  .nudge-form label {
    display: flex;
    flex-direction: column;
    font-size: 0.72rem;
    gap: 0.15rem;
  }
  .nudge-form input {
    width: 70px;
    padding: 0.25rem;
    border: 1px solid #cbd5e1;
    border-radius: 2px;
  }
  .task-list {
    list-style: none;
    padding: 0;
    margin: 0.3rem 0 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .task-list li {
    display: flex;
    gap: 0.4rem;
    align-items: baseline;
    padding: 0.15rem 0.3rem;
    border-radius: 2px;
    font-size: 0.78rem;
  }
  .task-list li.check {
    background: #fef3c7;
  }
  .task-list li.done {
    color: #6b7280;
    text-decoration: line-through;
  }
  .task-list li.stale {
    opacity: 0.6;
  }
  .task-date {
    color: #6b7280;
    min-width: 70px;
    font-variant-numeric: tabular-nums;
  }
  .task-title {
    flex: 1;
  }
  .check-glyph {
    color: #ca8a04;
    margin-right: 0.15rem;
  }
  .badge {
    padding: 0 0.3rem;
    border-radius: 2px;
    font-size: 0.65rem;
  }
  .done-badge {
    background: #d1fae5;
    color: #065f46;
  }
  .stale-badge {
    background: #fee2e2;
    color: #b91c1c;
  }
  .foot {
    padding: 0.6rem 0.8rem;
    border-top: 1px solid #e5e7eb;
    background: #f9fafb;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .btn-primary,
  .btn-secondary,
  .btn-danger {
    padding: 0.4rem 0.7rem;
    border-radius: 0.25rem;
    cursor: pointer;
    min-height: 36px;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .btn-primary {
    background: #4338ca;
    color: #fff;
    border: 1px solid #312e81;
  }
  .btn-secondary {
    background: #fff;
    color: #4338ca;
    border: 1px solid #c7d2fe;
  }
  .btn-danger {
    background: #b91c1c;
    color: #fff;
    border: 1px solid #991b1b;
  }
  .disband-warn {
    margin: 0;
    font-size: 0.78rem;
    color: #b91c1c;
  }
</style>
