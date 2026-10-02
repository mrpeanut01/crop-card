import type { MessageKey } from './en';
import { esCore } from './es/core';
import { esToday } from './es/today';
import { esPlan } from './es/plan';
import { esFarm } from './es/farm';
import { esInventory } from './es/inventory';
import { esSettings } from './es/settings';
import { esAnimals } from './es/animals';
import { esRecords } from './es/records';
import { esPlugins } from './es/plugins';
import { esEntry } from './es/entry';

/**
 * Spanish (F5-8). Machine-drafted and proofread, but not yet signed off by a
 * native-speaker agricultural reviewer, so `reviewed` stays false. Safety,
 * hold, withdrawal, grazing, spray, email and push text stays English (see
 * `englishOnly.ts`).
 */
export const reviewed = false;

export const ES_PARTS: ReadonlyArray<Partial<Record<MessageKey, string>>> = [
  esCore,
  esToday,
  esPlan,
  esFarm,
  esInventory,
  esSettings,
  esAnimals,
  esRecords,
  esPlugins,
  esEntry
];

export const es: Partial<Record<MessageKey, string>> = Object.assign({}, ...ES_PARTS);
