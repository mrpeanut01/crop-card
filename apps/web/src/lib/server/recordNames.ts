import type { RecordNames } from '$lib/db/recordsUnified';
import type { PluginRegistry } from '$lib/plugins/registry';
import { getRegistry } from './registry';

/** English plugin names for /records rows. */
export function recordNamesFrom(registry: Pick<PluginRegistry, 'get'>): RecordNames {
  return {
    product: (id) => {
      const p = registry.get(id)?.plugin;
      return p && p.type !== 'crop' ? p.displayName : undefined;
    },
    crop: (id) => {
      const p = registry.get(id)?.plugin;
      return p?.type === 'crop' ? p.displayName : undefined;
    }
  };
}

export async function loadRecordNames(): Promise<RecordNames> {
  return recordNamesFrom(await getRegistry());
}
