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
import { dropPlantedSuggestions, suggestionTemplateKey } from '$lib/today/calendar';
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
import { applySeasonSprayFilter } from '$lib/season/sprayWindowFilter.server';
import { listSprayers } from '$lib/server/sprayers';
import { getUserAiEnabled } from '$lib/server/aiTry';
import { loadTodayWeather } from '$lib/server/todayWeather';
import { derivePriorityAction } from '$lib/today/priorityAction';
import { deriveSeasonGlance, startOfYear } from '$lib/today/seasonGlance';
import { deriveWinterizeAlerts, startOfSeason } from '$lib/today/winterizeAlert';
import { equipmentLastActiveBefore, listEquipment } from '$lib/db/equipment';
import { prefsFor, farmTimeZone } from '$lib/db/userProfile';
import { hasOtherAssignableMember } from '$lib/db/users';
import { intlLocale, todayYmd, ymdInZone } from '$lib/prefs';
import { addDaysYmd, calendarGrid, isYmd, resolveTodayParams } from '$lib/today/views';
import { firstDayOfWeek } from '$lib/intlCache';
import { loadSeasonView } from '$lib/today/seasonView.server';
import { needsDecon } from '$lib/equipment/decon';
import { todaySetupPrompts } from '$lib/onboarding/pageSetup';
import { getFarmLatLon, hasFarmLatLon } from '$lib/schedule/settings';
import { getSetting } from '$lib/db/settings';
import { SETTINGS_KEYS } from '$lib/schedule/constants';
import { coveredLogAlerts, healthPlugins } from '$lib/server/animalRecords';
import { withOlderOverdue } from '$lib/today/olderOverdue';
import { materializeCareTasks } from '$lib/server/carePlans';
import { loadTodayAdvice } from '$lib/server/todayAdvice.server';
import type { TodayAdviceCard } from '$lib/today/advice';
import { careCards, careCloseFormData } from '$lib/server/careView';
import { todayDigestInput } from '$lib/digest/todayInput';
import {
  activeReEntryItems,
  longestLibraryReiHours,
  reEntryReadStart
} from '$lib/today/reEntryCard';

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
          blockPlantings: b.plantings,
          now
        })
      );
    }
  }

  const seasonEvents = applySeasonSprayFilter(allEvents, () => registry.herbicides(), now);
  allEvents.length = 0;
  allEvents.push(...seasonEvents);

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

  // Phase 32D (D0-2): /today and the push tick write care tasks. They show
  // in their own Animal care section, whose Done carries the health form,
  // so the generic deck and hero leave them out.
  const careTimeZone = farmTimeZone();
  const care = materializeCareTasks(now, careTimeZone);
  const animalCare = careCards(care.open, care.plans, care.subjects, ymdInZone(now, careTimeZone), {
    surfacedOnly: true,
    locale: locals?.locale
  });
  const careForm = await careCloseFormData(animalCare);
  const notCare = (t: { category?: string }) => t.category !== 'animal-care';

  // Every open task due by the end of the hero's horizon, however late
  // (#742): the hero and the Day deck read older overdue work from here.
  const openTasks = listTasks({ toMs: now + 14 * DAY_MS, status: 'open' }).filter(notCare);

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
    const deckFrom = dayStart - OVERDUE_LOOKBACK_DAYS * DAY_MS;
    deckTasks = withOlderOverdue(
      listTasks({
        fromMs: deckFrom,
        toMs: dayStart + DAY_DECK_HORIZON_DAYS * DAY_MS
      }).filter((t) => {
        if (!notCare(t)) return false;
        const closedAt = t.completedAt ?? t.abortedAt;
        return closedAt === undefined || ymdInZone(closedAt, prefs.timeZone) === today;
      }),
      openTasks,
      deckFrom
    );
  } else if (view === 'week' || view === 'month') {
    const rawAt = url.searchParams.get('at');
    const anchor = isYmd(rawAt) ? rawAt : today;
    const grid = calendarGrid(view, anchor, firstDayOfWeek(intlLocale(locals.locale)));
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
      tasks: rangeTasks.filter((t) => t.scheduledFor >= fromMs - DAY_MS && notCare(t)),
      suggestions: dropPlantedSuggestions(
        allEvents.filter((e) => e.endMs >= Math.max(fromMs, dayStart) && e.startMs < toMs + DAY_MS),
        rangeTasks
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
    season = loadSeasonView(registry, url.searchParams.get('season'), now, locals.locale);
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
  // Open primaries of any age (#742), so the hero never reads "nothing's
  // overdue" while a task is past due, whatever view is open.
  const allOpenPrimaries = openTasks.filter((t) => t.kind === 'primary');
  const priorityAction = derivePriorityAction({
    openPrimaries: allOpenPrimaries,
    derivedEvents: allEvents,
    blockNameById,
    now,
    locale: locals?.locale,
    timeZone: prefs.timeZone
  });

  const weather = await loadTodayWeather();

  // One read of spray + insecticide + fungicide events feeds both the YTD
  // count (since Jan 1) and the re-entry card (ruling LF-3), so it starts
  // early enough to reach the longest REI in the library.
  const farmZone = careTimeZone;
  const yearStart = startOfYear(now, farmZone);
  const readFrom = reEntryReadStart(yearStart, now, longestLibraryReiHours(registry));
  const sprayRows = listSprayEvents({ fromMs: readFrom, toMs: now });
  const insecticideRows = listInsecticideEvents({ fromMs: readFrom, toMs: now });
  const fungicideRows = listFungicideEvents({ fromMs: readFrom, toMs: now });
  const sinceYearStart = (ev: { occurredAt: number }) => ev.occurredAt >= yearStart;
  const spraysYTD =
    sprayRows.filter(sinceYearStart).length +
    insecticideRows.filter(sinceYearStart).length +
    fungicideRows.filter(sinceYearStart).length;
  const reEntry = activeReEntryItems({
    registry,
    sprays: sprayRows,
    insecticides: insecticideRows,
    fungicides: fungicideRows,
    blockNameById,
    now
  });
  const seasonGlance = deriveSeasonGlance({
    activePlantings: totalPlantings,
    spraysYTD,
    derivedEvents: allEvents,
    harvestTasks: allOpenPrimaries.filter((t) => t.category === 'harvest'),
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
    equipmentLastActiveBefore(startOfSeason(now, farmZone)),
    farmZone
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
  const upcomingCandidates = dropPlantedSuggestions(upcomingEvents(allEvents, 14, now), [
    ...deckTasks,
    ...allOpenPrimaries
  ]);
  const alreadyScheduled = existingTemplateKeys(
    [...dayCandidates, ...upcomingCandidates].map(suggestionTemplateKey)
  );
  const notScheduled = (e: CalendarEvent) => !alreadyScheduled.has(suggestionTemplateKey(e));
  const dayEvents = dayCandidates.filter(notScheduled);
  const upcoming = upcomingCandidates.filter(notScheduled);

  const hasLocation = hasFarmLatLon();
  const lowStock = lowStockItems();
  // Phase 32E (E4-15): watering and degree-day cards, Day view only.
  let advice: TodayAdviceCard[] = [];
  if (view === 'day') {
    advice = await loadTodayAdvice({
      nowMs: now,
      seasonYear: Number(today.slice(0, 4)),
      farmLatLon: hasLocation ? getFarmLatLon() : null,
      timeZone: careTimeZone,
      locale: locals?.locale,
      isOwner,
      // Phase 32F (F4-8): the Monday card, from rows already read here.
      digest: todayDigestInput({
        openPrimaries: allOpenPrimaries,
        careOpen: care.open,
        lowStockCount: lowStock.length,
        blockNameById,
        viewerId: locals.user?.id ?? '',
        isOwner,
        viewerTimeZone: prefs.timeZone
      }),
      plantings: blocks.flatMap((b) =>
        b.plantings.map((p) => {
          const rec = registry.get(p.cropPluginId);
          const family =
            rec && rec.plugin.type === 'crop'
              ? ((rec.plugin as CropPlugin).cropFamily ?? null)
              : null;
          return {
            id: p.id,
            blockId: b.id,
            fieldId: b.fieldId ?? null,
            cropPluginId: p.cropPluginId,
            cropFamily: family,
            status: p.status ?? 'active',
            plantingDate: p.plantingDate
          };
        })
      )
    });
  }
  const ownerIdForTeam = locals.user?.activeOwnerId;
  const hasTeam =
    !!ownerIdForTeam &&
    !!locals.user?.id &&
    hasOtherAssignableMember(ownerIdForTeam, locals.user.id);
  return {
    advice,
    today,
    nowMs: now,
    hasTeam,
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
    lowStock: lowStock.map((i) => ({
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
    reEntry,
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
      locals.user?.role ?? 'helper',
      locals.locale
    ),
    coveredLogs,
    animalCare,
    animalCareForm: careForm,
    careTodayYmd: ymdInZone(now, careTimeZone),
    isOwner
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
