import type { InventoryType } from '$lib/inventory/types';
import type { MessageKey, Translator } from '$lib/i18n';

const TYPE_LABEL_KEYS = {
  pesticide: 'inv.type.pesticide',
  fertility: 'inv.type.fertility',
  seed: 'inv.type.seed',
  crop: 'inv.type.crop',
  feed: 'inv.type.feed',
  'animal-health': 'inv.type.animalHealth'
} as const satisfies Record<InventoryType, MessageKey>;

const TYPE_WORD_KEYS = {
  pesticide: 'inv.typeWord.pesticide',
  fertility: 'inv.typeWord.fertility',
  seed: 'inv.typeWord.seed',
  crop: 'inv.typeWord.crop',
  feed: 'inv.typeWord.feed',
  'animal-health': 'inv.typeWord.animalHealth'
} as const satisfies Record<InventoryType, MessageKey>;

/** The chip label for a type ("Pesticides", "Feed & bedding"). */
export function invTypeLabel(tr: Translator, type: InventoryType): string {
  return tr(TYPE_LABEL_KEYS[type]);
}

/** The chip label, lower-cased for running text. */
export function invTypeLower(tr: Translator, type: string): string {
  const key = TYPE_LABEL_KEYS[type as InventoryType];
  return key ? tr(key).toLowerCase() : type;
}

/** The singular type word as the route names it ("pesticide", "animal-health"). */
export function invTypeWord(tr: Translator, type: string): string {
  const key = TYPE_WORD_KEYS[type as InventoryType];
  return key ? tr(key) : type;
}

const QTY_STATUS_KEYS = {
  existing: 'inv.qty.existing',
  ordered: 'inv.qty.ordered',
  planned: 'inv.qty.planned'
} as const satisfies Record<string, MessageKey>;

/** "On hand" / "Ordered" / "Planned" for a lot's quantity status. */
export function qtyStatusLabel(tr: Translator, status: keyof typeof QTY_STATUS_KEYS): string {
  return tr(QTY_STATUS_KEYS[status]);
}
