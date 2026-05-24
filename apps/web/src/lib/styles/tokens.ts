/**
 * TypeScript mirror of tokens.css for Svelte logic that needs raw values
 * (dynamic chart fills, inline SVG strokes, computed style props).
 *
 * Source of truth: design_handoff_cropcard_overhaul/direction-almanac-today.jsx (const A)
 * Keep in sync with tokens.css — if you change a value here, change it there.
 */

export const tokens = {
  // Surfaces
  cream: "#F8F3E8",
  paper: "#FDFAF2",

  // Text
  ink: "#1A1F1A",
  inkSoft: "#4A4F46",
  inkMuted: "#7A7F75",

  // Brand
  forest: "#2C5237",
  forestDeep: "#1F3A28",

  // Semantic
  wheat: "#B8893C",
  wheatSoft: "#E8D9B5",
  rust: "#A64A2A",
  sky: "#6F8FA8",

  // Lines
  divider: "#D9CFB7",
  dividerSoft: "#E9DFCC",
} as const;

export const pillTones = {
  neutral: { bg: "#E9DFCC", fg: "#4A4F46", bd: "#D9CFB7" },
  forest: { bg: "#E5EEDF", fg: "#1F3A28", bd: "#C9DBC0" },
  wheat: { bg: "#E8D9B5", fg: "#8A6722", bd: "#D9C18F" },
  rust: { bg: "#F1D9CE", fg: "#8A341B", bd: "#E2B69E" },
  sky: { bg: "#DEE7EF", fg: "#3A586E", bd: "#BDCDD9" },
} as const;

export type PillTone = keyof typeof pillTones;

/**
 * `kindColor` maps an event-kind string to a token color, matching the
 * Almanac design's `kindColorA()` helper. Used for calendar/timeline
 * stripes, scout/spray/harvest visual differentiation.
 */
export function kindColor(kind: string): string {
  switch (kind) {
    case "scout":
      return tokens.sky;
    case "spray":
      return tokens.rust;
    case "fertility":
      return tokens.wheat;
    case "planting":
      return tokens.forest;
    case "harvest":
      return "#8A6722";
    case "task":
      return tokens.inkMuted;
    default:
      return tokens.divider;
  }
}
