import type { CardKind } from '$lib/cards/model';

export const CARD_KIND_LABEL_KEYS = {
  planting: 'cardsui.kind.planting',
  area: 'cardsui.kind.area',
  farmMap: 'cardsui.kind.farmMap',
  spray: 'cardsui.kind.spray',
  equipment: 'cardsui.kind.equipment',
  careGuide: 'cardsui.kind.careGuide',
  day: 'cardsui.kind.day',
  stock: 'cardsui.kind.stock',
  task: 'cardsui.kind.task',
  scout: 'cardsui.kind.scout',
  harvest: 'cardsui.kind.harvest',
  soilTest: 'cardsui.kind.soilTest',
  animal: 'cardsui.kind.animal',
  flock: 'cardsui.kind.flock',
  irrigation: 'cardsui.kind.irrigation',
  week: 'cardsui.kind.week',
  month: 'cardsui.kind.month',
  profit: 'cardsui.kind.profit',
  digest: 'cardsui.kind.digest'
} as const satisfies Record<CardKind, string>;
