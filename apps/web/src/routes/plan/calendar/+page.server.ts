/**
 * Visual season calendar (FR-01 surface, planner persona).
 *
 * Pulls every planting from the DB, runs each through the calendar engine,
 * and groups events by week. The page renders a month grid with
 * color-coded events per day so the planner can visually verify their
 * season layout before commit.
 */

import type { PageServerLoad } from './$types';
import {
  eventsForPlanting,
  type CalendarEvent
} from '$lib/calendar/engine';
import { listBlocks } from '$lib/db/blocks';
import type { CropPlugin } from '$lib/plugins/schemas';
import { getRegistry } from '$lib/server/registry';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DayCell {
  iso: string; // YYYY-MM-DD
  inMonth: boolean;
  isToday: boolean;
  events: CalendarEvent[];
}

export const load: PageServerLoad = async ({ url }) => {
  const registry = await getRegistry();
  const blocks = listBlocks();

  // Aggregate every event from every planting.
  const allEvents: CalendarEvent[] = [];
  for (const b of blocks) {
    for (const p of b.plantings) {
      const rec = registry.get(p.cropPluginId);
      if (!rec || rec.plugin.type !== 'crop') continue;
      allEvents.push(...eventsForPlanting(p, rec.plugin as CropPlugin));
    }
  }

  // Determine month to render: ?ym=YYYY-MM, default to current month.
  const today = new Date();
  const ym = url.searchParams.get('ym');
  let year = today.getFullYear();
  let month = today.getMonth();
  if (ym) {
    const m = ym.match(/^(\d{4})-(\d{2})$/);
    if (m) {
      year = parseInt(m[1], 10);
      month = parseInt(m[2], 10) - 1;
    }
  }

  // Build a 6x7 grid starting from the Sunday on or before the 1st.
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());

  const todayIso = today.toISOString().slice(0, 10);
  const grid: DayCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getTime() + i * DAY_MS);
    const iso = d.toISOString().slice(0, 10);
    const dayStart = d.getTime();
    const dayEnd = dayStart + DAY_MS - 1;
    const eventsThisDay = allEvents
      .filter((e) => e.endMs >= dayStart && e.startMs <= dayEnd)
      .sort((a, b) => a.startMs - b.startMs);
    grid.push({
      iso,
      inMonth: d.getMonth() === month,
      isToday: iso === todayIso,
      events: eventsThisDay
    });
  }

  // Compute prev / next month strings for nav.
  const prev = new Date(year, month - 1, 1);
  const next = new Date(year, month + 1, 1);
  const fmtYM = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

  return {
    grid,
    monthLabel: firstOfMonth.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
    prev: fmtYM(prev),
    next: fmtYM(next),
    eventCountTotal: allEvents.length,
    blockCount: blocks.length
  };
};
