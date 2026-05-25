# Personas — CropCard

ISO 9241-210 *Context of Use* descriptions. Each persona names goals, tasks, environment, devices, and constraints — what the standard requires before any interface decision is made.

> **Naming note.** The upstream HCD Guide refers to this product as "RowWise". This repository's name is **CropCard** and that is preserved across code, schemas, routes, and DB columns. Both names refer to the same product.

The two roles enforced by [auth.ts](../apps/web/src/lib/server/auth.ts) — `owner` and `helper` — implement the first two personas. P3 is documented in the HCD Guide §3.5 but has no implementation in CropCard yet (see [use-cases.md](./use-cases.md) UC-13..UC-16). P4 and P5 are proposed: they describe real-world journeys the app already implies but never names.

---

## P1 — Sherry, the Owner / Planner / Calibrator

**Role:** `owner`. Plans the season, owns the device, authors plugins, calibrates sprayers, exports records to outsiders.

| Context-of-Use attribute | Detail |
|---|---|
| Primary goals | Get a clean field-card record that survives a VDACS audit. Don't kill a crop with the wrong herbicide. Don't waste a 3-day weather window. |
| Primary tasks | Set up blocks + plantings (UC-01), author/import plugins (UC-08), calibrate sprayers (UC-10), review and export records (UC-09, UC-19), occasionally execute her own sprays (UC-02). |
| Environment — winter | Kitchen-table or office. Wired connectivity. Laptop or large tablet. Multi-tab workflow (CropCard + spreadsheet + extension service docs). |
| Environment — growing season | Truck cab, barn, edge of field. Phone in a jacket pocket. Sometimes gloves on, sometimes off. Sun-glare on screen. |
| Devices | MacBook / Windows laptop (planning); iPhone or Android phone (field); occasionally an iPad on the dashboard. |
| Connectivity | Reliable at the house; spotty 4G at the back of fields in Loudoun County. Must function offline; sync on return. |
| Constraints | Single-farm operator; no IT staff. If something breaks she texts the developer or accepts the breakage until next year. Cannot lose 2 years of records — NFR-05. |
| Cognitive context | Switches between agronomy-deep planning mode and reactive field-execution mode many times per day. Does not want to re-read a spec to remember a rate. |
| Success criteria | Records are exportable as a clean PDF in under 10 seconds when an inspector calls. Calibration takes under 5 minutes. Today's plan is on screen when she picks up the phone in the truck. |

---

## P2 — Marco, the Helper / Field Operator

**Role:** `helper`. Executes the spray, scout, and harvest steps Sherry plans. Cannot edit locked records. Cannot override custom rates.

| Context-of-Use attribute | Detail |
|---|---|
| Primary goals | Get the next task done correctly without thinking about which crop family or chemistry class. Move on. |
| Primary tasks | Open the app, see today's action (UC-11), execute it: scout (UC-05) → spray (UC-02) → optional decon (UC-04) → record. Occasionally harvest (UC-06) or run calibration data collection (UC-10). |
| Environment | Outdoor, year-round, all weather. Sometimes the tractor cab; often just standing in the field. |
| Devices | Personal Android or iPhone. No company-issued tablet. May not be the latest model. |
| Connectivity | Same as Sherry — assume offline at the moment of use. NFR-02 says everything Marco needs must work without a network. |
| Physical constraints | **Gloves on.** One hand often holding something else (jug, sprayer wand, planting tray). Sun directly on screen. Dust. Sweat. |
| Cognitive context | Is told "go scout block 2 and spray if needed." Does not want to type. Does not have time to navigate. Wants the next button to be obvious and big. |
| Authority constraint | Server enforces (per CLAUDE.md invariant #5): cannot edit records past the 48-hour lock; cannot save calibration; cannot override custom rates. |
| Success criteria | Can complete a spray-record from app-open to confirmed-saved in under 90 seconds with gloves on. Never wonders "is this the right block?" because Sherry pre-selected it. |

---

## P3 — Mixed Crop & Hay Operator

**Source:** HCD Guide §3.5. **Implementation status:** UC-13 / UC-14 hay flow shipped (Sprint E). UC-15 stage projection shipped in v1.3 (`growthStageTable` + Plan→Schedule stage badges). UC-16 small-grain harvest-moisture capture still gap. See UC-13..UC-16 and FR-19..FR-23 in [use-cases.md](./use-cases.md); outstanding gaps tracked in [feature-backlog.md](./feature-backlog.md).

| Context-of-Use attribute | Detail |
|---|---|
| Primary goals | Make hay during the 3-day weather window. Hit the moisture target at baling — too high burns the barn down, too low loses leaf value. Hit Zadoks stages on small grains for nitrogen and fungicide timing. For dual-purpose corn (e.g., Bloody Butcher) decide at field-time whether to pick at R3 for sweet eating or leave to R6 for cornmeal / ornamental. |
| Primary tasks | Decide whether to cut today (UC-13). Log each hay step as it happens — Mow → Ted → Rake → Bale (UC-14). Track Zadoks stage progression on wheat / barley / oats (UC-15). Record harvest with moisture (UC-16). View current stage badge + harvest-target windows on every Plan→Schedule card (UC-40). |
| Environment | Tractor cab (mounted phone or tablet); occasionally walking the field with a moisture meter. |
| Devices | Phone or rugged tablet, often dock-mounted in the cab. |
| Connectivity | Same as P1/P2. Weather data needed for UC-13 — will require a forecast adapter (FR-22). |
| Physical constraints | Gloves; tractor vibration; engine noise rules out audio feedback. |
| Cognitive context | Hay decisions are time-critical. A wrong "is the window open?" answer costs an entire cut. Needs a single screen that shows: forecast, last-cut date, target moisture, GO / NO-GO. |
| Authority | Same `owner` / `helper` split as P1/P2. Saving moisture readings is `helper`-allowed (entry-level data); changing thresholds is `owner`-only. |
| Success criteria | Can decide to cut, mow, ted, rake, and bale a field across 3 days and have a complete cutting record with moisture at each step, under 2 minutes total of phone-time across the operation. Stage badge visible on every active corn / small-grain card on Plan→Schedule; dual-purpose corn surfaces both harvest-target windows. |

---

## P4 — Dale, the Inspector / Auditor *(proposed)*

**Source:** Implied by FR-09 (record retention), NFR-05 (audit retention), and the CSV/PDF export feature on `/records`. Never explicitly named in any existing doc.

| Context-of-Use attribute | Detail |
|---|---|
| Primary goals | Verify a spray happened on a specific date for a specific crop, with the chemistry on record. Or verify a harvest lot's pre-harvest interval was respected. Or check that a custom-rate override was authorized. |
| Primary tasks | Receive a PDF or CSV from Sherry. Read it. Cross-reference it against a pesticide registration, a CSA member question, a USDA organic application, or a crop-insurance claim. |
| Environment | Office; rarely the field. Reads the export at a desk on a laptop. |
| Devices | Whatever the auditor's organization issues. Not CropCard's UI. |
| Connectivity | N/A — Dale does not log in to CropCard. |
| Physical constraints | None specific to CropCard. |
| Cognitive context | Adversarial in the sense of needing to see what's wrong. A bad export — missing dates, ambiguous chemistry, no hash audit trail — costs Sherry. |
| Constraints | The PDF/CSV is the entire UI. Whatever isn't on it does not exist for this persona. |
| Success criteria | Reads the export once, finds the row, accepts the answer. Does not call back asking "what does AMS mean" or "what's chemistry class XYZ". |

This persona is the silent driver behind FR-09's 48-hour lock and the PDF-export design. It deserves its own audit pass — *what does the export look like to someone who has never seen the app?* — covered in UC-22.

---

## P5 — First-Run Sherry *(proposed)*

**Source:** Implied. Same person as P1 on day one with an empty database. The current home screen `/` is an 11-tile grid with no guidance for an empty database — first-run guidance is being reworked under UC-26 sidebar nav + landing redesign (tracked in [feature-backlog.md](./feature-backlog.md)).

| Context-of-Use attribute | Detail |
|---|---|
| Primary goals | Understand what this app does. Get the first block defined. Get the first sprayer registered. Get to a point where the dashboard shows something useful. |
| Primary tasks | Sign in (UC-17). Land on the home screen. Try to get to "I have a first planting recorded so I can do anything else" (UC-20, currently unguided). |
| Environment | Kitchen table, evenings, after end-of-day chores in late winter. Probably has the original Final Requirements Spec PDF open in another tab. |
| Devices | Laptop. |
| Connectivity | Online. |
| Physical constraints | None. |
| Cognitive context | Has not yet built a mental model of plugins-vs-plantings-vs-sprayers. Each tile on the home screen reads as a synonym for some other tile. |
| Constraints | If she gives up here, the seasonal plan never gets entered, and CropCard is a write-once paper-replacement that nobody uses. |
| Success criteria | First block + first planting + first sprayer + first plugin imported in under 20 minutes, without consulting external docs. |

This persona is the strongest argument for an explicit onboarding flow (UC-20) — covered in the audit's P0/P1 list.

---

## P6 — Integrator / automation owner *(proposed, Phase 24)*

This is the same person as P1 (Sherry) wearing a different hat, OR a future SaaS integration (FarmOS sync, accounting bridge, scouting drone uploads) acting on a farm's behalf via API credentials.

| Dimension | Value |
|---|---|
| Role | Owner mints Bearer tokens on `/settings/api-tokens`. The token *is* the integrator. |
| Physical context | Server-side: no field environment, no glove operation, no offline constraint. Calls `/api/**` from arbitrary origins (CSRF Origin check bypassed for Bearer-authed requests). |
| Toolchain | Anthropic SDK / Claude Code / FarmOS connector / custom Python script. Reads `/api/openapi.json` to build a tool catalog without parsing TypeScript. |
| Cognitive context | Treats CropCard as a stateful JSON API. Reasons in terms of routes + request shapes + 401/403/409 responses, not buttons + forms. |
| Safety posture | Cannot bypass the safety kernel — every POST re-runs `evaluateSpray()`. Cannot violate tenant isolation — token is owner-scoped at issuance and rejects `POST /api/session/switch-owner`. Cannot mint another token — closes bootstrap loop on a leaked credential. |
| Quota posture | When marked as a **service account** in the UI, gets its own per-`(tokenId, endpoint, UTC-day)` AI quota so a runaway drone can't drain the human owner's daily allowance. Monthly USD cap stays global as the safety brake. |
| Constraints | Token grants the underlying user's role within the issuing Owner. No token sub-scopes (read-only / spray-only) in Phase 24 — deferred to a future phase per epic #59. |
| Success criteria | An external Python script with `Authorization: Bearer cck_…` can read `/api/today`, post `/api/spray/record`, and walk `/api/plan/inputs/refine` without touching the browser UI. Cross-tenant property test extended with a Bearer path passes. |

Primary use case: **UC-43** (External agent orchestration via API token). See the Phase 24 summary in [CLAUDE.md](../CLAUDE.md).

---

## Mapping — personas to roles to use cases

| Persona | Auth role | Primary use cases |
|---|---|---|
| P1 Sherry | `owner` | UC-01, UC-07, UC-08, UC-09, UC-10 (save), UC-15, UC-17, UC-18, UC-19, UC-20, UC-21, UC-23, UC-24 |
| P2 Marco | `helper` | UC-02, UC-04, UC-05, UC-06, UC-10 (entry), UC-11, UC-12, UC-17 |
| P3 Hay Operator | both | UC-13, UC-14, UC-15, UC-16 |
| P4 Dale | n/a (export receiver) | UC-22 |
| P5 First-Run | `owner` (new) | UC-20 |
| P6 Integrator | Bearer (inherits role of underlying user) | UC-43 |

Cross-reference: every implemented use case names its primary persona in [use-cases.md](./use-cases.md); audit-derived gaps are tracked persona-tagged in [feature-backlog.md](./feature-backlog.md), with ongoing clickthrough findings under [clickthrough-reports/](./clickthrough-reports/).
