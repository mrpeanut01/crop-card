import { enCore } from './en/core';
import { enToday } from './en/today';
import { enPlan } from './en/plan';
import { enFarm } from './en/farm';
import { enInventory } from './en/inventory';
import { enSettings } from './en/settings';
import { enAnimals } from './en/animals';
import { enRecords } from './en/records';
import { enPlugins } from './en/plugins';
import { enEntry } from './en/entry';

/**
 * The English catalog is the source of every message key (F5-2). Keys are
 * flat and dotted; a plural message is two keys, `<base>.one` and
 * `<base>.other`, and callers pass the base with a `count`. Each area owns
 * one file under `en/` and its Spanish twin under `es/`.
 */
export const EN_PARTS = [
  enCore,
  enToday,
  enPlan,
  enFarm,
  enInventory,
  enSettings,
  enAnimals,
  enRecords,
  enPlugins,
  enEntry
] as const;

export const en = {
  ...enCore,
  ...enToday,
  ...enPlan,
  ...enFarm,
  ...enInventory,
  ...enSettings,
  ...enAnimals,
  ...enRecords,
  ...enPlugins,
  ...enEntry
} as const;

export type MessageKey = keyof typeof en;
