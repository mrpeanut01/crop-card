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
import { listBlocks } from '$lib/db/blocks';
import { listCrops } from '$lib/db/crops';
import { listHarvestEvents } from '$lib/db/harvestEvents';
import { listSprayEvents } from '$lib/db/sprayEvents';
import { listInsecticideEvents } from '$lib/db/insecticideEvents';
import { listFungicideEvents } from '$lib/db/fungicideEvents';
import { expiringSoon, lowStockItems } from '$lib/db/stock';
import { listTasks } from '$lib/db/tasks';
import {
  eventsForHarvest,
  eventsForPlanting,
  eventsInRange,
  eventsToday,
  upcomingEvents,
  type CalendarEvent
} from '$lib/calendar/engine';
import type { CropPlugin } from '$lib/plugins/schemas';
import { getRegistry, getRegistryStats } from '$lib/server/registry';
import { listSprayers } from '$lib/server/sprayers';
import { RULES_VERSION } from '$lib/safety/version';
import { getUserAiEnabled } from '$lib/server/aiTry';
import { loadTodayWeather } from '$lib/server/todayWeather';
import { derivePriorityAction } from '$lib/today/priorityAction';
import { deriveSeasonGlance, startOfYear } from '$lib/today/seasonGlance';
import { deriveWinterizeAlerts, startOfSeason } from '$lib/today/winterizeAlert';
import { equipmentIdsActiveBefore, listEquipment } from '$lib/db/equipment';
import { prefsFor } from '$lib/db/userProfile';
import { todayYmd, ymdInZone } from '$lib/prefs';
import { SEASON_DAYS, clampView, clampWindow } from '$lib/today/deck';

const DAY_MS = 24 * 60 * 60 * 1000;
const OVERDUE_LOOKBACK_DAYS = 30;

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
  const deckWindow = clampWindow(url.searchParams.get('tab'));
  const view = clampView(url.searchParams.get('view'));
  // Phase 25d v2-addendum (#89 / #80 partial) — drives AI-on vs AI-off
  // variant on /today's recommendations card + provenance legend strip.
  const aiEnabled = getUserAiEnabled(locals.user?.id);
  const registry = await getRegistry();
  const stats = getRegistryStats();
  const blocks = listBlocks();

  // Calendar-engine derived events — every active planting contributes
  // spray windows / harvest windows / orchard tasks etc. These are the
  // suggestions the operator can promote to a real Task.
  const allEvents: CalendarEvent[] = [];
  let totalPlantings = 0;
  for (const b of blocks) {
    totalPlantings += b.plantings.length;
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

  // FR-08 curing reminders.
  const harvests = listHarvestEvents();
  for (const h of harvests) {
    const cropRecord = registry.get(h.cropPluginId);
    if (!cropRecord || cropRecord.plugin.type !== 'crop') continue;
    allEvents.push(...eventsForHarvest(h, cropRecord.plugin as CropPlugin));
  }

  const now = Date.now();
  const prefs = prefsFor(locals.user?.id);
  const today = todayYmd(prefs, now);
  const dayStart = Date.parse(today);
  const seasonEnd = dayStart + SEASON_DAYS * DAY_MS;

  const deckTasks = listTasks({
    fromMs: dayStart - OVERDUE_LOOKBACK_DAYS * DAY_MS,
    toMs: seasonEnd
  }).filter((t) => {
    const closedAt = t.completedAt ?? t.abortedAt;
    return closedAt === undefined || ymdInZone(closedAt, prefs.timeZone) === today;
  });

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

  // Active crops summary — fuels the Season tab and the equipment-readiness
  // panel.
  const activeCrops = listCrops({ status: 'active', limit: 100 });

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

  // UC-45 — next-spring reminder for sprayers used this season but not
  // winterized after the prior one. Informational (assists, never gates).
  const winterizeAlerts = deriveWinterizeAlerts(
    sprayers,
    now,
    equipmentIdsActiveBefore(startOfSeason(now))
  );

  const plantingNames: Record<string, { name: string; blockId: string }> = {};
  for (const b of blocks)
    for (const p of b.plantings)
      plantingNames[p.id] = { name: p.varietyDisplayName, blockId: b.id };

  return {
    today,
    nowMs: now,
    deckWindow,
    view,
    aiEnabled,
    rulesVersion: RULES_VERSION,
    counts: {
      crops: registry.crops().length,
      herbicides: registry.herbicides().length,
      pluginFailures: stats.failures.length,
      blocks: blocks.length,
      activeCrops: activeCrops.length,
      plantings: totalPlantings
    },
    sprayers,
    farmProfile: getFarmProfile(),
    gettingStarted,
    pluginFailures: stats.failures,
    eventsToday: eventsToday(allEvents, now),
    upcoming: upcomingEvents(allEvents, 14, now),
    seasonEvents: eventsInRange(allEvents, now, now + SEASON_DAYS * DAY_MS),
    deckTasks,
    blockNames: Object.fromEntries(blocks.map((b) => [b.id, b.name])),
    plantingNames,
    equipmentLabels: Object.fromEntries(listEquipment().map((e) => [e.id, e.label])),
    activeCrops,
    seasonCrops: blocks.flatMap((b) =>
      b.plantings.map((p) => ({
        id: p.id,
        varietyDisplayName: p.varietyDisplayName,
        blockId: b.id
      }))
    ),
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
    winterizeAlerts
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
