export function filterRegisteredPlugins<T extends { pluginId: string; displayName: string }>(
  records: readonly T[],
  query: string
): T[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...records];
  return records.filter((r) => {
    const hay = `${r.displayName} ${r.pluginId}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}
