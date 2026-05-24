# Handoff: CropCard design overhaul (Direction A — Almanac)

## Overview
This handoff packages the canonical design spec for **CropCard** — an offline-first PWA replacing the paper Field Card for small-plot row-crop herbicide planning, planting, spraying, harvest, and records. The repo lives at **mrpeanut01/crop-card**. This bundle is the design layer that ships against the existing SvelteKit + TypeScript + SQLite + Litestream foundation already in `main`.

The design committed to a single direction (**Almanac** — editorial, premium agricultural) and covers **47 artboards across 9 sections**: cover, entry, today, spray (3 variants), harvest + stock + 5-method add flow, records + 11-section settings, plan + 2 sub-states, 5-step season-planning wizard, and 10 archetype renderers w/ a coverage matrix.

## About the design files
The files in this bundle are **design references created in HTML/JSX prototypes** — they exist to lock visual + interaction intent, not to be lifted into production. The implementation task is to **recreate these screens inside the existing SvelteKit codebase** (`src/routes/**` + `src/lib/components/**`) using established patterns:

- Server actions for mutations (no client-side fetch to write data)
- Zod-validated forms with progressive enhancement
- TanStack Query *only if* a screen genuinely needs client-side cache; otherwise SSR loader → form action
- Dexie for offline queueing of spray / harvest events (already wired in repo)
- The plugin engine is data-only — never recreate plugin behavior in component code; render from validated JSON

## Fidelity
**High-fidelity.** Pixel-perfect mockups with final colors, typography, spacing, and copy. Tokens, type scale, and component anatomy are all production-ready — recreate them as Svelte components with the same hierarchy. Recreate using existing app primitives where they exist; create new ones where they don't.

## How this maps to existing repo invariants
Pulled from `CLAUDE.md` at `mrpeanut01/crop-card@main`. Every screen below respects these — if your implementation violates one, the screen is wrong:

| Invariant | How the design honors it |
|---|---|
| **Safety kernel — compiled, plugin-immutable** | All spray screens render kernel verdicts as read-only badges. Tank-mix blocks route to decon, never dilution. Hard-locks (pollinator gate, glyph-philosophy block, RUP for helpers) render as locked rows with `Icon.Lock`. |
| **Plugins are data-only · Zod-validated at registration** | Crop archetype screens (section 08) all read from plugin JSON discriminators (`growthStageTable.system`, `cropFamily`, `agronomy.lifecycle`, `postHarvestCuring`, `harvestStyle`). No crop-specific code paths. |
| **Tenant isolation (row-level via owner_id)** | Settings → Helpers section + Records page assume `tenantWhere` / `withTenant` / `tenantValues` already in place. UI never shows other tenants' data. |
| **Single replica · maxReplicas:1 · revisionMode:single** | Settings → Plan & billing explicitly calls this out under "Solo plan." No multi-writer UI affordances. |
| **48h spray lock (FR-09) · server-enforced** | Records screen + Settings → Records show the lock window as a setting (default 48h), but the design assumes the server is authoritative — UI just reflects state. |
| **One-glove ops · ≥48dp tap targets** | All buttons in spray + harvest paths are ≥44px. Sticky footers on flow screens (stock-add, wizard) keep primary action thumb-reachable. |

## Files in this bundle

| File | Purpose |
|---|---|
| `CropCard Modernization.html` | Root canvas. Imports React + Babel + all design scripts, wraps them in `DesignCanvas`. **Open this in a browser to see all 47 artboards.** |
| `design-canvas.jsx` | Pan/zoom/focus canvas shell — `DesignCanvas` + `DCSection` + `DCArtboard`. Not part of the product; presentation-only. |
| `data.js` | Mock data (`MOCK` global). Every screen reads from this — when implementing, replace each access with the equivalent repo query. |
| `icons.jsx` | Inline SVG icons. Replace with `lucide-svelte` or equivalent in the repo. |
| `direction-almanac-today.jsx` | **Token + shell definitions.** Owns `A` (tokens), `almanacBase` (CSS), `A_TopBar`, `A_Card`, `A_Pill`, `A_Kicker`, `A_primaryBtn`, `A_ghostBtn`, `A_iconBtn`. Also renders the Today / dashboard screen. Read this first. |
| `direction-almanac-rest.jsx` | Spray (herbicide) screen + supporting helpers. |
| `direction-almanac-insecticide.jsx` | Spray (insecticide) — IPM threshold + pollinator gate. |
| `direction-almanac-fungicide.jsx` | Spray (fungicide) — disease forecast + FRAC rotation + rain/dew gate. |
| `direction-almanac-onboarding.jsx` | First-run onboarding (Sherry day 1). |
| `direction-almanac-pages.jsx` | Harvest, Stock (list), Records, Login, Settings index. |
| `direction-almanac-plan-v2.jsx` | Plan — multi-planting block detail with workflow strip. Accepts `initialBlockId`, `initialPlantingIdx`, `mapOpen` props. |
| `direction-almanac-wizard.jsx` + `direction-almanac-wizard-rest.jsx` | 5-step season planning wizard. |
| `direction-almanac-crops.jsx` | Wheat, grape, hay, tree-fruit archetype renderers. |
| `direction-almanac-rowcrops.jsx` | Corn, bean, pumpkin, tomato, lettuce, cover-crop renderers. Hosts `ROW_CROPS` mock data. |
| `direction-almanac-archetype-matrix.jsx` | **Read this artboard first.** Coverage matrix mapping the 137 crop plugins → 19 archetype renderers (10 built, 9 composable). |
| `direction-almanac-stock-add.jsx` | 5-method add-to-stock flow (barcode · label OCR · AI photo · textual search · manual). |
| `direction-almanac-settings.jsx` | All 10 Settings sub-pages. |
| `data.js` (again — listed twice on purpose) | Worth a second pass before you start coding. The shape of every screen's props is here. |

---

## Design tokens

### Colors

| Token | Hex | Use |
|---|---|---|
| `cream` | `#F8F3E8` | Page background |
| `paper` | `#FDFAF2` | Cards, surfaces, top bar |
| `ink` | `#1A1F1A` | Primary text |
| `inkSoft` | `#4A4F46` | Body copy |
| `inkMuted` | `#7A7F75` | Captions, metadata, kicker labels |
| `forest` | `#2C5237` | Primary brand, primary buttons, success |
| `forestDeep` | `#1F3A28` | Display headings, brand-deep |
| `wheat` | `#B8893C` | Warning, "in progress" states |
| `wheatSoft` | `#E8D9B5` | Warning pill backgrounds |
| `rust` | `#A64A2A` | Errors, blocks, RUP, danger zone |
| `sky` | `#6F8FA8` | Informational, fungicide accent |
| `divider` | `#D9CFB7` | Hard dividers, input borders |
| `dividerSoft` | `#E9DFCC` | Soft dividers, hover backgrounds |
| `cardBorder` | `#D9CFB7` | Same as `divider` — alias for card stroke |

### Pill tones (for `A_Pill`)

| Tone | bg | fg | bd |
|---|---|---|---|
| `neutral` | `#E9DFCC` | `#4A4F46` | `#D9CFB7` |
| `forest` | `#E5EEDF` | `#1F3A28` | `#C9DBC0` |
| `wheat` | `#E8D9B5` | `#8A6722` | `#D9C18F` |
| `rust` | `#F1D9CE` | `#8A341B` | `#E2B69E` |
| `sky` | `#DEE7EF` | `#3A586E` | `#BDCDD9` |

### Typography

- **Display / headings:** Source Serif 4 (`.serif`), weight 500, `letter-spacing: -0.01em` to `-0.02em`
- **UI body:** IBM Plex Sans (default)
- **Data, tokens, EPA #s, dates:** IBM Plex Mono (`.mono`)
- Sizes used: 11–13 for metadata / kickers; 13.5–14 for body; 16–17 for card titles; 19–22 for screen titles; 26–36 for hero / cover

### Spacing + radius

- Card border radius: **8px** (10px for outer hero, 6px for inputs)
- Card padding: **12–18px**
- Section gap (grids of cards): **10–14px**
- Page padding: **22–28px**
- Buttons: **42px height** for primary (Add to stock, Record, Save changes); **30–36px** for ghost; ≥44px tap target

### Iconography

The `Icon` object in `icons.jsx` is a thin React wrapper around stroke SVGs (Lucide-style). Replace with `lucide-svelte` 1:1 — names match where possible (`Leaf`, `Sun`, `Droplet`, `Calendar`, `Lock`, `Alert`, `Check`, `CheckCircle`, `Plus`, `Search`, `ChevronRight`, `User`, `Cloud`, `FileText`, `Map`, `Tool`, `Camera`, `Barcode`, `Keyboard`, `Tag`, `Flashlight`, `Image`, `Edit`, `Sparkle`, `Eye`, `Thermometer`, `Layers`, `Sprout`, `Wrench`, `ArrowRight`, `CloudRain`, `Info`).

---

## Sections (the 47 artboards)

### 00 · Cover
Engineering handoff context surfaced at the top of the canvas. Repo metadata, phase status, the six invariants, and a TOC of the section list. **Not a product screen** — drop this from the implementation.

### 01 · Entry
- **Login** — magic-link sign-in with invite-token detection and a demo-tenant entry. Routes through `/auth/magic` → `/owner-picker | /onboarding | /today`.
- **Onboarding** — Sherry's day-1 self-serve onboarding (Phase 18f). Walks farm setup → first block → first crop plugin → today.

### 02 · Today
Dashboard. The morning glance: what to do today, what's blocked by weather, the three open spray windows, harvest-ready blocks, low-stock alerts.

### 03 · Spray (3 screens)
Same chrome, three decision payloads:
- **Herbicide** — multi-block, multi-tank with safety-kernel verdict per tank
- **Insecticide** — IPM threshold + pollinator gate (kernel-locked during ♀-flower windows)
- **Fungicide** — disease forecast (NEWA/FHB/PM) + FRAC rotation enforcement + rain/dew gate

The kernel verdict is **always rendered as read-only output** of a server call — never compute it client-side.

### 04 · Harvest, Stock & add flow (7 screens)
- **Harvest** — ready-now picks, upcoming windows, recent harvest log
- **Stock** — inventory list, low-stock + expiring-soon banners, lot-tracked rows
- **5-method add flow** — barcode (with aiming + detected sub-states), label OCR, AI photo (Claude vision), textual search (3-tier waterfall: library → marketplace → Claude web), manual entry. All five paths normalize into the same lot+exp+qty payload before write.

### 05 · Records & Settings (12 screens)
- **Records** — VDACS audit trail, 2-yr retention, inspector-link generator
- **Settings index** — 11-card grid
- **Account & sign-in** — profile, magic-link security, active sessions
- **Farm & blocks** — map editor + block list (7 blocks shown)
- **Helpers & invites** — 3 roles, active helpers, pending invite tokens (SHA-256 hashed in DB, plain-text on send only)
- **Sprayers & calibration** — UC-10 1/128-acre wizard + 3 sprayers w/ decon + stale states
- **Plugins & crop library** — 308 plugins by type, draft queue, marketplace updates
- **Records & retention** — retention policy, FR-09 lock window, hash chain integrity
- **AI assistant** — Claude key, monthly cap progress, per-endpoint quotas, gated-vs-always-works
- **Integrations** — 4 active (NOAA, UMD, USDA, VDACS), 3 planned (Quickbooks, CSA, FSA)
- **Plan & billing** — Solo plan, usage counters, payment, upgrade paths
- **Advanced & export-all** — diagnostics, 6 bulk-export options, danger zone (transfer · reset · delete-all)

### 06 · Plan (3 screens)
Multi-planting block detail with workflow strip + provenance. Three sub-states of the same screen — implement as one route with state, not three:
- Canonical (Three Sisters polyculture)
- Map overlay open
- Focused on a single planting (bean)

### 07 · Season planning wizard (6 screens)
- Step 0 — Season setup (philosophy + tillage + guardrails)
- Step 1 — Allocation (AI proposals + unallocated bin)
- Step 2 — Schedule (AI proposals + Gantt) **AND** Step 2 — AI-off variant (manual chat panel)
- Step 3 — Inputs plan (applications + shopping list)
- Step 4 — Commit / review

Chat panel persists across steps. AI on/off must be a real toggle, not branching code paths — the deterministic fallback already exists per `CLAUDE.md`.

### 08 · Crop archetypes (11 screens)
**Open `archetype-matrix` first.** This is the architectural read-out: every screen is a *renderer* keyed off plugin JSON, not a per-crop view. 137 crop plugins → 19 archetype renderers (10 built, 9 composable from primitives).

Built renderers in this canvas:
1. **Small-grain (Zadoks)** — wheat, barley, oats
2. **Row-grain w/ pollination (V/R)** — corn (Bloody Butcher, Painted Mtn, sweet)
3. **Dry-seed legume** — Cherokee bean, cowpea, dry-bean
4. **Winter squash + cure** — Seminole, butternut, acorn, buttercup
5. **Continuous-harvest fruit** — tomato, pepper, eggplant, cucumber
6. **Cut-and-come-again leafy** — lettuce, spinach, arugula, chard
7. **Cover crop · termination** — rye+vetch, clover, buckwheat
8. **Forage cutting cycle** — alfalfa, orchardgrass, hay mix
9. **Perennial vine + quality decision** — grape, hops
10. **Tree fruit · multi-pick** — apple, pear

The matrix lists the discriminator (e.g. `growthStageTable.system === "vr-corn"`) for each renderer — that's the exact predicate the route loader should use to pick which Svelte component to render for a given crop plugin.

---

## Interactions & behavior

### Global
- **Navigation:** `A_TopBar` is the global nav (Today · Plan · Spray · Harvest · Stock · Records · Settings). Active item gets a forest underline.
- **Sticky footers:** all multi-step flows (stock-add, wizard) have a sticky footer with primary + secondary action. Primary action is always thumb-reachable.
- **Offline indicator:** top-right of every page shows sync state (`online · synced` / `offline · N queued`). Pulled from the Dexie queue length.

### Stock-add 5-method flow
1. User picks a method (barcode default). Method tabs persist as a horizontal grid above the body.
2. Each method has its own body component but **lands at the same lot+exp+qty form** that produces a normalized `StockEntry` payload.
3. **Server-side**, the entry is validated: if it matches an EPA-registered plugin → safety-kernel eligible immediately. If no plugin → entry is created with `pluginStatus: "draft"` and routes into Settings → Plugins → Pending drafts.
4. Lot # is **required** by the safety kernel — UI enforces (red `· required` label), server re-validates.

### Spray decision flow
1. User selects block(s) and product(s).
2. Client posts the tentative mix to `/api/spray/check`.
3. Server runs the kernel: returns `{ verdict: "ok" | "warn" | "block", reasons: [...], decon: boolean, lock: boolean }`.
4. UI renders verdict as a read-only banner. **No client-side override.** A `block` verdict disables the "Apply" button entirely; a helper sees no override affordance; an owner sees a "Bypass with reason" affordance that posts a signed bypass record.

### Wizard
- Each step has both an AI proposal panel and a manual / chat panel. AI toggle in Settings governs which fires.
- Chat panel state is **per-wizard-session, server-stored** — survives page reload and step navigation.
- Commit (step 4) is irreversible. Posts to `/api/plan/commit`, writes plan snapshot, schedules tasks into the Today queue.

### Plan
- Workflow strip across the top is keyboard-navigable (`←` / `→`).
- Map overlay (`mapOpen` state) is a modal — closes on Esc, click-outside, or the close button.
- Provenance side-panel reads from the same `plan_revisions` table that the wizard wrote.

### Harvest record
- Each archetype's harvest schema is different (count + weight + moisture for grain; per-pick weekly for tomato; per-cut for lettuce; cure-start + storage-start for winter squash). Use a discriminated union for the record payload, keyed off the plugin's archetype.
- PHI auto-check on every harvest record: server compares last spray on the block vs the spray plugin's PHI. UI shows the check result; doesn't compute it.

---

## State management

### Server-side (the source of truth)
- Use **SvelteKit form actions** for all mutations (stock-add, spray, harvest, plan commit, settings changes). No optimistic UI for safety-critical mutations.
- Use **load functions** for SSR. Stream large lists (stock, records) where it helps perceived perf.

### Client-side
- **Dexie** for offline queueing of spray + harvest events. Already wired in repo — keep using it.
- **Stores** (Svelte writable) for ephemeral UI state only: wizard chat scrollback, stock-add method tab, plan map-overlay open/closed.
- **No global app store.** Routing + form actions cover what would otherwise be global state.

### Loading + error states
- Loading: skeleton rows in lists (Stock, Records); spinner in primary button while the action is pending. Never block the page.
- Error: inline banner using `rust` token at top of the affected card. For safety-kernel verdicts that return `block`, render the reason list with `Icon.Lock` — these are not errors, they're constraints.

---

## Assets

- **Fonts:** Source Serif 4 + IBM Plex Sans + IBM Plex Mono — all on Google Fonts; the existing `<head>` link in `CropCard Modernization.html` is the production-correct preconnect + `display=swap` setup.
- **Icons:** Lucide-style inline SVGs (`icons.jsx`). Use `lucide-svelte` in the implementation.
- **Imagery:** None. The design is type + color + space — no photo assets are needed for production.
- **Plugin data:** The 137 crop plugins + 64 herbicide / 41 insecticide / 28 fungicide / 18 fertilizer / 20 companion plugins are already in `plugins/**` in the repo. Render against those; don't recreate the mock data in `data.js` for production.
- **Screenshots:** `screenshots/*.jpg` — one JPG per artboard, semantically named to match this README's section order. Use these in PR descriptions, design reviews, or when the HTML harness can't run. Captured at ~900×540, lossy but legible. They are reference frames — the HTML/JSX files are the source of truth for spacing, color, and typography.

---

## Implementation order (suggestion)

If you build top-to-bottom from the canvas, you'll get bogged down in the wizard. Better order:

1. **Tokens + global chrome** — set up `+layout.svelte` with the color tokens, type setup, `TopBar` component, offline indicator. Port `A_Card` / `A_Pill` / `A_Kicker` as small reusable components.
2. **Today** — simplest read-only page, validates your data shape and chrome.
3. **Stock list + add flow** — biggest single-feature value-add. The 5 add methods can ship incrementally: manual → search → barcode → label OCR → AI photo. Each method behind a feature flag.
4. **Spray (one variant first — herbicide)** — exercises the safety kernel verdict pattern. Once herbicide ships, insecticide + fungicide are mostly copy + plugin-data differences.
5. **Harvest** — exercises archetype discrimination. Build the *small-grain* renderer first against the existing wheat plugin; then row-grain (corn); the rest fall out.
6. **Records + Settings** — straightforward forms once chrome is in place. The 10 settings sub-pages can ship in any order.
7. **Plan + Wizard** — last, biggest, hardest. The data shape settles after everything else exists.

---

## What's deliberately NOT in this handoff

- **B (Console) and C (Field) directions** were explored and killed. Don't resurrect — the user committed to Almanac.
- **Multiple Plan variants** explored during design — collapsed to one canonical with 2 sub-states.
- **No screenshots in this bundle by default.** If you want PNGs of every artboard for an external reviewer or PR description, ask and they'll be regenerated and added.
- **No production CSS.** The `almanacBase` CSS string in `direction-almanac-today.jsx` is a starting point but should be ported to your Svelte `<style>` blocks + a small token CSS file, not pasted in wholesale.

---

## Questions worth asking before you start coding

These came up during the design and weren't resolved — confirm with the project owner:

1. **AI photo extract endpoint:** does `/api/stock/extract-photo` exist? The design assumes it returns a structured `StockExtraction` matching a Zod schema. If not built, this is the first server-side endpoint to ship.
2. **Claude web search tier (search method 4, tier 3):** the design assumes Claude can do live web search and return cited results. Confirm the chosen integration (Anthropic native web tool vs server-side proxy) before building.
3. **Plugin draft → approved curator queue:** Settings → Plugins → Pending drafts shows 3 items. Who's the curator role server-side? Owner-self-approve, or a real third-party review?
4. **VDACS audit pack format:** Records page exports one. Is the format finalized (CSV + signed JSON + plugin snapshot tarball)? VDACS hasn't published a v2 spec yet.
5. **Lock window default:** designs show 48h. Confirm before shipping — VDACS guidance language uses "promptly" but doesn't pin the number.
