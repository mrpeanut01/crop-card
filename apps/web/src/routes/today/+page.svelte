<script lang="ts">
  import type { CalendarEvent } from '$lib/calendar/engine';

  let { data } = $props();

  function fmtRange(startMs: number, endMs: number) {
    const a = new Date(startMs).toLocaleDateString();
    if (startMs === endMs) return a;
    const b = new Date(endMs).toLocaleDateString();
    return `${a} – ${b}`;
  }

  /**
   * Map a calendar event to a deep-link URL + a button label so the user can
   * one-tap from "today's action" into the right page with context filled in.
   */
  function ctaFor(e: CalendarEvent): { href: string; label: string } | null {
    switch (e.kind) {
      case 'spray-window': {
        const stage = (e.detail?.stage as string | undefined) ?? null;
        const params = new URLSearchParams();
        params.set('block', e.blockId);
        if (stage) params.set('windowStage', stage);
        return {
          href: `/scout?${params.toString()}`,
          label: 'Scout this block →'
        };
      }
      case 'companion-trigger':
        return {
          href: `/plan#block-${e.blockId}`,
          label: 'Open block plan →'
        };
      case 'harvest-window':
        // The plantingId isn't carried on the event; jump to /harvest where
        // the readiness card with the right block + variety auto-focuses.
        return { href: `/harvest`, label: 'Open harvest →' };
      case 'cover-termination':
        return {
          href: `/spray?block=${encodeURIComponent(e.blockId)}&windowStage=BURNDOWN`,
          label: 'Plan burndown →'
        };
      case 'planting':
        return { href: `/plan#block-${e.blockId}`, label: 'Open block plan →' };
      case 'orchard-task': {
        const taskKey = (e.detail?.taskKey as string | undefined) ?? '';
        // Spray-related orchard tasks → spray flow; harvest → harvest page.
        if (taskKey === 'harvest') return { href: '/harvest', label: 'Open harvest →' };
        const isSpray = /spray|fungicide|oil/.test(taskKey);
        if (isSpray) {
          const params = new URLSearchParams({ block: e.blockId });
          return {
            href: `/spray?${params.toString()}`,
            label: 'Plan this orchard spray →'
          };
        }
        return { href: `/plan#block-${e.blockId}`, label: 'Open block plan →' };
      }
      case 'curing-progress':
      case 'curing-ready':
        return { href: '/harvest', label: 'Open harvest →' };
      case 'seasonal-task':
        return { href: `/plan#block-${e.blockId}`, label: 'Open block plan →' };
      case 'emergence':
        return null;
    }
    return null;
  }
</script>

<header class="today">
  <h1>Today</h1>
  <p class="date">{data.today}</p>
</header>

{#if !data.bootstrapDone}
  <section class="card bootstrap" aria-labelledby="bootstrap-title">
    <h2 id="bootstrap-title">Get started — UC-20</h2>
    <p class="bootstrap-lede">
      A few one-time setup steps. CropCard plans, calibrates, and records around blocks + sprayers —
      once these three are in place, the calendar drives the rest.
    </p>
    <ol class="bootstrap-steps">
      <li class:done={data.bootstrap.hasBlock && data.bootstrap.hasPlanting}>
        <span class="step-num" aria-hidden="true">
          {data.bootstrap.hasBlock && data.bootstrap.hasPlanting ? '✓' : '1'}
        </span>
        <div class="step-body">
          <strong>Add your first block & planting</strong>
          <small>
            {#if data.bootstrap.hasBlock && data.bootstrap.hasPlanting}
              Done.
            {:else if data.bootstrap.hasBlock}
              Block added. Now record a planting in it.
            {:else}
              A block is your field; a planting is what's growing in it.
            {/if}
          </small>
          {#if !(data.bootstrap.hasBlock && data.bootstrap.hasPlanting)}
            <a class="cta" href="/plan">Open Plan →</a>
          {/if}
        </div>
      </li>
      <li class:done={data.bootstrap.hasSprayer}>
        <span class="step-num" aria-hidden="true">
          {data.bootstrap.hasSprayer ? '✓' : '2'}
        </span>
        <div class="step-body">
          <strong>Register a sprayer</strong>
          <small>
            {#if data.bootstrap.hasSprayer}
              Done.
            {:else}
              The kernel won't let you spray without one — it tracks chemistry & decon state.
            {/if}
          </small>
          {#if !data.bootstrap.hasSprayer}
            <a class="cta" href="/equipment">Open Equipment →</a>
          {/if}
        </div>
      </li>
      <li class:done={data.bootstrap.hasCalibration}>
        <span class="step-num" aria-hidden="true">
          {data.bootstrap.hasCalibration ? '✓' : '3'}
        </span>
        <div class="step-body">
          <strong>Calibrate the sprayer</strong>
          <small>
            {#if data.bootstrap.hasCalibration}
              Done.
            {:else}
              UC-10 1/128-acre method. The dilution calculator scales every product rate by GPA.
            {/if}
          </small>
          {#if data.bootstrap.hasSprayer && !data.bootstrap.hasCalibration}
            <a class="cta" href="/calibrate">Open Calibrate →</a>
          {/if}
        </div>
      </li>
    </ol>
  </section>
{/if}

{#if data.lowStock.length > 0 || data.expiringStock.length > 0}
  <section class="stock-alerts" role="status" aria-live="polite">
    {#if data.lowStock.length > 0}
      <div class="stock-alert low">
        <strong
          >⚠ {data.lowStock.length} SKU{data.lowStock.length === 1 ? '' : 's'} low on stock:</strong
        >
        <ul>
          {#each data.lowStock as i (i.id)}
            <li>
              <a href="/stock/{i.id}">{i.displayName}</a>
              — {i.onHand}
              {i.defaultUnit} on hand (reorder at {i.reorderThreshold}
              {i.defaultUnit})
            </li>
          {/each}
        </ul>
      </div>
    {/if}
    {#if data.expiringStock.length > 0}
      <div class="stock-alert expiring">
        <strong
          >⏳ {data.expiringStock.length} lot{data.expiringStock.length === 1 ? '' : 's'} expiring within
          30 days:</strong
        >
        <ul>
          {#each data.expiringStock as e (e.itemId + (e.lotNumber ?? ''))}
            <li>
              <a href="/stock/{e.itemId}">{e.itemName}</a>
              {#if e.lotNumber}<code>{e.lotNumber}</code>{/if}
              — {e.balance}
              {e.unit}, {e.daysUntilExpiry} day{e.daysUntilExpiry === 1 ? '' : 's'} left
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </section>
{/if}

{#if data.eventsToday.length > 0}
  <section class="card today-actions">
    <h2>Today's actions</h2>
    <ul>
      {#each data.eventsToday as e (e.cropPluginId + e.title + e.startMs)}
        {@const cta = ctaFor(e)}
        <li class="event {e.kind}">
          <strong>{e.title}</strong>
          <small>{fmtRange(e.startMs, e.endMs)} · {e.varietyDisplayName}</small>
          {#if e.body}<p>{e.body}</p>{/if}
          {#if cta}
            <a class="cta" href={cta.href}>{cta.label}</a>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{:else}
  <section class="card empty">
    <h2>No scheduled action today</h2>
    <p>
      {#if data.counts.blocks === 0}
        Add a block on <a href="/plan">/plan</a> with a planting record to see calendar-driven actions
        here.
      {:else}
        Calendar engine has nothing for today. Plan a one-off spray on <a href="/spray">/spray</a> if
        needed.
      {/if}
    </p>
    <a href="/spray" class="primary">Plan a spray</a>
  </section>
{/if}

{#if data.upcoming.length > 0}
  <section class="card">
    <h2>Next 14 days</h2>
    <ul class="upcoming">
      {#each data.upcoming.slice(0, 12) as e (e.cropPluginId + e.title + e.startMs)}
        {@const cta = ctaFor(e)}
        <li class="event {e.kind}">
          <span class="when">{fmtRange(e.startMs, e.endMs)}</span>
          <strong>{e.title}</strong>
          <small>{e.varietyDisplayName}</small>
          {#if cta}<a class="cta-small" href={cta.href}>{cta.label}</a>{/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<section class="card">
  <h2>Sprayers</h2>
  <ul class="sprayers">
    {#each data.sprayers as s (s.id)}
      <li>
        <strong>{s.label}</strong>
        <span class="id">{s.id}</span>
        {#if s.lastChemistryClass}
          <span class="warn">last load: {s.lastChemistryClass}</span>
          <a href="/spray/decon?sprayer={encodeURIComponent(s.id)}" class="link">Decon →</a>
        {:else}
          <span class="ok">clean</span>
        {/if}
        {#if s.lastDeconAt}
          <span class="meta">decon {new Date(s.lastDeconAt).toLocaleString()}</span>
        {/if}
      </li>
    {/each}
  </ul>
</section>

<section class="card audit">
  <h2>Kernel</h2>
  <dl>
    <dt>Rules version</dt>
    <dd><code>{data.rulesVersion}</code></dd>
    <dt>Crops registered</dt>
    <dd>{data.counts.crops}</dd>
    <dt>Herbicides registered</dt>
    <dd>{data.counts.herbicides}</dd>
    <dt>Blocks defined</dt>
    <dd>{data.counts.blocks}</dd>
    {#if data.pluginFailures.length > 0}
      <dt>Plugin load failures</dt>
      <dd class="warn">
        <ul>
          {#each data.pluginFailures as f}<li>{f}</li>{/each}
        </ul>
      </dd>
    {/if}
  </dl>
</section>

<style>
  .today {
    margin-bottom: 1.5rem;
  }
  .today h1 {
    margin: 0;
  }
  .stock-alerts {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .stock-alert {
    padding: 0.75rem 1rem;
    border-radius: 6px;
    border-left: 4px solid #b35900;
    background: #fff3cd;
    color: #b35900;
  }
  .stock-alert.expiring {
    background: #fff8ec;
    border-left-color: #b00020;
    color: #b00020;
  }
  .stock-alert ul {
    margin: 0.4rem 0 0 1.25rem;
    padding: 0;
  }
  .stock-alert a {
    color: inherit;
    text-decoration: underline;
  }
  .stock-alert code {
    background: white;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.85rem;
  }
  .date {
    margin: 0;
    color: #555;
    font-family: monospace;
  }
  .card {
    background: white;
    border-radius: 8px;
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  .card h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
    color: #1f5e3a;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .empty {
    text-align: center;
    padding: 2rem 1rem;
  }
  .empty h2 {
    color: #555;
  }
  .primary {
    display: inline-block;
    background: #1f5e3a;
    color: white;
    padding: 0.9rem 1.5rem;
    border-radius: 6px;
    text-decoration: none;
    font-weight: 600;
    margin-top: 0.75rem;
    min-height: 48px;
    line-height: 1.4;
  }
  .today-actions ul,
  .upcoming {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .today-actions li,
  .upcoming li {
    padding: 0.6rem 0.75rem;
    border-left: 4px solid #1f5e3a;
    background: #f8fbf9;
    margin: 0.4rem 0;
    border-radius: 0 4px 4px 0;
  }
  .event small {
    color: #555;
    margin-left: 0.5rem;
    font-family: monospace;
  }
  .event.spray-window {
    border-left-color: #b35900;
    background: #fff8ec;
  }
  .event.companion-trigger {
    border-left-color: #4d8e36;
  }
  .event.harvest-window {
    border-left-color: #6b3fa0;
    background: #f5f0fa;
  }
  .event.cover-termination {
    border-left-color: #777;
  }
  .event p {
    margin: 0.25rem 0 0;
    font-size: 0.9rem;
  }
  .cta {
    display: inline-flex;
    align-items: center;
    margin-top: 0.5rem;
    background: #1f5e3a;
    color: white;
    text-decoration: none;
    padding: 0.9rem 1.25rem;
    border-radius: 4px;
    font-weight: 600;
    font-size: 1rem;
    min-height: 60px;
    line-height: 1.4;
  }
  .cta-small {
    margin-left: auto;
    color: #1f5e3a;
    text-decoration: none;
    font-weight: 600;
    font-size: 0.85rem;
    padding: 0.3rem 0.6rem;
    border: 1px solid #1f5e3a;
    border-radius: 4px;
  }
  .upcoming li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .upcoming .when {
    font-family: monospace;
    color: #555;
    min-width: 11rem;
  }
  .sprayers {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .sprayers li {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.5rem 0;
    border-top: 1px solid #eee;
  }
  .sprayers li:first-child {
    border-top: none;
  }
  .sprayers .id {
    font-family: monospace;
    color: #666;
    font-size: 0.85rem;
  }
  .sprayers .warn {
    background: #fff3cd;
    color: #b35900;
    padding: 0.15rem 0.5rem;
    border-radius: 3px;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .sprayers .ok {
    background: #e7f1ea;
    color: #1f5e3a;
    padding: 0.15rem 0.5rem;
    border-radius: 3px;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .sprayers .meta {
    color: #777;
    font-size: 0.8rem;
  }
  .sprayers .link {
    margin-left: auto;
    color: #b00020;
    text-decoration: none;
    font-weight: 600;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.4rem 1rem;
    margin: 0;
  }
  dt {
    color: #666;
  }
  dd {
    margin: 0;
  }
  dd code {
    background: #f5f5f5;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
  }
  .warn ul {
    margin: 0;
    padding-left: 1.25rem;
  }
  .bootstrap {
    background: #f8fbf9;
    border: 2px solid #1f5e3a;
  }
  .bootstrap h2 {
    color: #1f5e3a;
    text-transform: none;
    letter-spacing: 0;
    font-size: 1.2rem;
  }
  .bootstrap-lede {
    color: #555;
    margin: 0 0 1rem;
  }
  .bootstrap-steps {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .bootstrap-steps li {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.75rem;
    padding: 0.75rem;
    border-radius: 6px;
    background: white;
    border-left: 4px solid #1f5e3a;
  }
  .bootstrap-steps li.done {
    opacity: 0.65;
    border-left-color: #888;
  }
  .step-num {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: #1f5e3a;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 1.1rem;
  }
  .bootstrap-steps li.done .step-num {
    background: #4d8e36;
  }
  .step-body {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .step-body small {
    color: #555;
  }
  .step-body .cta {
    display: inline-flex;
    align-items: center;
    margin-top: 0.4rem;
    padding: 0.7rem 1rem;
    background: #1f5e3a;
    color: white;
    text-decoration: none;
    border-radius: 4px;
    font-weight: 600;
    min-height: 60px;
    line-height: 1.4;
    align-self: flex-start;
  }
</style>
