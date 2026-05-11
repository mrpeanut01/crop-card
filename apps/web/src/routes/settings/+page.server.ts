import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listBlocks } from '$lib/db/blocks';
import { listCrops } from '$lib/db/crops';
import { listEquipment } from '$lib/db/equipment';
import { listStockItems } from '$lib/db/stock';
import { getSetting } from '$lib/db/settings';
import { listTaxonomyTerms } from '$lib/db/taxonomy';
import {
  DEFAULT_AI_DAILY_QUOTA,
  DEFAULT_AI_MONTHLY_USD_CAP,
  DEFAULT_SHOW_SHADE_MARKERS,
  LOUDOUN_DEFAULT_FIRST_FROST_MMDD,
  LOUDOUN_DEFAULT_LAST_FROST_MMDD,
  LOUDOUN_DEFAULT_LAT_LON,
  SETTINGS_KEYS,
  parseBoolSetting
} from '$lib/schedule/constants';
import {
  getAiDailyCallQuota,
  getAiMonthlyUsdCap,
  getFarmLatLon
} from '$lib/schedule/settings';
import { spendSnapshot } from '$lib/server/aiGuard';

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.user) throw error(401, 'sign-in required');

  const blocks = listBlocks();
  const isOwner = locals.user.role === 'owner';
  const stockItemsAll = listStockItems();
  const shortNamesTotal = stockItemsAll.length;
  const shortNamesMissing = stockItemsAll.filter((s) => !s.shortName).length;

  return {
    isOwner,
    counts: {
      blocks: blocks.length,
      crops: listCrops({ limit: 1000 }).length,
      equipment: listEquipment().length,
      stockItems: stockItemsAll.length
    },
    shortNamesTotal,
    shortNamesMissing,
    taxonomy: listTaxonomyTerms(),
    // Anthropic API key — secret; only expose "is set" booleans.
    anthropicKeySet: !!(process.env.ANTHROPIC_API_KEY || getSetting('anthropic_api_key')),
    anthropicKeyFromEnv: !!process.env.ANTHROPIC_API_KEY,
    // AI guardrails — owner-only widgets read live values.
    ai: isOwner
      ? {
          monthlyUsdCap: getAiMonthlyUsdCap(),
          monthlyUsdCapDefault: DEFAULT_AI_MONTHLY_USD_CAP,
          dailyQuota: getAiDailyCallQuota(),
          dailyQuotaDefault: DEFAULT_AI_DAILY_QUOTA,
          spend: spendSnapshot()
        }
      : null,
    // Display preferences — view-only toggles, anyone can change.
    display: {
      showShadeMarkers: parseBoolSetting(
        getSetting(SETTINGS_KEYS.showShadeMarkers),
        DEFAULT_SHOW_SHADE_MARKERS
      )
    },
    // Location & climate — surfaced for the weather + frost-date pipelines.
    location: isOwner
      ? {
          farmLatLon: getFarmLatLon(),
          farmLatLonDefault: LOUDOUN_DEFAULT_LAT_LON,
          lastFrostMmDd:
            getSetting(SETTINGS_KEYS.lastFrost) ?? LOUDOUN_DEFAULT_LAST_FROST_MMDD,
          lastFrostDefault: LOUDOUN_DEFAULT_LAST_FROST_MMDD,
          firstFrostMmDd:
            getSetting(SETTINGS_KEYS.firstFrost) ?? LOUDOUN_DEFAULT_FIRST_FROST_MMDD,
          firstFrostDefault: LOUDOUN_DEFAULT_FIRST_FROST_MMDD
        }
      : null
  };
};
