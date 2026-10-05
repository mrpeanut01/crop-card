import { loadPluginsFromDirectory } from './loader';
import { PluginRegistry } from './registry';
import type { CropLookup } from './registryDataKinds';

/** The crop lookup orchard calendars resolve their host crops against. */
export function cropLookupOf(library: PluginRegistry): CropLookup {
  return {
    cropFamilyOf: (id) => {
      const plugin = library.get(id)?.plugin;
      return plugin?.type === 'crop' && typeof plugin.cropFamily === 'string'
        ? plugin.cropFamily
        : undefined;
    }
  };
}

/** Loads the plugin library from a folder and returns its crop lookup. */
export async function loadCropLookup(pluginsDir: string): Promise<CropLookup> {
  const library = new PluginRegistry();
  await loadPluginsFromDirectory(library, pluginsDir);
  return cropLookupOf(library);
}
