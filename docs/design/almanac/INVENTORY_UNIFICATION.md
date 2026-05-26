# Handoff — Inventory Unification (CropCard)

## Overview

CropCard's inventory-bearing screens (Stock, Plugins, Sprayers, the add-stock flow) had drifted into three different shells with three different field models. This package replaces them with **one canonical pattern** parameterized by inventory type:

```
List → Detail → Edit/Add  →  List
```

The pattern is shared; the **field set** the form captures is the only thing that varies per type.

| Type        | Stock or Catalog?      | Safety kernel? | Key data captured |
|-------------|------------------------|----------------|-------------------|
| `pesticide` | both (lots + catalog)  | **yes**        | AI · MoA group · REI/PHI · EPA reg # · signal word · rate range |
| `fertility` | both                   | no             | NPK + secondaries · form · density · OMRI · application rate    |
| `seed`      | both                   | conditional¹   | Variety · germ % + test date · treated? · provenance · DTM      |
| `crop`      | **catalog only**       | rules-version-linked | Archetype renderer · varieties · V/R stages · pests · dependencies |
| `sprayer`   | asset (no lots)        | calibration-linked   | Tank · nozzle · GPA · last cal · RUP-clear status        |

¹ Seed routes through the safety kernel only when `treated = true` — treated-seed handling inherits REI from the coating's pesticide plugin.

The deliverable: developer should implement these screens in CropCard's actual codebase (SvelteKit + TypeScript + SQLite), wiring to the existing inventory + plugin repositories.

## About the design files

The files in `source/` are **design references created in HTML/React** — prototypes showing intended layout, hierarchy, copy, colors, and interactions. They are **not production code to copy directly**.

The task is to **recreate these designs in the CropCard codebase** (SvelteKit + TypeScript + SQLite + Litestream, per `mrpeanut01/crop-card`) using its existing patterns:

- Existing Almanac chrome (TopBar, Card, Pill, Kicker, buttons) — map the React component names in the prototypes to the Svelte equivalents already in `src/lib/components/`.
- Existing Zod schemas for inventory + plugins — extend, don't replace.
- Existing tenant-isolation patterns (`tenantWhere`, `withTenant`, `tenantValues`).
- Existing safety-kernel module — pesticide and treated-seed flows must continue to route through it.

## Fidelity

**High-fidelity.** The prototypes are pixel-precise: exact colors, typography, spacing, copy, KPI counts, and interaction states. Recreate them as closely as the SvelteKit component library allows. Where this package's chrome conflicts with the existing Almanac component API, **prefer the existing API** and treat the prototype as the visual target.

## What's in this package

```
design_handoff_inventory_unification/
├── README.md                 ← you are here
├── preview.html              ← open in a browser to see all 15 artboards
└── source/
    ├── direction-almanac-inventory.jsx   ★ the new unified pattern (the deliverable)
    ├── direction-almanac-pages.jsx       ← contains existing Stock screen (being replaced)
    ├── direction-almanac-settings.jsx    ← contains existing Plugins + Sprayers screens (being replaced)
    ├── direction-almanac-stock-add.jsx   ← existing 5-method add flow (kept; now type-aware)
    ├── direction-almanac-today.jsx       ← provides A_tokens, A_TopBar, A_Card, A_Pill, A_Kicker, button styles
    ├── icons.jsx                         ← icon set used everywhere
    ├── design-canvas.jsx                 ← canvas host (preview only)
    └── data.js                           ← MOCK data (replace with real repo queries)
```

★ The starred file is the only one you need to *implement*. The rest is context.

To preview:
1. Open `preview.html` in a browser (no server needed — uses CDN React + Babel).
2. Click any artboard to open it focused; ←/→/Esc to navigate.
3. Drag the canvas to pan, ⌘/Ctrl-scroll to zoom.

## Screens to build

15 artboards total, grouped into 4 sections.

### 00 · Taxonomy + data matrix (1440 × 920)

Component: `A_InventoryTaxonomy`

A meta-diagram, **not a user-facing screen** in production — keep this as a developer-facing doc page (or a Storybook story) so future contributors understand the contract. Shows:

- The 5 inventory types as colored cards (id, label, icon, tone, description).
- A field-coverage matrix: 24 fields × 5 types, with `■ required / · optional / blank n/a` cells.
- An entry-method matrix: which of the 5 add-flow methods (barcode, label OCR, AI photo, search, manual) applies per type.
- The lifecycle state diagram (list → detail → edit → list).

### 01 · List screens × 5 (1280 × 820 each)

Component: `A_InventoryList({ type })` where `type ∈ {pesticide, fertility, seed, crop, sprayer}`.

**Shared chrome** (every type):
- `A_TopBar` (active = `stock` for inventory types, `settings` for crop/sprayer).
- Header: kicker (`Inventory · {Type}`), serif H1, sub-line, action buttons (`Export CSV` / `Add item` or `Upload plugin`).
- **Type swap chip row** — 5 chips, the active type uses `A.forest` filled, others use `A.paper` outlined. Counts shown right of label in mono. This is the streamlining move: one inventory surface, type chips switch the data shape.
- **Stock ↔ Catalog toggle** (only for pesticide / fertility / seed — types that have both lot instances and a plugin catalog). Segmented control: `Lots on hand | Catalog (plugin)`.
- **4-card KPI strip** — counts/health metrics specific to the type. Icon left in `#E5EEDF` square. Big number in serif (24px, weight 600). Kicker label below.
- **Search row + sub-filter chips** — search input with mono "N of M" count. Sub-filters differ per type (see component config).
- **Data table** — sticky header in `A.cream`. Row hover. Status-coded row background tint (short = `#FBF1E5`, expiring = `#FBF5E6`, decon = `#F1D9CE`, draft = `#F4ECD8`).

**Per-type column sets:**

| Type        | Columns |
|-------------|---------|
| `pesticide` | Item + AI · MoA · Signal · On hand · Lots · Expires |
| `fertility` | Item · NPK · Form · OMRI · On hand · Reorder at |
| `seed`      | Variety · Origin · Germ % · year · Treated · On hand · Source |
| `crop`      | Plugin id · Archetype · Varieties · Source · Status · Version |
| `sprayer`   | Sprayer · Nozzle · Tank · Last cal · GPA · Status |

**Per-row inline badges** (in name cell, after the title):
- `RUP` (red outlined) — restricted-use pesticide.
- `TREATED` (wheat outlined) — treated seed.
- `↻ retest` (wheat text) — germ retest due.
- Sub-type pill (Herbicide / Insecticide / Fungicide) under the AI line for pesticide rows.

**Per-row action (rightmost cell):**
- `short` or `decon` status → primary button (`Reorder` or `Decon`).
- `updateTo` set → ghost button (`Update`).
- Otherwise → chevron-right indicator (row is clickable to detail).

### 02 · Detail screens × 4 (1280 × 900 each)

Component: `A_InventoryDetail({ type })` — uses sub-components `PesticideDetail`, `FertilityDetail`, `SeedDetail`, `CropPluginDetail`.

**Shared chrome:**
- `A_TopBar` + **detail subheader** (kicker, serif title, sub-line, back button, action buttons).
- **2-column layout**, 1.4fr left / 1fr right, 14px gap.
- Sections built with `InvSection` (white card, serif title 15px, optional sub-line, optional right-aligned action button).
- Key-value pairs use `InvKVP` (uppercase kicker label + value, mono when `mono` prop set, color when `tone` prop set).

**Section list per type:**

| Type        | Left column sections                                     | Right column sections                           |
|-------------|----------------------------------------------------------|------------------------------------------------|
| `pesticide` | Plugin link · Safety kernel · Rate range table           | On hand (lots) · Storage & reorder · Recent usage |
| `fertility` | Guaranteed analysis (NPK chart) · Application · Nutrient-plan impact | On hand · Storage & reorder · Application history |
| `seed`      | Variety provenance · Germination & treatment · Planting parameters | On hand (0-lot empty state) · Saving history · Linked planting |
| `crop`      | Plugin metadata · Varieties · Growth stages (V/R) · Pest watchlist | Where it's used · Dependencies · Plugin source (JSON preview) |

**Critical detail — kernel-locked content:**
- Pesticide "Safety kernel" section contains a green-tinted info row that calls out tank-mix gates. Background `#EFF6E9`, border `#C9DBC0`, lock icon, text in `A.forestDeep`.
- All plugin-derived values (EPA reg #, MoA, REI, PHI, AI %) are displayed as read-only `InvKVP`s on the detail page. They become editable only via the **plugin proposal flow** (separate page; out of scope here).
- Crop plugin detail right rail shows a JSON preview of the plugin definition — mono font, `A.cream` background, scroll on overflow.

### 03 · Edit / Add form × 4 (1280 × 900 each)

Component: `A_InventoryEditForm({ type, mode })` where `mode ∈ {edit, add}`.

**Shared structure:**
- `A_TopBar` + subheader (kicker = `Stock · Edit item` or `Stock · Add item`, serif title = item name or `New inventory item`).
- 2-column body: main form (1fr) + sticky right rail (320px).
- **Sticky save footer**: cancel · save & add another · primary save. Lock icon left + "Save creates lot record + signs the hash chain. Edits to kernel-locked fields require curator sign-off."

**Main form sections (in order):**

1. **Inventory type** — 5-chip type selector. Switching the chip swaps the field stacks below.
2. **Identity** — common to every type: name/brand, SKU/plugin id, manufacturer, unit of measure (or class for sprayer / archetype for crop), location/tag.
3. **Type-specific stack** — one of:
   - Pesticide: 8-field stack of plugin-derived fields (EPA, signal, MoA, RUP, REI, PHI, AI, concentration). All show `FROM PLUGIN` + `KERNEL-LOCKED` chips, rendered with `A.cream` background to indicate read-only.
   - Fertility: 6-field NPK + secondaries row, then form/density/OMRI/rate row.
   - Seed: variety + type + DTM row, then germ % + test date + treated + organic row.
   - Crop: version/source/rules-version/stages row, then varieties JSON textarea.
   - Sprayer: tank/nozzle/count/boom-width row, then last-cal/GPA/last-product/RUP row.
4. **Lot details** — only for pesticide/fertility/seed: lot # + expires/tested-by + qty + reorder, then received-from + date + price + PO #.

**Right rail (sticky, 320px):**

- **Save summary** — `SaveRow` items: Type · Plugin match · Safety kernel · Required fields · "Will it appear in…" (lists which downstream screens consume this item).
- **Audit trail** — explanation + last-edit timestamp in mono.
- **Help** — 3-bullet legend of `REQUIRED`, `FROM PLUGIN`, `KERNEL-LOCKED` chips.

**Field-level chip taxonomy** (rendered by `InvField`):
| Chip              | Color                            | Meaning |
|-------------------|----------------------------------|---------|
| `REQUIRED`        | `A.rust` text, no bg             | Zod-required field |
| `FROM PLUGIN`     | `A.forest` text + sparkle icon   | Auto-filled from plugin registry |
| `KERNEL-LOCKED`   | `A.inkMuted` text + lock icon    | Read-only here; edit via curator/proposal flow |
| `hint` (right)    | `A.inkMuted` mono                | Units / format hint |

## Design tokens

Pull all values from `source/direction-almanac-today.jsx` — the `A` object near the top of the file. Key tokens (do not reinvent):

| Token          | Value      | Use |
|----------------|------------|-----|
| `A.forest`     | `#2C5237`  | Primary brand. Active states, "ok" status, success. |
| `A.forestDeep` | `#1F3D27`  | Serif headings, primary text-on-light. |
| `A.cream`      | `#F4ECD8`  | Card backgrounds, read-only field bg. |
| `A.paper`      | `#FFFCF5`  | Surface (cards, inputs). |
| `A.ink`        | `#1F1F1A`  | Body text. |
| `A.inkSoft`    | `#4A4D44`  | Secondary text. |
| `A.inkMuted`   | `#7A7F75`  | Tertiary text, kickers. |
| `A.divider`    | `#D8D2BC`  | Borders. |
| `A.dividerSoft`| `#E8E2CB`  | Inner card dividers. |
| `A.rust`       | `#B04A2B`  | Errors, restricted, short stock. |
| `A.wheat`      | `#B47B2E`  | Warnings, expiring, stale. |
| `A.sky`        | `#3A6E8C`  | Information, fungicide pill. |

### Typography
- `Source Serif 4` — display only (serif titles, kicker numbers).
- `IBM Plex Sans` — body / UI.
- `IBM Plex Mono` — data, lot #s, EPA, version numbers, dates, kicker-with-mono-value pattern.

### Spacing
8px base unit. Card padding: 14–18px. Section gap inside cards: 12–14px. Table row padding: 11px vertical, 8–14px horizontal.

### Border radius
Cards: 10px. Inputs / buttons: 6px. Pills: 99px. Inner card surfaces: 7-8px.

## Data model

Match the field-coverage matrix in section 00. Suggested Zod shape (extend the existing CropCard schemas, don't replace):

```ts
// Common to every inventory type
const InventoryItemBase = z.object({
  id: z.string().uuid(),
  type: z.enum(["pesticide", "fertility", "seed", "crop", "sprayer"]),
  name: z.string().min(1),
  manufacturer: z.string().optional(),
  pluginId: z.string().optional(),         // null until matched to catalog
  pluginVersion: z.string().optional(),
  tenantId: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Lot-bearing types add this — pesticide/fertility/seed
const InventoryLot = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
  lotNumber: z.string().min(1),
  quantity: z.number().nonnegative(),
  unit: z.enum(["fl oz", "gal", "lb", "oz", "g", "yd³", "plants"]),
  expires: z.date().optional(),
  reorderAt: z.number().nonnegative().optional(),
  location: z.string().optional(),
  receivedFrom: z.string().optional(),
  receivedAt: z.date().optional(),
  pricePerUnit: z.number().optional(),
  receiptRef: z.string().optional(),
  tenantId: z.string().uuid(),
});

// Type-specific extensions (one of these joins InventoryItemBase by type):

const PesticideAttrs = z.object({
  epaRegNo: z.string(),                    // KERNEL-LOCKED (from plugin)
  signalWord: z.enum(["Caution", "Warning", "Danger"]),
  moaGroup: z.string(),                    // "FRAC 3 + 9", "IRAC 1A" etc
  activeIngredients: z.array(z.object({ name: z.string(), pct: z.number() })),
  restrictedUse: z.boolean(),
  reiHours: z.number(),
  phiByCrop: z.record(z.number()),         // { apple: 72, grape: 336 }
  rateRangeByCrop: z.array(/* see prototype */),
  tankMixIncompatible: z.array(z.string()),
});

const FertilityAttrs = z.object({
  npk: z.tuple([z.number(), z.number(), z.number()]), // [N, P2O5, K2O] as %
  secondaries: z.object({ s: z.number().optional(), ca: z.number().optional(), mg: z.number().optional() }).optional(),
  form: z.enum(["Granular", "Liquid", "Pellet", "Bulk / compost"]),
  density: z.string().optional(),          // "49 lb/ft³" or "9.2 lb/gal"
  omri: z.boolean(),
  recommendedRate: z.string().optional(),
});

const SeedAttrs = z.object({
  variety: z.string(),
  latinName: z.string().optional(),
  type: z.enum(["Heirloom · OP", "OP", "Hybrid F1", "Companion · F1"]),
  daysToMaturity: z.tuple([z.number(), z.number()]).optional(),
  germPct: z.number().min(0).max(100),
  germTestDate: z.date(),
  germTestBy: z.string(),                  // "self" or lab name
  treated: z.object({ on: z.boolean(), kind: z.enum(["fungicide","insecticide","both"]).optional(), pluginId: z.string().optional() }),
  omri: z.boolean(),
});

const CropPluginAttrs = z.object({
  archetype: z.enum([
    "small-grain.zadoks", "row-grain.pollination", "dry-seed-legume",
    "winter-squash-cure", "continuous-harvest-fruit", "cut-and-come-again-leafy",
    "cover-crop.termination", "forage-cutting-cycle", "perennial-vine-quality", "tree-fruit-multi-pick"
  ]),
  renderer: z.string(),
  rulesVersion: z.string(),
  varieties: z.array(/* per-archetype shape */),
  stages: z.array(z.string()),
  pests: z.array(/* ... */),
  diseases: z.array(/* ... */),
  source: z.enum(["core", "marketplace", "draft"]),
});

const SprayerAttrs = z.object({
  tankGal: z.number(),
  nozzleType: z.string(),
  nozzleCount: z.number().int(),
  boomWidthFt: z.number().optional(),
  lastCalibratedAt: z.date(),
  measuredGpa: z.number(),
  lastProductCycled: z.string().optional(),
  rupCleared: z.boolean(),
});
```

## Interactions & behaviour

### List screen
- **Type chip click** → swaps URL param `?type=pesticide` and re-renders. State preserved per type (active sub-filter, search).
- **Stock/Catalog toggle** → switches data source from the lots table to the plugins table. Columns and KPIs swap.
- **Sub-filter chips** → multi-select filter on the visible rows.
- **Row click** → navigate to detail (`/inventory/{type}/{id}`).
- **Status action button** (`Reorder` / `Decon` / `Update`) → opens the type-specific action sheet without leaving the list.

### Detail screen
- **Edit button** in header → navigate to the form in `edit` mode pre-filled.
- **Receive lot button** → opens the add-stock 5-method picker pre-scoped to this item.
- **Tank-mix gates info row** → click to open the full incompatibility table (modal).
- **Lot card click** → expand to show full lot history (audit trail).

### Edit/Add form
- **Type chip** at top → swap the type-specific sections below. Any data the user entered for the prior type stays in component state (so accidental clicks don't lose work).
- **Kernel-locked fields** → not editable. Clicking shows a tooltip: "Edit via Settings → Plugins → Propose change."
- **Save** → validate against Zod → write row + create hash-chain audit entry. Errors surface inline beneath each invalid field.
- **Save & add another** → save, then reset the form keeping the type + identity-section values prefilled.

## State management

For each list view, persist:
- `?type=` query param (the active inventory type).
- `?mode=stock|catalog` query param (when applicable).
- Sub-filter selection in component state (does not need to be URL-persisted).
- Search query in URL `?q=` for shareable filtered URLs.

For the edit form, hold the in-progress edit in component state until save; warn on navigation away with unsaved changes (this is an existing CropCard pattern — match it).

## Existing components to reuse

The prototype uses React, but every component below has a Svelte twin in the CropCard codebase. Map them:

| Prototype component / style    | CropCard equivalent (best guess — verify) |
|--------------------------------|--------------------------------------------|
| `A_TopBar`                     | `src/lib/components/TopBar.svelte` |
| `A_Card`                       | `src/lib/components/Card.svelte` |
| `A_Pill`                       | `src/lib/components/Pill.svelte` |
| `A_Kicker`                     | `src/lib/components/Kicker.svelte` |
| `A_primaryBtn` / `A_ghostBtn`  | Button component with `variant` prop |
| `Icon.*`                       | Existing icon set |

If your codebase doesn't yet have these primitives, build them — they're tiny and reused everywhere.

## Files in this package (recap)

- **Implement these screens** as faithful Svelte versions of:
  - `A_InventoryTaxonomy` (developer-doc page)
  - `A_InventoryList` × 5 types
  - `A_InventoryDetail` × 4 types
  - `A_InventoryEditForm` × 5 types
- **Replace** the existing screens defined in:
  - `source/direction-almanac-pages.jsx` → the old `AStockScreen` function
  - `source/direction-almanac-settings.jsx` → the old `ASettingsPluginsScreen` + `ASettingsSprayersScreen` functions
- **Keep** the 5-method add flow (`source/direction-almanac-stock-add.jsx`), but route its "save" handler through the new type-aware form so the canonical save path is the same regardless of entry method.

## Assets

No external image assets. All visuals are SVG icons defined in `source/icons.jsx` and CSS-only ornaments (placeholder stripes, faux barcode rectangles, color cards).

## Questions for the implementer

1. Should crop plugins live under `/inventory/crop` or stay under `/settings/plugins`? The prototype places them under inventory for taxonomic consistency; the URL choice is yours.
2. Should sprayers be inventory or assets? The prototype treats them as inventory because they share the lifecycle pattern; the codebase may prefer to keep them under Settings → Sprayers. Either way, the canonical *form* should still apply.
3. The plugin proposal flow (curator-reviewed edits to kernel-locked fields) is referenced but not designed here — confirm whether it should be a follow-up handoff.
