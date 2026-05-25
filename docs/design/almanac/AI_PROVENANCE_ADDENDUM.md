# CropCard — AI-assisted data pre-population (design handoff, addendum)

> **Read me first.** This document is an *addendum* to the canonical
> design spec at `mrpeanut01/crop-card@main`. It does NOT change any
> previously-handed-off UI; it adds a cross-cutting *data provenance*
> layer that governs how every screen pre-populates fields and how the
> system behaves with vs without an AI key.
>
> If you've already started plumbing the UI from the original spec,
> good — this addendum tells you (a) what server contracts the AI layer
> assumes, (b) what `provenance` field every pre-populated value needs
> to carry, and (c) how each surface degrades when AI is off, offline,
> capped, or timed out. None of this changes the SQL schema you've
> already written; it adds a `provenance` enum + one optional column.

---

## Prompt for Claude Code

You're implementing the CropCard PWA from the canonical design spec at
`mrpeanut01/crop-card@main`. The design team just shipped an addendum
formalising a cross-cutting principle that touches every screen you
plumb:

> **AI assists, never gates.** Every form pre-populates as much as it
> can without the user typing. Quantities are usually the only thing
> the user enters. When a Claude key is configured, AI proposes; when
> it isn't, deterministic plugin rules + the user's own records fill
> the same slots. Manual entry is the floor — always reachable, never
> the default.

Concretely, this means **every pre-populated value the UI shows must
carry a `provenance` tag** so the user can see at a glance where it
came from. There are exactly five sources, ranked by preference:

1. **plugin** — From a compiled plugin or safety-kernel rule.
   Deterministic, no network, no key.
2. **data** — Derived from this owner's records (scout counts,
   calibration, prior plantings, soil tests, local weather feed).
3. **ai** — Claude proposed it. Optional, gated on key, capped, with
   a confidence score (0–1).
4. **manual** — User typed or edited it.
5. **fallback** — Would have been AI, but AI was off/over-cap/offline,
   so the deterministic default ran instead. Audit-recorded.

Your tasks:

1. Add a `provenance` enum to your SQL schema (values: `plugin`, `data`,
   `ai`, `manual`, `fallback`). Every record table that holds a
   pre-populatable field gets a `provenance` column on that field, or
   a sibling `*_provenance` column. See **Field-by-field map** below.
2. Implement the **degradation matrix** at the API layer — a single
   `aiTry(endpoint, prompt, deterministicFallback)` helper that
   handles the four trigger conditions and tags the result with the
   correct provenance.
3. Render `<Provenance source detail confidence />` next to every
   field/row that comes from any source other than fresh-manual input.
   The design system already ships the component in
   `direction-almanac-ai-provenance.jsx`; port to your component
   library 1:1.
4. Wire the **AI on/off** global flag (`MOCK.aiEnabled` in the spec,
   `user.ai_enabled` in your schema) so that every screen renders the
   correct variant on first paint. The wizard, Today, Insecticide, and
   Onboarding screens have explicit AI-off variants in the addendum
   canvas — match their visual treatment.

Do NOT special-case "no key" as an error state. It's a first-class,
fully-functional product mode. The product must feel finished for an
inspector (Dale) who will never paste a key.

---

## The four sources — full definitions

| Source     | When it fires                                              | Visual tone           | Always works? |
|------------|------------------------------------------------------------|-----------------------|---------------|
| `plugin`   | Compiled plugin or safety-kernel rule produced the value.  | Forest green          | Yes           |
| `data`     | Computed from owner's local records (SQLite).              | Sky blue              | Yes           |
| `ai`       | Claude proposed; user can accept or edit. Has confidence.  | Wheat gold            | Only with key |
| `manual`   | User typed or edited the value.                            | Warm grey             | Yes           |
| `fallback` | Would have been `ai`; degraded to deterministic default.   | Rust (warning-ish)    | Yes           |

The audit chain stores the provenance for every value at write time.
A `fallback` row also stores `attempted_ai_at` + `fallback_reason` so
that a later "ask AI now" flow can re-run the proposal if the user
adds a key.

### Confidence semantics (`ai` only)

- `0.90+` — High confidence. Render badge without warning chrome.
- `0.75–0.90` — Medium. Badge tone unchanged, but the field's `Edit`
  affordance is one tab-stop earlier.
- `< 0.75` — Low. Add a warning glyph on the badge and surface
  "Review before save" microcopy under the field. Field is still
  pre-populated — never blank.

---

## The degradation matrix

| Trigger                | Behind the scenes                                                                       | What the user sees                                                                                       |
|------------------------|------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------|
| No key configured      | AI endpoints return `{status: "no-key"}`; deterministic path runs in the same handler.   | AI badges + chat panels vanish. "Use Claude" CTAs replaced with "Add a key in Settings → AI" link.       |
| Monthly cap reached    | Endpoint gate at `aiTry()`. Increments `cap_blocked_count`. Deterministic path runs.     | Banner on Settings → AI. Wizard chat shows "cap reached — manual still works".                            |
| Offline                | `navigator.onLine === false`. AI calls skip the network; deterministic path runs.       | TopBar pulse "offline · queued". Stock-add AI-photo tab disables; other four tabs work.                  |
| Rate-limited / timeout | Single endpoint times out at 6s. That endpoint disables for ~10 min via Litestream flag.| Inline "AI took too long — used the default" notice with a retry button. Other endpoints unaffected.     |

The `aiTry()` helper is the only place these conditions are checked.
Implement it once; every AI-touchable endpoint goes through it.

```ts
// server/src/lib/aiTry.ts
type AiTryArgs<T> = {
  endpoint: string,          // for quota counting
  prompt: () => Promise<T>,  // the Claude call
  fallback: () => Promise<T>, // deterministic default
  timeoutMs?: number,         // default 6000
};

export async function aiTry<T>(args: AiTryArgs<T>): Promise<{
  value: T,
  provenance: "ai" | "fallback",
  confidence?: number,
  fallbackReason?: "no-key" | "over-cap" | "offline" | "rate-limit" | "timeout",
}> { /* ... */ }
```

---

## The component contract

### `<Provenance source detail compact confidence />`

Ports from `direction-almanac-ai-provenance.jsx`. The
implementation must match these props exactly so that designer-shipped
markup pastes cleanly into svelte-component form.

| Prop         | Type                                                | Default   | Notes                                              |
|--------------|-----------------------------------------------------|-----------|----------------------------------------------------|
| `source`     | `'plugin' \| 'data' \| 'ai' \| 'manual' \| 'fallback'` | required  | drives tone + icon + label                          |
| `detail`     | `string`                                             | optional  | e.g. `"corn-bb · v1.4"` or `"your scout · May 24"` |
| `compact`    | `boolean`                                            | `false`   | icon-only variant for dense tables                  |
| `confidence` | `number (0–1)`                                       | optional  | `ai` source only — renders as `%`                  |

Plus the legend strip `<ProvenanceLegend shown={[...]} note={...} />`
for screens that mix sources (Today recommendations, every Spray flow,
Plan v2, Wizard schedule step).

---

## Field-by-field map (where to wire badges)

| Screen / surface                | Field                                       | Default source     | Notes                                                          |
|---------------------------------|---------------------------------------------|--------------------|----------------------------------------------------------------|
| **Today — action card**         | The whole card                              | `data` + `plugin`  | Trap count = data; threshold = plugin. Both badges visible.    |
| **Today — recommendations**     | Ordering                                    | `ai` ↔ `fallback`  | AI ranks when on. Plugin order when off — surface as fallback. |
| **Onboarding — sample plan**    | Seeded blocks/plantings                     | `ai`               | If skip-AI, no seed; user enters blocks manually.              |
| **Spray (any) — tank mix**      | First product                               | `plugin`           | Rotation kernel always picks the safety-mandated row 1.        |
| **Spray (any) — extra products**| Rate, mix order                             | `ai` ↔ `fallback`  | AI proposes refinement; plugin default is fine without.        |
| **Spray (any) — IPM gate**      | Trap count                                  | `data`             | From owner's scout log.                                        |
| **Spray (any) — IPM gate**      | Threshold                                   | `plugin`           | From the pest plugin.                                          |
| **Spray (any) — pollinator**    | Bloom stage, bee forecast                   | `plugin` + `data`  | Stage from crop plugin; forecast from local weather feed.      |
| **Stock-add — barcode**         | All matched product fields                  | `plugin`           | Plugin lookup by EPA reg #.                                    |
| **Stock-add — label OCR**       | All extracted fields                        | `manual` initially | Mark `ai` once user accepts. OCR confidence drives review CTA. |
| **Stock-add — AI photo**        | All extracted fields                        | `ai` w/ confidence | Per-field confidence; lot # never `ai` (always manual).        |
| **Stock-add — search t.3**      | Claude-found results                        | `ai` w/ confidence | Creates a draft plugin; never released to safety kernel.       |
| **Stock-add — manual**          | All fields                                  | `manual`           | No badge; user is typing.                                      |
| **Plan v2 — planting cards**    | Provenance footer (already exists)          | varies             | Normalise to use `<Provenance>` 1:1; remove ad-hoc styling.    |
| **Plan v2 — workflow strip**    | `Source` column                             | varies             | Already exists; swap strings for `<Provenance compact />`.     |
| **Wizard step 0 — guardrails**  | Default philosophy + tillage                | `plugin`           | Derived from county defaults.                                  |
| **Wizard step 1 — allocation**  | Initial allocation proposal                 | `ai` ↔ `fallback`  | AI chats; deterministic = "leave unallocated".                 |
| **Wizard step 2 — schedule**    | Each Gantt bar                              | `plugin` ↔ `ai`    | Plugin computes window; AI proposes specific date within it.   |
| **Wizard step 3 — inputs**      | Application list                            | `plugin` ↔ `ai`    | Plugin = baseline. AI proposes substitutions ("K-Mag → Foliar").|
| **Settings → AI**               | the whole panel                             | n/a                | Config surface — not provenance-tagged itself.                 |
| **Records (audit trail)**       | Provenance column                           | varies             | Every row in the audit chain stores its write-time provenance. |

Anything not in this table is plain manual entry and doesn't need a
badge — but DO render `<Provenance source="manual" />` once the user
edits an AI- or plugin-populated field, so the change is visible.

---

## What changed in this addendum

### New files

- **`direction-almanac-ai-provenance.jsx`** — defines the
  `A_Provenance` component, the `A_ProvenanceLegend` strip, the
  `A_DataPhilosophyArtboard` reference page, and the
  `PROV_SOURCES` token table. Port the component + tokens to your
  Svelte component library 1:1.

### Edited files

- **`icons.jsx`** — added `Sparkle` and `Refresh` icons (Sparkle was
  used by stock-add but missing).
- **`CropCard Modernization.html`**
  - CoverCard invariants: replaced "Single replica" with
    **"AI assists, never gates"** (which is now a top-level invariant
    alongside the safety kernel + tenant isolation + offline-first).
  - Added artboard `00 · ai-philosophy` (1440×920) in section 00.
  - Added artboard `02 · today-aioff` next to `02 · today`.
  - Added artboard `03 · spray-insect-aioff` next to `03 · spray-insect`.
  - Loaded `direction-almanac-ai-provenance.jsx` before the rest.
- **`direction-almanac-today.jsx`** — `ATodayScreen` accepts an
  `aiEnabled` prop; action card now shows `data` + `plugin`
  provenance badges; recommendations card swaps between `ai`
  (ranked, with confidence) and `fallback` (plugin defaults).
- **`direction-almanac-insecticide.jsx`** — `AInsecticideScreen`
  accepts an `aiEnabled` prop; new provenance legend strip above the
  stepper; tank-mix products tagged plugin (row 1) vs ai/fallback
  (subsequent rows); IPM gate tagged with both `data` (your traps)
  and `plugin` (threshold).
- **`direction-almanac-onboarding.jsx`** — AI offer card rewritten to
  make optionality explicit: explicit "Skip · I'll add a key later (or
  never)" CTA, plus an info row that lists what still works without a
  key (308 plugins, calibration math, safety kernel, calendar
  derivations, CSV import).
- **`data.js`** — expanded `aiSettings.keepWorking` and
  `aiSettings.gatedFeatures` to cover every surface the engineer
  needs to know about. The Settings → AI gated-vs-always-works
  table reads from these lists.

### Unchanged

The original spec's screens, routes, components, and SQL invariants
are all preserved. The provenance layer is purely additive — it
introduces a new badge, a new prop, a new server helper, and one
optional column. Nothing previously committed needs to be rewritten.

---

## Server-side implications (quick checklist)

- [ ] Add `provenance` enum to SQL schema (`plugin | data | ai | manual | fallback`).
- [ ] Audit-chain table (`spray_events`, `harvest_events`, etc.) gets
      a `provenance` column on every pre-populatable field. Rows
      tagged `ai` also store `ai_confidence` (real, 0–1).
- [ ] Rows tagged `fallback` also store `fallback_reason` (text,
      same five values as the degradation triggers) and
      `attempted_ai_at` (timestamptz).
- [ ] Implement `aiTry()` helper. Every endpoint that *could* call
      Claude goes through it; every other endpoint runs as before.
- [ ] Cap-check + per-endpoint quota counters live in
      `tenant_ai_usage` (already in the spec, just exposed via the
      degradation matrix now).
- [ ] `user.ai_enabled` boolean (defaults `false`). Set to `true` when
      the key is saved + validates against Claude in the API key flow.
- [ ] Add a `/api/audit/re-ask-ai` route that, given an audit row
      where `provenance = 'fallback'`, retries the AI call (once the
      key is configured) and either patches the row (owner-only) or
      records a sibling row depending on the audit-chain rules.

---

## Reference — visual tokens (taken directly from the addendum)

```js
PROV_SOURCES = {
  plugin:   { label: "Plugin",     fg: "#1F3A28", bg: "#E5EEDF", bd: "#C9DBC0", swatch: "#2C5237", icon: "Lock"     },
  data:     { label: "Your data",  fg: "#3A586E", bg: "#DEE7EF", bd: "#BDCDD9", swatch: "#6F8FA8", icon: "FileText" },
  ai:       { label: "AI",         fg: "#8A6722", bg: "#EFE6CC", bd: "#D9C18F", swatch: "#B8893C", icon: "Sparkle"  },
  manual:   { label: "You typed",  fg: "#4A4F46", bg: "#E9DFCC", bd: "#D9CFB7", swatch: "#7A7F75", icon: "Edit"     },
  fallback: { label: "Fallback",   fg: "#8A341B", bg: "#F1D9CE", bd: "#E2B69E", swatch: "#A64A2A", icon: "Refresh"  },
}
```

All colors are already in the Almanac token set (`A.forest`,
`A.sky`, `A.wheat`, `A.inkSoft`, `A.rust`) — `PROV_SOURCES` is the
provenance-specific re-bind so the palette stays consistent.

---

## What we'd do next (not in this addendum, suggested follow-ups)

1. **Spread provenance to Herbicide + Fungicide** — currently only
   Insecticide carries the badges across the spray family.
2. **Normalise Plan v2's existing provenance** — it has its own
   ad-hoc `APlantingProvenance` and a `source` string column on the
   workflow strip. Both should swap to `<Provenance>` 1:1 so the audit
   trail and the UI use the same vocabulary.
3. **Harvest + Stock row provenance** — every lot row should carry
   `plugin` (matched product) vs `manual` (typed entry) vs `ai`
   (Claude-photo-extracted) so the inspector can audit the chain
   visually.
4. **Records page filter chips** — let Dale filter the audit chain
   by provenance ("show me everything AI proposed in May").
5. **Settings → AI re-run panel** — once `attempted_ai_at` is in the
   schema, expose a "Re-ask Claude for 14 fallback decisions" button.

Each is small, additive, and reuses the same vocabulary. Tackle in
that order — the spread (1) is the biggest user-visible win.
