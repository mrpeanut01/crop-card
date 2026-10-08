export interface NamedPlugin {
  pluginId?: string;
  displayName?: string;
  activeIngredients?: ReadonlyArray<unknown>;
}

function ingredientText(p: NamedPlugin): string {
  const names: string[] = [];
  for (const ai of p.activeIngredients ?? []) {
    const name = (ai as { name?: unknown } | null)?.name;
    if (typeof name === 'string' && name.trim()) names.push(name.trim());
  }
  return names.join(', ');
}

/** A short line that tells apart library entries sharing one display name
 *  (#658: two "2,4-D Amine" entries): the active ingredients when they
 *  differ within the group, otherwise the library id. Null for an entry
 *  whose name is not shared. */
export function sameNameDetails(items: ReadonlyArray<NamedPlugin>): Array<string | null> {
  const groups = new Map<string, number[]>();
  items.forEach((p, i) => {
    const key = (p.displayName ?? '').trim().toLowerCase();
    if (!key) return;
    const list = groups.get(key) ?? [];
    list.push(i);
    groups.set(key, list);
  });
  const out: Array<string | null> = items.map(() => null);
  for (const idx of groups.values()) {
    if (idx.length < 2) continue;
    const texts = idx.map((i) => ingredientText(items[i]));
    const distinct = texts.every((t) => t) && new Set(texts).size === texts.length;
    idx.forEach((i, k) => {
      out[i] = distinct ? texts[k] : (items[i].pluginId ?? null);
    });
  }
  return out;
}
