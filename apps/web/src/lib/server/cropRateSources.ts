/**
 * Ruling LF-2: the earlier-registration labels behind a herbicide's rates by
 * crop and stage limits, read from the `rateByCrop` and `stageLimitByCrop`
 * sources in apps/web/scripts/epa-reg-sources.json.
 */

import { rateByCrop, stageLimitByCrop } from '../../../scripts/epa-reg-sources.json';
import {
  earlierRegistrationLabels,
  type EarlierLabel,
  type LabelSourceRef
} from '$lib/plugins/earlierRegistration';

type SourceTable = Record<string, unknown>;

function refsFor(table: SourceTable, pluginId: string): LabelSourceRef[] {
  const list = table[pluginId];
  return Array.isArray(list) ? (list as LabelSourceRef[]) : [];
}

export function cropRateEarlierLabels(plugin: {
  pluginId: string;
  epaRegistrationNumber?: string;
}): EarlierLabel[] {
  return earlierRegistrationLabels(plugin.epaRegistrationNumber, [
    ...refsFor(rateByCrop as SourceTable, plugin.pluginId),
    ...refsFor(stageLimitByCrop as SourceTable, plugin.pluginId)
  ]);
}
