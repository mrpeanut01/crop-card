import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
  dismissGettingStarted,
  getGettingStartedDismissedAt,
  getOnboardingStatus,
  restoreGettingStarted
} from '$lib/onboarding/state.server';
import { loadGettingStartedFacts } from '$lib/onboarding/gettingStarted.server';
import { getFarmProfile } from '$lib/onboarding/state.server';
import { currentUser } from '$lib/server/auth';
import { countPlantings, listBlocks } from '$lib/db/blocks';
import { listHarvestEvents } from '$lib/db/harvestEvents';
import { listSprayEvents } from '$lib/db/sprayEvents';
import { listInsecticideEvents } from '$lib/db/insecticideEvents';
import { listFungicideEvents } from '$lib/db/fungicideEvents';
import { expiringSoon, lowStockItems } from '$lib/db/stock';
import { existingTemplateKeys, listTasks } from '$lib/db/tasks';
import { suggestionTemplateKey } from '$lib/today/calendar';
import {
  eventsForHarvest,
  eventsForPlanting,
  eventsToday,
  upcomingEvents,
  type CalendarEvent
} from '$lib/calendar/engine';
import type { CropPlugin } from '$lib/plugins/schemas';
import type { PluginRegistry } from '$lib/plugins';
import { listPlantingsForCardsByIds } from '$lib/db/cardSnapshot';
import { getRegistry } from '$lib/server/registry';
import { listSprayers } from '$lib/server/sprayers';
import { getUserAiEnabled } from '$lib/server/aiTry';
import { loadTodayWeather } from '$lib/server/todayWeather';
import { derivePriorityAction } from '$lib/today/priorityAction';
import { deriveSeasonGlance, startOfYear } from '$lib/today/seasonGlance';
import { deriveWinterizeAlerts, startOfSeason } from '$lib/today/winterizeAlert';
import { equipmentIdsActiveBefore, listEquipment } from '$lib/db/equipment';
import { prefsFor, farmTimeZone } from '$lib/db/userProfile';
import { todayYmd, ymdInZone } from '$lib/prefs';
import { addDaysYmd, calendarGrid, isYmd, resolveTodayParams } from '$lib/today/views';
import { firstDayOfWeek } from '$lib/intlCache';
import { loadSeasonView } from '$lib/today/seasonView.server';
import { needsDecon } from '$lib/equipment/decon';
import { todaySetupPrompts } from '$lib/onboarding/pageSetup';
import { getFarmLatLon, hasFarmLatLon } from '$lib/schedule/settings';
import { getSetting } from '$lib/db/settings';
import { SETTINGS_KEYS } from '$lib/schedule/constants';
import { coveredLogAlerts, healthPlugins } from '$lib/server/animalRecords';

const DAY_MS = 24 * 60 * 60 * 1000;
const OVERDUE_LOOKBACK_DAYS = 30;
/** Work closed today can be scheduled well ahead (a skipped fall job). */
const DAY_DECK_HORIZON_DAYS = 200;

const curingDaysByRegistry = new WeakMap<PluginRegistry, number>();

/** The longest post-harvest curing window any crop plugin declares. */
function maxCuringDays(registry: PluginRegistry): number {
  const hit = curingDaysByRegistry.get(registry);
  if (hit !== undefined) return hit;
  let weeks = 0;
  for (const c of registry.crops()) {
    const max = c.postHarvestCuring?.durationWeeks.max ?? 0;
    if (max > weeks) weeks = max;
  }
  curingDaysByRegistry.set(registry, weeks * 7);
  return weeks * 7;
}

export const load: PageServerLoad = async ({ url, locals }) => {
  // An Owner who hasn't answered onboarding screen 2 goes back to it.
  // Impersonating superadmins are never bounced.
  const onboardingStatus = locals.user?.activeOwnerId ? getOnboardingStatus() : null;
  if (
    onboardingStatus === 'in-progress' &&
    locals.user?.role === 'owner' &&
    !locals.user.impersonating
  ) {
    throw redirect(303, '/onboarding');
  }
  const resolved = resolveTodayParams(url.searchParams);
  if (resolved.redirect !== null) throw redirect(308, `${url.pathname}${resolved.redirect}`);
  const view = resolved.view;
  // Phase 25d v2-addendum (#89 / #80 partial) — drives AI-on vs AI-off
  // variant on /today's recommendations card + provenance legend strip.
  const aiEnabled = getUserAiEnabled(locals.user?.id);
  const registry = await getRegistry();
  const now = Date.now();
  const blocks = listBlocks({ plantings: 'current', now });

  // Calendar-engine derived events — every active planting contributes
  // spray windows / harvest windows / orchard tasks etc. These are the
  // suggestions the operator can promote to a real Task.
  const allEvents: CalendarEvent[] = [];
  const totalPlantings = countPlantings();
  for (const b of blocks) {
    for (const planting of b.plantings) {
      const cropRecord = registry.get(planting.cropPluginId);
      if (!cropRecord || cropRecord.plugin.type !== 'crop') continue;
      allEvents.push(
        ...eventsForPlanting(planting, cropRecord.plugin as CropPlugin, {
          blockPlantings: b.plantings
        })
      );
    }
  }

  // FR-08 curing reminders. Every view below starts at today, so a harvest
  // matters only while its longest curing window can still be open.
  const harvests = listHarvestEvents({
    fromMs: now - (maxCuringDays(registry) + 2) * DAY_MS
  });
  for (const h of harvests) {
    const cropRecord = registry.get(h.cropPluginId);
    if (!cropRecord || cropRecord.plugin.type !== 'crop') continue;
    allEvents.push(...eventsForHarvest(h, cropRecord.plugin as CropPlugin));
  }

  const prefs = prefsFor(locals.user?.id);
  const today = todayYmd(prefs, now);
  const dayStart = Date.parse(today);

  let deckTasks: ReturnType<typeof listTasks> = [];
  let calendar: {
    view: 'week' | 'month';
    anchor: string;
    grid: ReturnType<typeof calendarGrid>;
    tasks: ReturnType<typeof listTasks>;
    suggestions: CalendarEvent[];
    scheduledKeys: string[];
  } | null = null;
  let season: ReturnType<typeof loadSeasonView> | null = null;

  if (view === 'day') {
    deckTasks = listTasks({
      fromMs: dayStart - OVERDUE_LOOKBACK_DAYS * DAY_MS,
      toMs: dayStart + DAY_DECK_HORIZON_DAYS * DAY_MS
    }).filter((t) => {
      const closedAt = t.completedAt ?? t.abortedAt;
      return closedAt === undefined || ymdInZone(closedAt, prefs.timeZone) === today;
    });
  } else if (view === 'week' || view === 'month') {
    const rawAt = url.searchParams.get('at');
    const anchor = isYmd(rawAt) ? rawAt : today;
    const grid = calendarGrid(view, anchor, firstDayOfWeek('en-US'));
    const fromMs = Date.parse(grid.fromYmd);
    const toMs = Date.parse(addDaysYmd(grid.toYmd, 1));
    const rangeTasks = listTasks({
      fromMs: fromMs - OVERDUE_LOOKBACK_DAYS * DAY_MS,
      toMs: toMs + DAY_MS
    });
    calendar = {
      view,
      anchor,
      grid,
      tasks: rangeTasks.filter((t) => t.scheduledFor >= fromMs - DAY_MS),
      suggestions: allEvents.filter(
        (e) => e.endMs >= Math.max(fromMs, dayStart) && e.startMs < toMs + DAY_MS
      ),
      scheduledKeys: []
    };
    calendar.scheduledKeys = [
      ...new Set([
        ...rangeTasks.flatMap((t) => (t.pluginTemplateKey ? [t.pluginTemplateKey] : [])),
        ...existingTemplateKeys(calendar.suggestions.map(suggestionTemplateKey))
      ])
    ];
    deckTasks = calendar.tasks;
  } else {
    season = loadSeasonView(registry, url.searchParams.get('season'), now);
  }

  const sprayers = listSprayers();
  const isOwner = locals.user?.role === 'owner' && !!locals.user.activeOwnerId;
  const gettingStarted = isOwner
    ? {
        facts: loadGettingStartedFacts({
          ownerId: locals.user!.activeOwnerId!,
          userId: locals.user!.id,
          blocks
        }),
        dismissed: getGettingStartedDismissedAt() !== null
      }
    : null;

  // Phase 25e (#97) — priorityAction + weather + seasonGlance.
  const blockNameById = new Map(blocks.map((b) => [b.id, b.name]));
  // Re-fetch the broader open-primary list (last 30d → +14d) so the
  // hero card never shows null just because the user is on the "season"
  // tab where the window starts later.
  const allOpenPrimaries = listTasks({
    fromMs: now - 30 * DAY_MS,
    toMs: now + 14 * DAY_MS,
    status: 'open',
    kind: 'primary'
  });
  const priorityAction = derivePriorityAction({
    openPrimaries: allOpenPrimaries,
    derivedEvents: allEvents,
    blockNameById,
    now
  });

  const weather = await loadTodayWeather();

  // YTD spray count = spray + insecticide + fungicide events since Jan 1.
  const yearStart = startOfYear(now);
  const spraysYTD =
    listSprayEvents({ fromMs: yearStart, toMs: now }).length +
    listInsecticideEvents({ fromMs: yearStart, toMs: now }).length +
    listFungicideEvents({ fromMs: yearStart, toMs: now }).length;
  const seasonGlance = deriveSeasonGlance({
    activePlantings: totalPlantings,
    spraysYTD,
    derivedEvents: allEvents,
    now
  });

  // Same predicate as the layout's decon banner (#470).
  const deconAlerts = sprayers
    .filter((s) =>
      needsDecon({
        lastChemistryClass: s.lastChemistryClass,
        lastUsedAt: s.lastSprayedAt,
        lastDeconAt: s.lastDeconAt
      })
    )
    .map((s) => ({ id: s.id, label: s.label, lastChemistryClass: s.lastChemistryClass ?? '' }));

  // UC-45 — next-spring reminder for sprayers used this season but not
  // winterized after the prior one. Informational (assists, never gates).
  const winterizeAlerts = deriveWinterizeAlerts(
    sprayers,
    now,
    equipmentIdsActiveBefore(startOfSeason(now))
  );

  const coveredLogs = isOwner ? coveredLogAlerts(await healthPlugins(), farmTimeZone(), now) : [];

  const plantingNames: Record<string, { name: string; blockId: string }> = {};
  for (const b of blocks)
    for (const p of b.plantings)
      plantingNames[p.id] = { name: p.varietyDisplayName, blockId: b.id };
  const olderPlantingIds = [
    ...new Set(deckTasks.flatMap((t) => (t.cropId && !plantingNames[t.cropId] ? [t.cropId] : [])))
  ];
  for (const p of listPlantingsForCardsByIds(olderPlantingIds))
    plantingNames[p.id] = { name: p.varietyDisplayName, blockId: p.blockId };

  const dayCandidates = view === 'day' ? eventsToday(allEvents, now) : [];
  const upcomingCandidates = upcomingEvents(allEvents, 14, now);
  const alreadyScheduled = existingTemplateKeys(
    [...dayCandidates, ...upcomingCandidates].map(suggestionTemplateKey)
  );
  const notScheduled = (e: CalendarEvent) => !alreadyScheduled.has(suggestionTemplateKey(e));
  const dayEvents = dayCandidates.filter(notScheduled);
  const upcoming = upcomingCandidates.filter(notScheduled);

  const hasLocation = hasFarmLatLon();
  return {
    today,
    nowMs: now,
    view,
    aiEnabled,
    counts: {
      blocks: blocks.length,
      plantings: totalPlantings
    },
    farmProfile: getFarmProfile(),
    gettingStarted,
    eventsToday: dayEvents,
    upcoming,
    deckTasks,
    calendar,
    season,
    blockNames: Object.fromEntries(blocks.map((b) => [b.id, b.name])),
    plantingNames,
    equipmentLabels: Object.fromEntries(listEquipment().map((e) => [e.id, e.label])),
    // #280 — lift `category` into the projection so the /today template
    // can resolve a /inventory/[type]/[id] link via the canonical
    // STOCK_CATEGORY_TO_INVENTORY_TYPE map (no 308-redirect RTT).
    lowStock: lowStockItems().map((i) => ({
      id: i.id,
      displayName: i.displayName,
      onHand: i.onHand,
      defaultUnit: i.defaultUnit,
      reorderThreshold: i.reorderThreshold ?? 0,
      category: i.category
    })),
    expiringStock: expiringSoon(30).map((e) => ({
      itemId: e.item.id,
      itemName: e.item.displayName,
      lotNumber: e.lot.lotNumber,
      balance: e.lot.balance,
      unit: e.item.defaultUnit,
      daysUntilExpiry: e.lot.daysUntilExpiry ?? 0,
      category: e.item.category
    })),
    // Phase 25e (#97) — Almanac hero / weather strip / season glance.
    priorityAction,
    weather,
    canSetFarmLocation: locals.user?.role === 'owner',
    seasonGlance,
    winterizeAlerts,
    deconAlerts,
    setupLatLon: hasLocation ? getFarmLatLon() : null,
    // #475 — ask the farm location and frost dates here too; the weather,
    // frost alerts and calendar all read them.
    setupPrompts: todaySetupPrompts(
      {
        // The Getting Started card already lists the location while it shows.
        hasLocation: hasLocation || (!!gettingStarted && !gettingStarted.dismissed),
        hasFrostDates:
          !!getSetting(SETTINGS_KEYS.lastFrost) && !!getSetting(SETTINGS_KEYS.firstFrost)
      },
      locals.user?.role ?? 'helper'
    ),
    coveredLogs
  };
};

function requireTodayOwner(event: Parameters<NonNullable<Actions[string]>>[0]) {
  const user = currentUser(event);
  if (!user) throw redirect(303, '/');
  if (!user.activeOwnerId || user.role !== 'owner') throw error(403, 'owner-only');
}

export const actions: Actions = {
  dismissSetup: (event) => {
    requireTodayOwner(event);
    dismissGettingStarted();
    return { ok: true };
  },
  showSetup: (event) => {
    requireTodayOwner(event);
    restoreGettingStarted();
    throw redirect(303, '/today');
  }
};
