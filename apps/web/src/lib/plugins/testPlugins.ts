/** Click-through and QA fixtures shipped in `plugins/` that no real farm
 *  should see in its product or crop lists. */
export function isTestPluginId(pluginId: string): boolean {
  return /^(ct-test-|test-)/.test(pluginId) || /-ct-\d{3}$/.test(pluginId);
}
