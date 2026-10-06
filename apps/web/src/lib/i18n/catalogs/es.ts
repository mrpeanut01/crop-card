import type { MessageKey } from './en';
import { esCore } from './es/core';
import { esCards } from './es/cards';
import { esSprayui } from './es/sprayui';
import { esGarden } from './es/garden';
import { esWizard } from './es/wizard';
import { esToday } from './es/today';
import { esPlan } from './es/plan';
import { esFarm } from './es/farm';
import { esInventory } from './es/inventory';
import { esSettings } from './es/settings';
import { esAnimals } from './es/animals';
import { esRecords } from './es/records';
import { esPlugins } from './es/plugins';
import { esEntry } from './es/entry';
import { esNotify } from './es/notify';
import { esAmend } from './es/amend';
import { esApierrB } from './es/apierrB';
import { esApierrA } from './es/apierrA';
import { esSeasonal } from './es/seasonal';

/**
 * Spanish (F5-8). Machine-drafted, then corrected and signed off by the
 * owner's native-speaker proofreader (#511, 2026-10-03). Safety,
 * hold, withdrawal, grazing and spray text in the app stays English (see
 * `englishOnly.ts`); push, email, SMS and the Monday summary follow the
 * recipient's language.
 */
export const reviewed = true;

export const ES_PARTS: ReadonlyArray<Partial<Record<MessageKey, string>>> = [
  esCore,
  esCards,
  esSprayui,
  esGarden,
  esWizard,
  esToday,
  esPlan,
  esFarm,
  esInventory,
  esSettings,
  esAnimals,
  esRecords,
  esPlugins,
  esEntry,
  esNotify,
  esAmend,
  esApierrB,
  esApierrA,
  esSeasonal
];

export const es: Partial<Record<MessageKey, string>> = Object.assign({}, ...ES_PARTS);
