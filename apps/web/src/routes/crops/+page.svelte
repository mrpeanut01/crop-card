<script lang="ts">
  let { data } = $props();

  type Status = 'planned' | 'active' | 'harvested' | 'failed' | 'archived';
  const STATUSES: { id: Status; label: string }[] = [
    { id: 'active', label: 'Active' },
    { id: 'harvested', label: 'Harvested' },
    { id: 'planned', label: 'Planned' },
    { id: 'failed', label: 'Failed' },
    { id: 'archived', label: 'Archived' }
  ];

  function urlFor(status: Status): string {
    const params = new URLSearchParams();
    params.set('status', status);
    if (data.blockId) params.set('blockId', String(data.blockId));
    if (data.year) params.set('year', String(data.year));
    return `?${params.toString()}`;
  }

  function fmt(ms: number): string {
    return new Date(ms).toLocaleDateString();
  }
</script>

<h1>Crops</h1>
<p class="lede">
  Each Crop is one planting on one block — a Brewfather-style "Batch". All spray, harvest,
  fertility, hay, and insecticide events tie back to a Crop so you get a per-crop dashboard.
</p>

<nav class="tabs" role="tablist" aria-label="Crop status">
  {#each STATUSES as t (t.id)}
    <a
      class="tab"
      class:active={data.status === t.id}
      role="tab"
      aria-selected={data.status === t.id}
      href={urlFor(t.id)}
    >
      {t.label}
      <span class="count">{data.counts[t.id]}</span>
    </a>
  {/each}
</nav>

<form class="filter" method="GET">
  <input type="hidden" name="status" value={data.status} />
  <label>
    Block
    <select name="blockId">
      <option value="">All blocks</option>
      {#each data.blocks as b (b.id)}
        <option value={b.id} selected={b.id === data.blockId}>
          {b.name}{b.acres ? ` — ${b.acres} ac` : ''}
        </option>
      {/each}
    </select>
  </label>
  <label>
    Year
    <select name="year">
      <option value="">All years</option>
      {#each data.years as y (y)}
        <option value={String(y)} selected={String(y) === String(data.year)}>{y}</option>
      {/each}
    </select>
  </label>
  <button type="submit" class="primary">Filter</button>
</form>

<section class="card">
  {#if data.crops.length === 0}
    <p class="empty">No {data.status} crops match this filter.</p>
  {:else}
    <ul class="crop-list">
      {#each data.crops as c (c.id)}
        <li>
          <a class="crop-link" href="/crops/{c.id}">
            <header>
              <strong>{c.varietyDisplayName}</strong>
              <span class="status status-{c.status}">{c.status}</span>
            </header>
            <div class="meta">
              <span>{c.blockName}{c.blockAcres ? ` · ${c.blockAcres} ac` : ''}</span>
              <span>Planted {fmt(c.plantingDate)} · {c.daysSincePlanted}d ago</span>
              {#if c.daysToMaturity}
                <span>
                  DTM {c.daysToMaturity.min}–{c.daysToMaturity.max}d
                </span>
              {/if}
              {#if c.harvestedAt}
                <span class="meta-harvested">Harvested {fmt(c.harvestedAt)}</span>
              {/if}
            </div>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  h1 {
    margin: 0 0 0.5rem;
  }
  .lede {
    color: #555;
    margin: 0 0 1rem;
  }
  .tabs {
    display: flex;
    gap: 0;
    margin: 0 0 0.75rem;
    border-bottom: 2px solid #d0d7d0;
    overflow-x: auto;
  }
  .tab {
    padding: 0.6rem 1rem;
    color: #555;
    text-decoration: none;
    border-bottom: 3px solid transparent;
    margin-bottom: -2px;
    font-weight: 600;
    white-space: nowrap;
    min-height: 48px;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .tab.active {
    color: #1f5e3a;
    border-bottom-color: #1f5e3a;
    background: #f5f7f4;
  }
  .count {
    background: #d0d7d0;
    color: #1f5e3a;
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    font-size: 0.75rem;
  }
  .tab.active .count {
    background: #1f5e3a;
    color: white;
  }
  .filter {
    display: flex;
    gap: 0.6rem;
    align-items: end;
    flex-wrap: wrap;
    margin: 0 0 1rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
  }
  select {
    padding: 0.55rem;
    border: 2px solid #d0d7d0;
    border-radius: 4px;
    font-size: 1rem;
    min-height: 48px;
  }
  .primary {
    background: #1f5e3a;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.6rem 1.1rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 48px;
  }
  .card {
    background: white;
    padding: 0.5rem 0.75rem;
    border-radius: 8px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  .empty {
    color: #777;
    padding: 1rem;
  }
  .crop-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .crop-list li {
    border-bottom: 1px solid #eee;
  }
  .crop-list li:last-child {
    border-bottom: none;
  }
  .crop-link {
    display: block;
    padding: 0.75rem;
    text-decoration: none;
    color: inherit;
    border-radius: 4px;
  }
  .crop-link:hover {
    background: #f5f7f4;
  }
  .crop-link header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
    margin-bottom: 0.3rem;
  }
  .meta {
    display: flex;
    gap: 0.6rem;
    color: #666;
    font-size: 0.85rem;
    flex-wrap: wrap;
  }
  .meta-harvested {
    color: #b35900;
    font-weight: 600;
  }
  .status {
    padding: 0.1rem 0.5rem;
    border-radius: 3px;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
  }
  .status-active {
    background: #e7f1ea;
    color: #1f5e3a;
  }
  .status-harvested {
    background: #fff8e1;
    color: #b35900;
  }
  .status-planned {
    background: #e3edf9;
    color: #1f3a5e;
  }
  .status-failed {
    background: #fce4e4;
    color: #b00020;
  }
  .status-archived {
    background: #ddd;
    color: #555;
  }
</style>
