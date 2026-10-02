<script lang="ts">
  import type { CardCalendar, CardCalendarEntry } from '$lib/cards/model';
  import { calendarDayLabel } from '$lib/cards/build/calendar';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  interface Props {
    calendar: CardCalendar;
    /** `grid` is the printed calendar, `agenda` the screen list of days,
     *  `list` the printed page that names every task of a crowded card. */
    mode?: 'grid' | 'agenda' | 'list';
  }

  const { calendar, mode = 'agenda' }: Props = $props();
  const tr = $derived(createT(page.data?.locale));

  const days = $derived(calendar.weeks.flat().filter((d) => d.inPeriod));
  const busyDays = $derived(days.filter((d) => d.entries.length > 0));
  const links = $derived.by(() => {
    const urls: string[] = [];
    for (const d of days)
      for (const e of d.entries) if (e.seeUrl && !urls.includes(e.seeUrl)) urls.push(e.seeUrl);
    return urls;
  });
  function linkNo(e: CardCalendarEntry): number {
    return e.seeUrl ? links.indexOf(e.seeUrl) + 1 : 0;
  }
  const URL_SEP = ': ';
</script>

{#snippet entryLine(e: CardCalendarEntry, footnote: boolean)}
  <span class="t">{e.text}</span>{#if e.where}<span class="w">{`, ${e.where}`}</span
    >{/if}{#if e.who}<span class="who">{` · ${e.who}`}</span>{/if}{#if e.overdue}<span class="od"
      >{` ${tr('cardsui.cal.overdue')}`}</span
    >{/if}{#if e.see}<span class="see"
      >{`. ${e.see}`}{#if footnote && e.seeUrl}{` [${linkNo(e)}]`}{:else if e.seeUrl}{URL_SEP}<span
          class="url">{e.seeUrl}</span
        >{/if}</span
    >{/if}
{/snippet}

{#if mode === 'grid'}
  <div class="cal-grid period-{calendar.period}" data-testid="card-calendar-grid">
    <table>
      <thead>
        <tr>
          {#each calendar.weekdays as w (w)}
            <th scope="col">{w}</th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each calendar.weeks as row, r (r)}
          <tr>
            {#each row as d (d.ymd)}
              <td
                class:out={!d.inPeriod}
                class:earlier={d.earlier}
                class:today={d.today}
                data-ymd={d.ymd}
              >
                {#if d.inPeriod}
                  <div class="day">{d.label}</div>
                  {#if d.earlier}
                    <div class="note">{tr('cardsui.cal.notOnCard')}</div>
                  {:else}
                    <ul>
                      {#each d.entries.slice(0, calendar.perDay) as e, i (i)}
                        <li class:overdue={e.overdue}>{@render entryLine(e, true)}</li>
                      {/each}
                    </ul>
                    {#if d.entries.length > calendar.perDay}
                      <div class="more" data-testid="calendar-more">
                        {tr('cardsui.cal.more', { count: d.entries.length - calendar.perDay })}
                      </div>
                    {/if}
                  {/if}
                {/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
    {#if links.length}
      <ol class="links" aria-label={tr('cardsui.cal.sprayLinks')}>
        {#each links as url, i (url)}
          <li><span class="n">[{i + 1}]</span> <span class="url">{url}</span></li>
        {/each}
      </ol>
    {/if}
  </div>
{:else}
  <div
    class="cal-list mode-{mode}"
    data-testid={mode === 'list' ? 'card-calendar-list' : 'card-calendar-agenda'}
  >
    {#if busyDays.length === 0}
      <p class="empty">{tr('cardsui.cal.nothing')}</p>
    {/if}
    {#each busyDays as d (d.ymd)}
      <section class="list-day" data-ymd={d.ymd}>
        <h5>
          {calendarDayLabel(d.ymd, page.data?.locale)}{d.today
            ? `, ${tr('cardsui.cal.today')}`
            : ''}
        </h5>
        <ul>
          {#each d.entries as e, i (i)}
            <li class:overdue={e.overdue}>{@render entryLine(e, false)}</li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>
{/if}

<style>
  .cal-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .list-day h5 {
    margin: 0 0 2px;
    font-size: var(--font-size-meta);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-ink-soft);
  }
  .list-day ul,
  .cal-grid ul {
    margin: 0;
    padding-left: 1.1em;
  }
  .list-day li {
    overflow-wrap: anywhere;
    color: var(--color-ink);
  }
  .od {
    font-weight: 700;
    color: var(--color-rust);
  }
  .url {
    font-family: var(--font-mono, monospace);
    overflow-wrap: anywhere;
  }
  .empty {
    margin: 0;
    color: var(--color-ink-soft);
  }
  .mode-list {
    column-count: 3;
    column-gap: 0.25in;
    font-size: 8.5pt;
    color: #000;
  }
  .mode-list .list-day {
    break-inside: avoid;
    margin-bottom: 0.08in;
  }
  .mode-list h5,
  .mode-list li,
  .mode-list .od {
    color: #000;
  }

  .cal-grid {
    display: flex;
    flex-direction: column;
    gap: 0.05in;
    flex: 1 1 auto;
    min-height: 0;
    color: #000;
  }
  .cal-grid table {
    width: 100%;
    height: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  .cal-grid th {
    font-size: 8pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    text-align: left;
    padding: 0 0.04in 0.02in;
    border-bottom: 1pt solid #000;
  }
  .cal-grid td {
    vertical-align: top;
    border: 0.5pt solid #777;
    padding: 0.03in 0.04in;
    overflow: hidden;
    font-size: 7.5pt;
    line-height: 1.2;
  }
  .period-week td {
    font-size: 8.5pt;
  }
  .cal-grid td.out {
    background: #f1f1f1;
  }
  .cal-grid td.earlier {
    background: repeating-linear-gradient(135deg, #eee 0 4px, #fff 4px 8px);
  }
  .cal-grid td.today .day {
    text-decoration: underline;
  }
  .cal-grid .day {
    font-weight: 700;
    font-size: 8.5pt;
  }
  .cal-grid li {
    overflow-wrap: anywhere;
  }
  .cal-grid .note,
  .cal-grid .more {
    font-style: italic;
  }
  .cal-grid .od {
    color: #000;
    text-transform: uppercase;
    font-size: 6.5pt;
  }
  .cal-grid .links {
    flex: 0 0 auto;
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 0 0.2in;
    font-size: 7pt;
  }
  .cal-grid .n {
    font-weight: 700;
  }
</style>
