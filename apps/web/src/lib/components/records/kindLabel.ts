import type { Translator } from '$lib/i18n';
import type { RecordKind } from '$lib/db/recordKinds';

export function kindLabel(tr: Translator, kind: RecordKind): string {
  switch (kind) {
    case 'spray':
      return tr('records.kind.spray');
    case 'insecticide':
      return tr('records.kind.insecticide');
    case 'fungicide':
      return tr('records.kind.fungicide');
    case 'scout':
      return tr('records.kind.scout');
    case 'harvest':
      return tr('records.kind.harvest');
    case 'hay':
      return tr('records.kind.hay');
    case 'fertility':
      return tr('records.kind.fertility');
    case 'planting':
      return tr('records.kind.planting');
    case 'decon':
      return tr('records.kind.decon');
  }
}
