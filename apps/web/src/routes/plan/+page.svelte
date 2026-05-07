<script lang="ts">
  import { invalidateAll } from '$app/navigation';

  let { data } = $props();

  let newBlockName = $state('');
  let newBlockAcres = $state<number | undefined>(undefined);
  let creatingBlock = $state(false);
  let blockError = $state<string | null>(null);

  async function createBlock() {
    if (!newBlockName.trim()) return;
    creatingBlock = true;
    blockError = null;
    try {
      const res = await fetch('/api/blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newBlockName.trim(), acres: newBlockAcres })
      });
      const out = await res.json();
      if (!res.ok) {
        blockError = out.error ?? `HTTP ${res.status}`;
        return;
      }
      newBlockName = '';
      newBlockAcres = undefined;
      await invalidateAll();
    } catch (e) {
      blockError = e instanceof Error ? e.message : String(e);
    } finally {
      creatingBlock = false;
    }
  }

  let plantingError = $state<string | null>(null);

  type CompanionSuggestion = {
    systemName: string;
    systemBenefit: string;
    members: Array<{
      cropPluginId: string;
      displayName: string;
      cropFamily: string;
      plantingOffsetDays: number;
      role: string;
    }>;
  };

  let advisor = $state<{
    blockId: string;
    primaryDateMs: number;
    suggestions: CompanionSuggestion[];
  } | null>(null);
  let advisorBusy = $state(false);

  async function addPlanting(blockId: string, cropPluginId: string, plantingDateIso: string) {
    plantingError = null;
    try {
      const res = await fetch(`/api/blocks/${encodeURIComponent(blockId)}/plantings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cropPluginId,
          plantingDate: new Date(plantingDateIso).getTime()
        })
      });
      const out = await res.json();
      if (!res.ok) {
        plantingError = out.error ?? `HTTP ${res.status}`;
        return;
      }
      await invalidateAll();

      // After a successful add, ask the server if there's a companion system
      // to suggest. Only fires for the planted family (currently corn).
      const advice = await fetch(
        `/api/blocks/${encodeURIComponent(blockId)}/companions?cropPluginId=${encodeURIComponent(cropPluginId)}`
      );
      if (advice.ok) {
        const adviceData = await advice.json();
        if (adviceData.suggestions?.length > 0) {
          advisor = {
            blockId,
            primaryDateMs: new Date(plantingDateIso).getTime(),
            suggestions: adviceData.suggestions
          };
        }
      }
    } catch (e) {
      plantingError = e instanceof Error ? e.message : String(e);
    }
  }

  async function acceptCompanions(suggestion: CompanionSuggestion) {
    if (!advisor) return;
    advisorBusy = true;
    try {
      for (const m of suggestion.members) {
        const date = advisor.primaryDateMs + m.plantingOffsetDays * 24 * 60 * 60 * 1000;
        const res = await fetch(`/api/blocks/${encodeURIComponent(advisor.blockId)}/plantings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cropPluginId: m.cropPluginId, plantingDate: date })
        });
        if (!res.ok) {
          const out = await res.json();
          plantingError = out.error ?? `HTTP ${res.status}`;
          return;
        }
      }
      advisor = null;
      await invalidateAll();
    } finally {
      advisorBusy = false;
    }
  }

  function dismissAdvisor() {
    advisor = null;
  }
</script>

<h1>Plan the season</h1>
<p class="lede">
  Create blocks and plantings. The calendar engine derives spray windows, companion-planting
  triggers, and harvest windows from each crop's DTM.
</p>

<a class="calendar-link" href="/plan/calendar">📅 View season calendar →</a>

{#if !data.canEdit}
  <section class="card role-notice">
    <h2>View only</h2>
    <p>
      Helper role can browse blocks + plantings but cannot create them. Sign in as Owner to plan the
      season.
    </p>
  </section>
{/if}

{#if data.canEdit}
  <section class="card">
    <h2>Create a block</h2>
    <div class="row">
      <input type="text" placeholder="e.g. Corn Block A" bind:value={newBlockName} />
      <input type="number" placeholder="acres" bind:value={newBlockAcres} step="0.1" min="0" />
      <button
        class="primary"
        onclick={createBlock}
        disabled={creatingBlock || !newBlockName.trim()}
      >
        {creatingBlock ? '…' : 'Create'}
      </button>
    </div>
    {#if blockError}
      <p class="error">{blockError}</p>
    {/if}
  </section>
{/if}

{#if data.blocks.length === 0}
  <section class="empty">
    <p>
      {#if data.canEdit}
        No blocks yet. Create one above to get started.
      {:else}
        No blocks yet. Sign in as Owner to create blocks.
      {/if}
    </p>
  </section>
{:else}
  {#each data.blocks as block (block.id)}
    {@const today = new Date().toISOString().slice(0, 10)}
    <section class="card block" id="block-{block.id}">
      <header>
        <h2>{block.name}</h2>
        {#if block.acres}<small>{block.acres} acres</small>{/if}
        <code>{block.id}</code>
      </header>

      <h3>Plantings</h3>
      {#if block.plantings.length === 0}
        <p class="empty-row">No plantings yet.</p>
      {:else}
        <ul class="plantings">
          {#each block.plantings as p (p.id)}
            {@const guide = data.plantingGuides[p.cropPluginId]}
            <li>
              <div class="planting-row">
                <strong>{p.varietyDisplayName}</strong>
                <code>{p.cropPluginId}</code>
                <span class="planted">planted {new Date(p.plantingDate).toLocaleDateString()}</span>
              </div>
              {#if guide}
                <details class="spacing-guide">
                  <summary>Spacing &amp; depth guide</summary>
                  <dl>
                    {#if guide.soilTempMinF !== undefined}
                      <dt>Soil temp min</dt>
                      <dd>{guide.soilTempMinF}°F</dd>
                    {/if}
                    {#if guide.rowSpacingIn !== undefined}
                      <dt>Row spacing</dt>
                      <dd>{guide.rowSpacingIn} in</dd>
                    {/if}
                    {#if guide.inRowSpacingIn}
                      <dt>In-row spacing</dt>
                      <dd>{guide.inRowSpacingIn.min}–{guide.inRowSpacingIn.max} in</dd>
                    {/if}
                    {#if guide.seedDepthIn}
                      <dt>Seed depth</dt>
                      <dd>{guide.seedDepthIn.min}–{guide.seedDepthIn.max} in</dd>
                    {/if}
                    {#if guide.seedsPerAcre !== undefined}
                      <dt>Seeds / acre</dt>
                      <dd>{guide.seedsPerAcre.toLocaleString()}</dd>
                    {/if}
                    {#if guide.recommendedLbsPerAcre !== undefined}
                      <dt>Recommended lbs / acre</dt>
                      <dd>{guide.recommendedLbsPerAcre}</dd>
                    {/if}
                  </dl>
                </details>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      {#if data.canEdit}
        <h3>Add planting</h3>
        <form
          onsubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget as HTMLFormElement);
            const cropId = fd.get('crop')?.toString() ?? '';
            const date = fd.get('date')?.toString() ?? '';
            if (cropId && date) addPlanting(block.id, cropId, date);
          }}
          class="row"
        >
          <select name="crop" required>
            <option value="">Select crop variety…</option>
            {#each data.crops as c}
              <option value={c.pluginId}>{c.displayName} ({c.cropFamily})</option>
            {/each}
          </select>
          <input type="date" name="date" value={today} required />
          <button type="submit" class="primary">Add</button>
        </form>
      {/if}
    </section>
  {/each}
  {#if plantingError}
    <p class="error">{plantingError}</p>
  {/if}
{/if}

{#if advisor}
  <div
    class="advisor-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="advisor-title"
    onclick={(e) => e.target === e.currentTarget && dismissAdvisor()}
    onkeydown={(e) => e.key === 'Escape' && dismissAdvisor()}
    tabindex="-1"
  >
    <div class="advisor-modal">
      <h2 id="advisor-title">🌽 Companion Advisor</h2>
      {#each advisor.suggestions as s (s.systemName)}
        <div class="suggestion">
          <h3>Add {s.systemName} companions?</h3>
          <p class="benefit">{s.systemBenefit}</p>
          <ul class="members">
            {#each s.members as m (m.cropPluginId)}
              <li>
                <strong>{m.displayName}</strong>
                <span class="role">{m.role}</span>
                <span class="offset">+{m.plantingOffsetDays} days</span>
              </li>
            {/each}
          </ul>
          <div class="actions">
            <button
              type="button"
              class="primary"
              disabled={advisorBusy}
              onclick={() => acceptCompanions(s)}
            >
              {advisorBusy ? 'Adding…' : `Add all ${s.members.length} companions`}
            </button>
            <button type="button" onclick={dismissAdvisor}>No thanks</button>
          </div>
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  h1 {
    margin: 0 0 0.25rem;
  }
  .lede {
    color: #555;
    margin: 0 0 1.5rem;
  }
  .card {
    background: white;
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
    border-radius: 8px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  .card h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
    color: #1f5e3a;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .card h3 {
    font-size: 0.85rem;
    color: #555;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 1rem 0 0.5rem;
  }
  .block header {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .block header code {
    margin-left: auto;
    font-size: 0.75rem;
    color: #888;
    background: #f5f5f5;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
  }
  .row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    align-items: stretch;
  }
  .row input,
  .row select {
    flex: 1;
    padding: 0.6rem;
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
    padding: 0.75rem 1.25rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 48px;
  }
  .primary:disabled {
    background: #999;
    cursor: not-allowed;
  }
  .error {
    color: #b00020;
  }
  .empty-row {
    color: #888;
    font-style: italic;
  }
  .empty {
    background: white;
    padding: 2rem;
    border-radius: 8px;
    text-align: center;
    color: #555;
  }
  .role-notice {
    border-left: 4px solid #b35900;
    background: #fff8ec;
  }
  .role-notice h2 {
    color: #b35900;
  }
  .calendar-link {
    display: inline-block;
    background: white;
    color: #1f5e3a;
    border: 2px solid #1f5e3a;
    padding: 0.6rem 1rem;
    border-radius: 6px;
    text-decoration: none;
    font-weight: 600;
    margin-bottom: 1rem;
    min-height: 44px;
    line-height: 1.4;
  }
  .calendar-link:hover {
    background: #f0f8f3;
  }
  .block:target {
    outline: 3px solid #ffd400;
    outline-offset: 2px;
  }
  .advisor-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }
  .advisor-modal {
    background: white;
    border-radius: 8px;
    padding: 1.5rem;
    max-width: 540px;
    width: 100%;
    border-top: 6px solid #1f5e3a;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  }
  .advisor-modal h2 {
    margin: 0 0 1rem;
    color: #1f5e3a;
    font-size: 1.3rem;
  }
  .suggestion h3 {
    margin: 0 0 0.5rem;
    color: #1f5e3a;
  }
  .benefit {
    color: #555;
    font-size: 0.9rem;
    margin: 0 0 1rem;
    line-height: 1.5;
  }
  .members {
    list-style: none;
    padding: 0;
    margin: 0 0 1rem;
  }
  .members li {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: #f8fbf9;
    border-radius: 4px;
    margin-bottom: 0.4rem;
    align-items: center;
  }
  .members .role {
    font-size: 0.8rem;
    color: #666;
  }
  .members .offset {
    font-family: monospace;
    color: #1f5e3a;
    font-weight: 700;
    background: white;
    padding: 0.1rem 0.5rem;
    border-radius: 3px;
  }
  .advisor-modal .actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .advisor-modal .actions button {
    flex: 1 1 auto;
    padding: 0.9rem;
    border-radius: 6px;
    border: 2px solid #1f5e3a;
    background: white;
    color: #1f5e3a;
    font-weight: 600;
    cursor: pointer;
    min-height: 56px;
  }
  .advisor-modal .actions .primary {
    background: #1f5e3a;
    color: white;
  }
  .plantings {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .plantings li {
    padding: 0.5rem;
    border-top: 1px solid #eee;
  }
  .plantings code {
    background: #f5f5f5;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.8rem;
    margin: 0 0.4rem;
  }
  .planting-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .planted {
    color: #555;
    font-size: 0.9rem;
  }
  .spacing-guide {
    margin-top: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: #f8fbf9;
    border-left: 3px solid #1f5e3a;
    border-radius: 0 4px 4px 0;
  }
  .spacing-guide summary {
    cursor: pointer;
    color: #1f5e3a;
    font-weight: 600;
    font-size: 0.9rem;
    list-style: revert;
  }
  .spacing-guide dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.3rem 0.75rem;
    margin: 0.5rem 0 0;
    font-size: 0.9rem;
  }
  .spacing-guide dt {
    color: #666;
  }
  .spacing-guide dd {
    margin: 0;
    color: #1f5e3a;
    font-weight: 600;
  }
</style>
