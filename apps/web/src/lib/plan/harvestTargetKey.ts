/**
 * Stable key for a harvest target — Phase 21b follow-up.
 *
 * Plugin-author-tagged `useCase` is the canonical identifier (it
 * matches the HARVEST_USE_CASES enum so cross-plugin grouping works).
 * When the author hasn't set one — e.g. the Oxacana Green Dent Corn
 * plugin's "Sweet" / "Dent" labels — fall back to a slug of the label
 * so the operator-facing filter still has something stable to match
 * against.
 *
 * The same function is used both when building the picker's list of
 * checkbox options AND when filtering the projected harvest targets
 * in the swim-lane render, so the two stay in lockstep.
 *
 * Lives in `$lib/plan/` (not directly inside `+page.server.ts`)
 * because SvelteKit restricts named exports from page modules to a
 * fixed allow-list (`load`, `actions`, `prerender`, etc.).
 */
export function harvestTargetKey(useCase: string | undefined, label: string): string {
  if (useCase) return useCase;
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
