# Clickthrough report — /records Phase 25 Almanac verification — 2026-05-25

**Tester:** playwright-clickthrough subagent
**Build:** ca8cb96
**Seed:** manual (2 synthetic spray_events inserted for lock visibility; harvest_event + fertility_application already present in dev.db)
**Viewport:** 390x844 (iPhone 14 Pro)
**Auth:** owner session via demo form action

## Summary
- Screens walked: 1 (/records)
- New findings: P0=2, P1=4, P2=2

---

## Findings

### CT-001 — /records is spray-only; insecticide, fungicide, harvest, scout, fertility, planting, decon events not surfaced [P0]
- **Spec:** `direction-almanac-pages.jsx` ARecordsScreen — the unified filter bar has kind chips for: spray, herbicide, insecticide, fungicide, scout, harvest, fertility, planting, decon. All event kinds share one audit table view.
- **Impl:** `apps/web/src/routes/records/+page.server.ts` calls only `listSprayEvents()`. No calls to `listInsecticideEvents`, `listFungicideEvents`, `harvestEvents`, `scout_observations`, `fertility_applications`. The dev DB has 1 harvest_event and 1 fertility_application that are invisible on /records.
- **Observed:** Page heading says "Spray records". Table shows only herbicide spray events. No kind filter chips exist. Harvest events confirmed missing (see GitHub issue #145).
- **Network:** No 4xx/5xx. 200 on page load, 200 on CSV/PDF exports.
- **Screenshot:** ./screenshots/2026-05-25-records-with-data.png
- **Recommendation:** Refactor `+page.server.ts` to union spray_events + insecticide_events + fungicide_events + harvest_events + scout_observations + fertility_applications into a single sorted list with a `kind` discriminator. Add kind-filter chips to the template. This is the prerequisite for the Almanac Records design.
- **Cross-ref:** Confirms finding from /harvest verification (issue #145).

### CT-002 — Missing kind filter chips with tone pills [P0]
- **Spec:** `ARecordsScreen` filter bar renders one chip per kind from `Object.entries(r.counts)`. Each chip uses `A_Pill` with the tone from `kindTone` (spray="rust", insecticide="wheat", fungicide="sky", harvest="wheat", scout="neutral", fertility="sky", planting="forest", decon="rust"). Chips toggle the active filter.
- **Impl:** `apps/web/src/routes/records/+page.svelte` has a `<div class="filters" role="group">` with two `<select>` dropdowns (Sprayer, Block). Zero chip/button filter elements. Zero tone pill elements.
- **Observed:** `chipCount: 0` from DOM query. No kind-filter affordance of any kind visible.
- **Severity rationale:** A user cannot isolate insecticide vs. herbicide vs. fungicide records — the entire cross-kind unified view is absent. This is an audit-trail navigation gap.
- **Screenshot:** ./screenshots/2026-05-25-records-initial.png

### CT-003 — H1 copy and kicker do not match Almanac spec [P1]
- **Spec:** kicker = "Records & audit trail"; H1 = "Records."
- **Observed:** kicker = "FR-09 · 48h lock · NFR-05 · 2yr retention"; H1 = "Spray records"
- **Route:** `apps/web/src/routes/records/+page.svelte` lines 53–54
- **Notes:** The kicker content is engineering spec-speak; the Almanac design uses plain language. The H1 "Spray records" is also now factually incomplete once other kinds are added.
- **Screenshot:** ./screenshots/2026-05-25-records-initial.png

### CT-004 — Header stats missing locked count, YTD count, retention date [P1]
- **Spec:** `ARecordsScreen` stats row: "N records · N locked · N this year. Retained through YYYY-MM-DD."
- **Observed:** `p.lede` reads: "2 records on file. Records lock 48 hours after occurrence; retention 2 years." — no locked count, no YTD count, no computed retention date.
- **Route:** `apps/web/src/routes/records/+page.svelte` line 56–59; `+page.server.ts` does not return `lockedCount` or `ytdCount`.
- **Screenshot:** ./screenshots/2026-05-25-records-with-data.png

### CT-005 — Date-range filter missing [P1]
- **Spec:** `ARecordsScreen` filter bar includes a Calendar-icon date-range button ("2026-01-01 → today").
- **Observed:** No date-range input or button. Filter controls are Sprayer `<select>` and Block `<select>` only. `hasDateRange: false` from DOM query.
- **Route:** `apps/web/src/routes/records/+page.svelte` lines 60–85; `+page.server.ts` does not accept `from`/`to` query params.

### CT-006 — Almanac table columns absent; raw UUIDs and emoji lock instead of Almanac design [P1]
- **Spec:** Table columns: Timestamp, Kind (tone pill), Block·planting, Detail, By, Hash, chevron row action. Lock state shown inline in the Hash cell as `<Icon.Lock size={10} /> {hash}`.
- **Observed:** Table columns: When, Block (raw UUID), Sprayer (raw ID "CORN"), Products (raw plugin IDs), Chemistry, Wind/Temp/Rain, Rules, State. Lock is emoji "🔒 locked" as plain text in State column. No hash column. No "By" (performer) display. No chevron row action.
- **Screenshot:** ./screenshots/2026-05-25-records-locked-record.png
- **Recommendation:** Table layout is a straight implementation gap vs. the Almanac mockup. Block UUID should resolve to block name. Sprayer ID should resolve to label. Hash column requires implementing a hash-chain in sprayEvents.ts. "By" column needs performer name lookup.

### CT-007 — VDACS audit PDF export absent; footer cards (hash chain + inspector access) missing [P2]
- **Spec:** Export CTAs: CSV, PDF, "VDACS audit PDF" (primary). Footer: two `A_Card` panels — "Hash chain" with verify link, "Inspector access" with "Create inspector link" button.
- **Observed:** Export links: "Download CSV", "Download PDF", "Download USDA / NRCS CSV" (no VDACS). `hasVdacs: false`. No hash-chain card. No inspector-access card. `hasInspectorAccess: false`.
- **Route:** `apps/web/src/routes/records/+page.svelte` lines 87–96
- **Notes:** USDA/NRCS CSV is a valid addition not in the Almanac mockup; it does not replace the VDACS audit PDF.

### CT-008 — Lock indicator is emoji text, not Almanac-style pill/icon component [P2]
- **Spec:** Locked rows: `<Icon.Lock size={10} /> {hash}` inside a monospace span with forest color. Unlocked: "unlocked · {hash}" in wheat color.
- **Observed:** Locked rows: `🔒 locked` as plain text in the State column. No hash value shown. No visual differentiation by color token. No Almanac Pill component. `hasPill: false` on both rows.
- **FR-09 compliance:** The 48h lock is functionally enforced server-side (confirmed: `locked_at` set on old record, `evaluateLock` returns defined). The UI indicator is just cosmetically out-of-spec.
- **Screenshot:** ./screenshots/2026-05-25-records-locked-record.png

---

## What passed

- **Navigation:** 7-item top-nav renders; Records marked `aria-current="page"`. Pass.
- **Page load:** HTTP 200, no app-level console errors (6 font 404s are Google Fonts unreachable in dev — not app errors). Pass.
- **Block filter (sprayer/block dropdowns):** Selecting "Block A" navigates to `/records?blockId=...` and filters correctly. Pass.
- **Export endpoints:** `/api/spray/records/export.csv` and `/api/spray/records/export.pdf` return HTTP 200 (authenticated). `download` attribute present. Pass.
- **FR-09 lock enforcement:** Record with `locked_at` set shows locked state; recent record shows "editable". Server-side `evaluateLock` correctly gates mutation. Pass.
- **Kicker component:** `<Kicker>` component renders with correct uppercase style. Pass.
- **Mobile viewport:** Page renders without horizontal overflow at 390px. Pass.
- **Pending sync queue link:** Present and routed to `/records/pending`. Pass.

## Skipped
- Cross-tenant isolation test: only one owner in dev DB; owner-switch to second tenant not possible without seeding a second owner.
- Inspector role: no inspector role in the HMAC session system; inspector access is a future feature per the mockup's "Create inspector link" card.
