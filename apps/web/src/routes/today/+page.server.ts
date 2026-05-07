import type { PageServerLoad } from './$types';
import { listBlocks } from '$lib/db/blocks';
import { expiringSoon, lowStockItems } from '$lib/db/stock';
import {
  eventsForPlanting,
  eventsToday,
  upcomingEvents,
  type CalendarEvent
} from '$lib/calendar/engine';
import type { CropPlugin } from '$lib/plugins/schemas';
import { getRegistry, getRegistryStats } from '$lib/server/registry';
import { listSprayers } from '$lib/server/sprayers';
import { RULES_VERSION } from '$lib/safety/version';

export const load: PageServerLoad = async () => {
  const registry = await getRegistry();
  const stats = getRegistryStats();
  const blocks = listBlocks();

  const allEvents: CalendarEvent[] = [];
  for (const b of blocks) {
    for (const planting of b.plantings) {
      const cropRecord = registry.get(planting.cropPluginId);
      if (!cropRecord || cropRecord.plugin.type !== 'crop') continue;
      allEvents.push(...eventsForPlanting(planting, cropRecord.plugin as CropPlugin));
    }
  }

  return {
    today: new Date().toISOString().slice(0, 10),
    rulesVersion: RULES_VERSION,
    counts: {
      crops: registry.crops().length,
      herbicides: registry.herbicides().length,
      pluginFailures: stats.failures.length,
      blocks: blocks.length
    },
    sprayers: listSprayers(),
    pluginFailures: stats.failures,
    eventsToday: eventsToday(allEvents),
    upcoming: upcomingEvents(allEvents, 14),
    lowStock: lowStockItems().map((i) => ({
      id: i.id,
      displayName: i.displayName,
      onHand: i.onHand,
      defaultUnit: i.defaultUnit,
      reorderThreshold: i.reorderThreshold ?? 0
    })),
    expiringStock: expiringSoon(30).map((e) => ({
      itemId: e.item.id,
      itemName: e.item.displayName,
      lotNumber: e.lot.lotNumber,
      balance: e.lot.balance,
      unit: e.item.defaultUnit,
      daysUntilExpiry: e.lot.daysUntilExpiry ?? 0
    }))
  };
};
