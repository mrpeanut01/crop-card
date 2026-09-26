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
import { listTasks, type Task } from '$lib/db/tasks';
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
import { equipmentIdsActiveBefore } from '$lib/db/equipment';
import { prefsFor } from '$lib/db/userProfile';
import { todayYmd } from '$lib/prefs';

const DAY_MS = 24 * 60 * 60 * 1000;
type Tab = 'today' | '7d' | '30d' | 'season';
type View = 'list' | 'calendar';

function clampTab(raw: string | null): Tab {
  switch (raw) {
    case '7d':
    case '30d':
    case 'season':
      return raw;
    default:
      return 'today';
  }
}

function clampView(raw: string | null): View {
  return raw === 'calendar' ? 'calendar' : 'list';
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
  const tab = clampTab(url.searchParams.get('tab'));
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

  // Tab-driven derived-event window.
  const now = Date.now();
  const today = todayYmd(prefsFor(locals.user?.id), now);
  const dayStart = new Date(Date.parse(today));
  const tabWindowDays = tab === '7d' ? 7 : tab === '30d' ? 30 : tab === 'season' ? 200 : 1;
  const tabFromMs = tab === 'today' ? dayStart.getTime() : now;
  const tabToMs = tabFromMs + tabWindowDays * DAY_MS;
  const derivedInWindow =
    tab === 'today' ? eventsToday(allEvents, now) : eventsInRange(allEvents, tabFromMs, tabToMs);

  // Real Tasks in the current window. Tasks are forward-looking; we also
  // surface overdue (open tasks scheduled before now) so they don't get
  // lost off the calendar.
  const tasksOpen = listTasks({
    fromMs: tabFromMs - 30 * DAY_MS, // pick up overdue from the last month
    toMs: tabToMs,
    status: 'open'
  });

  const tasksCompletedToday = listTasks({
    fromMs: dayStart.getTime(),
    toMs: dayStart.getTime() + DAY_MS - 1,
    status: 'completed'
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

  // Group tasks by primary so the UI renders pre-tasks under their parent.
  const tasksByPrimary = new Map<string, Task[]>();
  for (const t of tasksOpen) {
    if (t.kind === 'pre-task' || t.kind === 'post-task') {
      if (!t.linkedToTaskId) continue;
      const list = tasksByPrimary.get(t.linkedToTaskId) ?? [];
      list.push(t);
      tasksByPrimary.set(t.linkedToTaskId, list);
    }
  }
  const primariesInWindow = tasksOpen.filter((t) => t.kind === 'primary');
  const orphanedPrePost = tasksOpen.filter(
    (t) =>
      t.kind !== 'primary' &&
      (!t.linkedToTaskId || !primariesInWindow.find((p) => p.id === t.linkedToTaskId))
  );

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

  return {
    today,
    tab,
    view,
    tabFromMs,
    tabToMs,
    aiEnabled,
    rulesVersion: RULES_VERSION,
    counts: {
      crops: registry.crops().length,
      herbicides: registry.herbicides().length,
      pluginFailures: stats.failures.length,
      blocks: blocks.length,
      activeCrops: activeCrops.length
    },
    sprayers,
    farmProfile: getFarmProfile(),
    gettingStarted,
    pluginFailures: stats.failures,
    // Legacy: keep these so the existing template still has data while we
    // migrate to the tabbed layout.
    eventsToday: eventsToday(allEvents),
    upcoming: upcomingEvents(allEvents, 14),
    // New tab-driven payload
    derivedEvents: derivedInWindow,
    primariesInWindow,
    tasksByPrimary: Object.fromEntries(tasksByPrimary),
    orphanedPrePost,
    tasksCompletedToday,
    activeCrops,
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
