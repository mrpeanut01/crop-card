# CropCard — AI provenance addendum (export for Claude Code)

This folder contains every file that changed in the latest design
iteration plus the spec document explaining the AI-assisted
data-pre-population layer.

## What to do

1. Read **`AI_PROVENANCE_ADDENDUM.md`** first. The top of that file is
   the prompt — it tells you the principle, the contract, and the
   server-side implications.
2. Diff each `direction-almanac-*.jsx` against your current
   svelte-port to see exactly which sections need the new
   `<Provenance>` markup, and update accordingly.
3. Port `direction-almanac-ai-provenance.jsx` to a Svelte component
   pair: `Provenance.svelte` + `ProvenanceLegend.svelte`. Tokens map
   1:1 to your existing Almanac palette.
4. Add the `provenance` SQL enum + `aiTry()` helper. Both are
   detailed in the addendum.

## File map

| File                                       | What it is                                                  | What changed                                                                 |
|--------------------------------------------|-------------------------------------------------------------|------------------------------------------------------------------------------|
| `AI_PROVENANCE_ADDENDUM.md`                | The spec document.                                          | **NEW** — read this first.                                                  |
| `direction-almanac-ai-provenance.jsx`      | Shared provenance components + reference artboard.          | **NEW** — port to `Provenance.svelte` + `ProvenanceLegend.svelte`.          |
| `icons.jsx`                                | Icon library.                                               | Added `Sparkle` + `Refresh` (Sparkle was missing despite being referenced). |
| `direction-almanac-today.jsx`              | Today dashboard.                                            | Action card + Recommendations now show provenance; new `aiEnabled` prop.    |
| `direction-almanac-insecticide.jsx`        | Insecticide spray flow.                                     | Legend strip + provenance on tank-mix products + IPM gate; `aiEnabled` prop.|
| `direction-almanac-onboarding.jsx`         | First-run onboarding.                                       | AI offer card rewritten; optionality + fallback list made explicit.         |
| `data.js`                                  | Shared mock data.                                           | Expanded `aiSettings.gatedFeatures` + `keepWorking` lists.                  |
| `CropCard Modernization.html`              | Canvas host.                                                | New cover invariant; 3 new artboards; new script tag.                       |

## Canonical visual reference

The most important single artboard in the canvas is
**`00 · ai-philosophy`** (1440×920) — it's the reference page that
codifies the four-source ladder, the badge styling, and the
degradation matrix. Open the canvas HTML, focus that artboard
(click its label or the expand icon), and use it as your visual
contract while you plumb.

The **`02 · today-aioff`** and **`03 · spray-insect-aioff`** variants
let you see the AI-off treatment in context. These two screens are
the implementation-pattern templates — every other AI-touchable
surface should follow the same on/off contrast.
