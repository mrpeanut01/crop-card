<script lang="ts">
  import { invalidateAll } from '$app/navigation';

  let { data } = $props();

  type EquipmentType =
    | 'sprayer'
    | 'planter'
    | 'drill'
    | 'rake'
    | 'baler'
    | 'tractor'
    | 'mower'
    | 'irrigation'
    | 'other';

  const allTypes: EquipmentType[] = [
    'sprayer',
    'planter',
    'drill',
    'rake',
    'baler',
    'tractor',
    'mower',
    'irrigation',
    'other'
  ];

  let typeFilter = $state<'all' | string>('all');
  const filtered = $derived(
    typeFilter === 'all' ? data.equipment : data.equipment.filter((e) => e.typeName === typeFilter)
  );

  let newTypeName = $state('');
  let newLabel = $state('');
  let newNotes = $state('');
  let creating = $state(false);
  let createError = $state<string | null>(null);

  /** Resolve newTypeName → typeId, prompting to add a new term if it doesn't
   *  match an existing equipment type. Returns { ok: false } when the user
   *  cancels the prompt or the create fails. */
  async function resolveTypeId(): Promise<{
    ok: boolean;
    typeId: string | null;
    legacyType: EquipmentType;
  }> {
    const name = newTypeName.trim();
    if (!name) {
      createError = 'Type is required';
      return { ok: false, typeId: null, legacyType: 'other' };
    }
    const existing = data.types.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      return { ok: true, typeId: existing.id, legacyType: nameToLegacyEnum(existing.name) };
    }
    const confirmed = confirm(
      `"${name}" isn't in your Equipment Type list yet.\n\nAdd it as a new Type?`
    );
    if (!confirmed) return { ok: false, typeId: null, legacyType: 'other' };
    const res = await fetch('/api/types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'equipment', name })
    });
    const out = await res.json();
    if (!res.ok) {
      createError = `Failed to add type: ${out.error ?? res.status}`;
      return { ok: false, typeId: null, legacyType: 'other' };
    }
    return { ok: true, typeId: out.type.id as string, legacyType: 'other' };
  }

  /** Map a Type name to the closest legacy enum value so the existing
   *  equipment.type column stays valid. User-added Types fall back to 'other'. */
  function nameToLegacyEnum(name: string): EquipmentType {
    const lower = name.toLowerCase();
    for (const t of allTypes) if (lower.includes(t)) return t;
    return 'other';
  }

  async function createEquipment() {
    if (!newLabel.trim()) return;
    creating = true;
    createError = null;
    try {
      const typeRes = await resolveTypeId();
      if (!typeRes.ok) {
        creating = false;
        return;
      }
      const res = await fetch('/api/equipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: typeRes.legacyType,
          typeId: typeRes.typeId,
          label: newLabel.trim(),
          notes: newNotes.trim() || undefined
        })
      });
      const out = await res.json();
      if (!res.ok) {
        createError = out.error ?? `HTTP ${res.status}`;
        return;
      }
      newLabel = '';
      newNotes = '';
      newTypeName = '';
      await invalidateAll();
    } catch (e) {
      createError = e instanceof Error ? e.message : String(e);
    } finally {
      creating = false;
    }
  }

  function fmt(ts?: number) {
    return ts ? new Date(ts).toLocaleDateString() : '—';
  }

  async function deleteEquipment(id: string, label: string) {
    if (
      !confirm(
        `Delete "${label}"? This removes its calibration history, hour-meter state, log entries, and pending calibrations. Tasks that referenced it will keep working but lose the equipment link.`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/equipment/${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
      if (!res.ok) {
        const out = await res.json().catch(() => ({}));
        alert(`Delete failed: ${out.error ?? res.status}`);
        return;
      }
      await invalidateAll();
    } catch (e) {
      alert(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const counts = $derived.by(() => {
    const m = new Map<string, number>();
    for (const e of data.equipment) m.set(e.typeName, (m.get(e.typeName) ?? 0) + 1);
    return m;
  });
</script>

<p class="redirect-banner">
  Looking for sprayer calibration + decon status?
  <a href="/inventory?type=sprayer">→ /inventory?type=sprayer</a>. This page stays for CRUD across
  all equipment types.
</p>

<h1>Equipment</h1>
<p class="lede">
  Field gear: planters, drills, rakes, balers, sprayers, tractors, mowers, irrigation. Sprayer-typed
  equipment carries the chemistry-history, decon, and GPA-calibration state the safety kernel reads
  on every spray.
</p>

<section class="card">
  <h2>Filter by type</h2>
  <div class="filters">
    <button class="chip" class:active={typeFilter === 'all'} onclick={() => (typeFilter = 'all')}>
      All ({data.equipment.length})
    </button>
    {#each [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])) as [name, c] (name)}
      <button class="chip" class:active={typeFilter === name} onclick={() => (typeFilter = name)}>
        {name} ({c})
      </button>
    {/each}
  </div>
</section>

{#if !data.canEdit}
  <section class="card role-notice">
    <h2>View only</h2>
    <p>Helper role can browse equipment + log maintenance entries. Owners create + retire.</p>
  </section>
{/if}

{#if data.canEdit}
  <section class="card">
    <h2>Add equipment</h2>
    <datalist id="equipment-type-suggestions">
      {#each data.types as t (t.id)}<option value={t.name}>{t.description ?? ''}</option>{/each}
    </datalist>
    <div class="row">
      <input
        type="text"
        list="equipment-type-suggestions"
        placeholder="Type (e.g. Tractor)"
        bind:value={newTypeName}
      />
      <input type="text" placeholder="e.g. John Deere 4020" bind:value={newLabel} />
      <input type="text" placeholder="notes (optional)" bind:value={newNotes} />
      <button
        class="primary"
        onclick={createEquipment}
        disabled={creating || !newLabel.trim() || !newTypeName.trim()}
      >
        {creating ? '…' : 'Add'}
      </button>
    </div>
    {#if newTypeName.trim() && !data.types.find((t) => t.name.toLowerCase() === newTypeName
            .trim()
            .toLowerCase())}
      <p class="hint-new-type">
        "{newTypeName.trim()}" is new — you'll be asked to confirm adding it on save.
      </p>
    {/if}
    {#if createError}<p class="error">{createError}</p>{/if}
  </section>
{/if}

{#if filtered.length === 0}
  <section class="card empty">
    <p>No equipment matching this filter.</p>
  </section>
{:else}
  <ul class="equipment-list">
    {#each filtered as e (e.id)}
      <li class="card item type-{e.type}">
        <header>
          <a href="/equipment/{e.id}"><strong>{e.label}</strong></a>
          <span class="type-badge">{e.typeName}</span>
          {#if e.retiredAt}<span class="retired">retired {fmt(e.retiredAt)}</span>{/if}
          <button
            class="delete-btn"
            onclick={() => deleteEquipment(e.id, e.label)}
            title="Delete"
            aria-label="Delete {e.label}"
          >
            🗑
          </button>
        </header>
        <dl>
          {#if e.type === 'sprayer'}
            <dt>GPA</dt>
            <dd>{e.state.calibratedGpa ?? '—'}</dd>
            <dt>Last load</dt>
            <dd>
              {#if e.state.lastChemistryClass}
                <span class="warn">{e.state.lastChemistryClass}</span>
                <a class="link" href="/spray/decon?sprayer={encodeURIComponent(e.id)}">Decon →</a>
              {:else}
                <span class="ok">clean</span>
              {/if}
            </dd>
            <dt>Last decon</dt>
            <dd>{fmt(e.state.lastDeconAt)}</dd>
          {:else}
            <dt>Hour meter</dt>
            <dd>{e.state.hourMeter ?? '—'}</dd>
            <dt>Last used</dt>
            <dd>{fmt(e.state.lastUsedAt)}</dd>
          {/if}
        </dl>
        {#if e.notes}<p class="notes">{e.notes}</p>{/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  h1 {
    margin: 0 0 0.25rem;
  }
  .redirect-banner {
    padding: 10px 14px;
    background: var(--color-cream);
    border-left: 3px solid var(--color-forest-deep);
    border-radius: 4px;
    margin: 0 0 16px;
    font-size: 13px;
    color: var(--color-ink);
    line-height: 1.45;
  }
  .redirect-banner a {
    color: var(--color-forest-deep);
    font-weight: 600;
    text-decoration: none;
  }
  .redirect-banner a:hover {
    text-decoration: underline;
  }
  .lede {
    color: var(--color-ink-muted);
    margin: 0 0 1.5rem;
  }
  .card {
    background: var(--color-paper);
    border-radius: var(--radius-card, 8px);
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  .card h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
    color: var(--color-forest-deep);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .filters {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .chip {
    background: var(--color-paper);
    border: 2px solid var(--color-divider);
    padding: 0.4rem 0.75rem;
    border-radius: var(--radius-input, 6px);
    cursor: pointer;
    text-transform: capitalize;
    font: inherit;
    min-height: 40px;
    color: var(--color-ink);
  }
  .chip.active {
    background: var(--color-forest-deep);
    color: var(--color-paper);
    border-color: var(--color-forest-deep);
  }
  .role-notice {
    border-left: 4px solid var(--color-wheat, #d4a75c);
    background: rgba(212, 167, 92, 0.12);
  }
  .role-notice h2 {
    color: var(--color-wheat, #d4a75c);
  }
  .row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .hint-new-type {
    font-size: 0.82rem;
    color: var(--color-ink-soft);
    margin: 0.4rem 0 0;
    font-style: italic;
  }
  .row input {
    flex: 1 1 120px;
    padding: 0.6rem;
    border: 2px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    font-size: 1rem;
    min-height: 48px;
    background: var(--color-paper);
    color: var(--color-ink);
  }
  .primary {
    background: var(--color-forest-deep);
    color: var(--color-paper);
    border: none;
    border-radius: var(--radius-input, 6px);
    padding: 0.75rem 1.25rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 48px;
  }
  .primary:disabled {
    background: var(--color-ink-muted);
    cursor: not-allowed;
  }
  .error {
    color: var(--color-rust, #ba4b38);
  }
  .empty {
    text-align: center;
    padding: 2rem;
    color: var(--color-ink-muted);
  }
  .equipment-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .item header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: 0.5rem;
  }
  .item header a {
    color: var(--color-forest-deep);
    text-decoration: none;
    font-weight: 700;
    font-size: 1.1rem;
  }
  .item header a:hover {
    text-decoration: underline;
  }
  .type-badge {
    background: rgba(44, 82, 55, 0.1);
    color: var(--color-forest-deep);
    padding: 0.1rem 0.5rem;
    border-radius: 3px;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
  }
  .retired {
    color: var(--color-ink-muted);
    font-style: italic;
    font-size: 0.85rem;
  }
  .delete-btn {
    margin-left: auto;
    background: transparent;
    border: 1px solid var(--color-divider);
    color: var(--color-rust, #ba4b38);
    padding: 0.2rem 0.5rem;
    border-radius: var(--radius-input, 6px);
    cursor: pointer;
    font-size: 0.9rem;
    min-height: 32px;
    min-width: 36px;
  }
  .delete-btn:hover {
    background: rgba(186, 75, 56, 0.08);
    border-color: var(--color-rust, #ba4b38);
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.4rem 1rem;
    margin: 0;
    font-size: 0.9rem;
  }
  dt {
    color: var(--color-ink-muted);
  }
  dd {
    margin: 0;
    color: var(--color-ink);
  }
  .warn {
    background: rgba(212, 167, 92, 0.18);
    color: var(--color-ink);
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-weight: 600;
    font-size: 0.85rem;
  }
  .ok {
    background: rgba(44, 82, 55, 0.1);
    color: var(--color-forest-deep);
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-weight: 600;
    font-size: 0.85rem;
  }
  .link {
    color: var(--color-rust, #ba4b38);
    text-decoration: none;
    font-weight: 600;
    margin-left: 0.5rem;
  }
  .notes {
    color: var(--color-ink-muted);
    font-size: 0.9rem;
    margin: 0.5rem 0 0;
  }
</style>
