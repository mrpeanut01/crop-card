# Clickthrough — Lifecycle post-season S7 (compliance/exports) & S8 (close-out/winterization)

**Date:** 2026-07-04
**Agent:** lifecycle playtest (HTTP curl + source read; browser tools unavailable)
**Server:** http://localhost:5283 · **Session:** owner (`owner@cropcard.local`, activeOwner=`1bd75e19-6ec6-4fd0-8427-42922a7fa21f`)
**Spec:** `docs/design/SEASON_LIFECYCLE.md` §S7 (S7-A1..A22, S7-G1..G13), §S8 (S8-A1..A8, S8-G1..G4)
**Companion (cited, not re-run):** `scratchpad/playtest/api-kernel-records.md` — FR-09 insecticide/harvest DELETE lock-bypass (Probe 3), owner `?force` locked-spray delete with no tombstone (S7-G10), account-JSON missing kinds + `api_tokens` (Probe 5), trailing `#` CSV signature row (S7-G9), USDA missing moisture/crop columns (S7-G7/G8). Those exact probes are **already CONFIRMED there** and are not re-executed.

---

## Verdict

- **S7 (compliance/exports): PASS with confirmed gaps.** The unified ledger, lock enforcement, inspector role, and the four export pipelines all function. But the receiver-POV (UC-22) acceptance gaps are real: date-range filter silently ignored on 2 of 4 exports, hay invisible, `/settings/records` is decorative, VDACS PDF instructs a nonexistent CLI, USDA column contract short of the inspector checklist.
- **S8 (close-out/winterization): CONFIRMED DEAD-END across the board.** All 8 dead-ends (S8-A1..A8) reproduce. There is no close-out surface, no winterization state, no year-end summary, and carry-forward copies philosophy enums only. Each dead-end maps cleanly to one of the four unclaimed feature epics UC-44/45/46/47.

---

## S7 — Post-season compliance & exports

### S7-A1 — Unified ledger, 8 kind chips — **PASS**
`GET /records` → HTTP 200, 76 KB. All **8** kind chips render (spray, insecticide, fungicide, scout, harvest, fertility, planting, decon). **9th kind (hay) absent** — confirms S7-G6 below.

### S7-G6 — Hay missing from ledger — **CONFIRMED**
`recordKinds.ts:15` enumerates exactly 8 kinds (no `hay`/`cutting`). `grep -niE 'hay|cutting' recordsUnified.ts` → **zero hits** — no hay branch in `listUnifiedRecords`. A forage operation's mow/bale history never surfaces in `/records` or any export.

### S7-G2 — Date-range filter silently dropped on CSV + PDF — **CONFIRMED (source + live)**
Per-export `searchParams` reads:

| Export | reads sprayerId | reads blockId | reads from/to | Source |
|---|---|---|---|---|
| `export.csv` | ✓ | ✓ | **✗ ignored** | `+server.ts:29-31` — `listSprayEvents({sprayerId, blockId})` only |
| `export.pdf` | ✓ | ✓ | **✗ ignored** | `+server.ts:56-58` — same |
| `export.usda.csv` | **✗ ignored** | ✓ | ✓ | `+server.ts:68-74` — reads `blockId, from, to`; NOT sprayerId |
| `export.vdacs.pdf` | ✓ | ✓ | ✓ | `+server.ts:80-85` — reads all four |

**Live proof (CSV):** unfiltered → 1 data row; `?from=2099-01-01&to=2099-12-31` (future, should be 0) → **still 1 row**. Date range ignored, no warning.
**Live proof (VDACS honors it):** full PDF 5025 B → future-range PDF 3921 B (shrinks). VDACS correctly filters.
**Live proof (USDA ignores sprayerId):** unfiltered 3 lines → `?sprayerId=bogus` 3 lines (unchanged) — confirms the S7-G2 USDA sub-claim.

An operator who filters `/records` to June and clicks **Export CSV** or **Export PDF** gets the full 2-year set with no warning. (S7-A16 is expected-fail per spec — confirmed still failing.)

### S7-G1 — `/settings/records` is decorative — **CONFIRMED (source)**
`settings/records/+page.svelte`:
- **Hardcoded 7-yr / 3-yr / 1-yr tiles** (`:10-13`: Spray "7 yr", Harvest "7 yr", Scout "3 yr", Photos "1 yr") — contradicts the loader's `SPRAY_RETENTION_YEARS = 2` (`+page.server.ts:15`) and the page's own sub-copy "VDACS expects 2 years" (`:31`).
- **Dead lock-window input** (`:50`): `value={data.retention.sprayYears * 0 + 48}` — the `* 0` neutralizes the bound value to a literal 48; never persisted, no settings key.
- **Fabricated hash-chain stats** (`:16` comment: "we don't have a real hash chain yet"; `:69` "Last verified" is a string literal).
- **Permanently-disabled "Re-verify chain" button** (`:78` — hardcoded `disabled`).

### S7-G3 — "Download VDACS audit pack" points at the wrong endpoint — **CONFIRMED**
`settings/records/+page.svelte:79` — the "VDACS audit pack" link href is `/api/spray/records/export.usda.csv` (the USDA **CSV**), not `/api/records/export.vdacs.pdf`.

### S7-G5 — "Create inspector link" mis-sold — **CONFIRMED**
`settings/records/+page.svelte:82` — "Create inspector link" links to `/settings/helpers` (inspector-role invite; not time-boxed, not login-free). The `/records` reassurance card likewise promises "time-boxed / no login required" but links to `/settings/api-tokens` (Bearer agent tokens — wrong feature).

### S7-G4 — VDACS PDF instructs a nonexistent `cropcard verify` CLI — **CONFIRMED (source)**
`export.vdacs.pdf/+server.ts:297` emits:
`` Hash-chain verification: run `cropcard verify --hash=…` to confirm the record set has not been tampered with ``
Repo grep for a `cropcard verify` CLI/bin → **zero hits**. An inspector following the PDF's own instruction hits a dead end.

### S7-G8 — USDA CSV column contract short of receiver checklist — **CONFIRMED (live header)**
Live header (13 cols): `date_iso, block_label, applicator, product_name, epa_reg_no, active_ingredients, rate_per_acre, rate_unit, area_acres, target_pest, weather_wind_mph, weather_temp_f, warning`.
**Missing** VDACS/NRCS-required fields: no **crop/commodity-treated** column, no **applicator certification number**, no **total-amount-applied** (rate/acre only). `applicator` is a human email ✓; `MISSING_EPA_REG` warning col present ✓.

### S7-G7 — Moisture absent from inspector exports — **CONFIRMED (source)**
`grep -niE moisture` over `export.usda.csv` and `export.vdacs.pdf` → **zero hits**. UC-16's success criterion ("export shows moisture column for inspector") is unmet even though moisture is now captured (Sprint 19).

### Retention alert formula (static "warns AFTER expiry not before") — **PARTIALLY CONFIRMED (nuanced)**
`recordsApproachingRetention` (`sprayEvents.ts:245-251`):
```
cutoff = now - (RETENTION_WINDOW_MS - RETENTION_ALERT_WINDOW_MS)   // now - 700d (2yr - 30d)
return listSprayEvents({ toMs: cutoff })                           // occurredAt <= cutoff
```
Math analysis:
- The 30-day approach window (records aged 700–730 d, **not yet expired**) IS correctly caught — so the alert is not purely inverted.
- **BUT the filter has no lower bound.** It returns every record older than 700 d indefinitely, including already-expired rows (≥730 d). So the "⚠ approaching the 2-year horizon" strip keeps firing for records that expired months or years ago — the copy is wrong for those rows.
- Net: the static finding is directionally right — the alert cannot distinguish "approaching" from "long past expiry," and there is no upper-age bound to scope it to the true 30-day pre-expiry window. **A correctly-scoped alert would filter `now-730d <= occurredAt <= now-700d`; the code filters `occurredAt <= now-700d`.**
- Live: no ~23-month record was present in the seed, so the strip did not render on `/records` this run (S7-A17 unverified live; source is definitive).

### S7-A14 / account JSON — kinds divergence — **CONFIRMED (cross-check w/ scratchpad)**
`GET /api/account/export.json`: `events` dict has **5** kinds (`spray, insecticide, fungicide, scout, harvest`); `summary.countsByKind` reports **8** (adds `fertility:0, planting:3, decon:3`). **planting (3) and decon (3) are counted but absent from the `events` body.** Matches `scratchpad/playtest/api-kernel-records.md` Probe 5 (which additionally confirms `api_tokens` and hay entirely absent). Not re-probing the already-confirmed omissions.

### FR-09 lock bypass on non-spray DELETE — **CONFIRMED (cited, not re-run)**
Per `scratchpad/playtest/api-kernel-records.md` Probe 3: insecticide + harvest DELETE ignore any lock (no `lockedAt` column, no `evaluateLock`); owner `?force=true` hard-deletes a locked spray row with **no tombstone** (S7-G10). Not re-executed per scope instruction.

### Not verified this run (browser/role/seed dependent)
- S7-A6/A7/A8/A9 (detail-page lock banner, PATCH lock, helper/inspector read-only walk) — role-session + detail-page rendering; source references present (`sprayEvents.ts:150/163/226`, `auth.ts:68` inspector 403 confirmed to exist). Inspector 403 gate **confirmed in source**.
- S7-A17 retention strip live render (no aged seed present).
- S7-A22 receiver dry-run (manual persona test).

---

## S8 — Post-season close-out & winterization — **ALL DEAD-ENDS CONFIRMED**

Repo grep `winteriz|closeout|close-out|season.close|year in review|season summary` over `apps/web/src/{routes,lib}` → **zero code hits** (only the spec doc matches). This is the ground truth behind every assertion below.

| Assert | Click-path a farmer tries in October | Result | Maps to |
|---|---|---|---|
| **S8-A1** | `/today` → look for "end of season" | `GET /today` grep `close/winteriz/dormant/year-end` → **0 matches**. No close-out CTA anywhere. | **UC-44** |
| **S8-A2** | `/spray/decon` → hope it covers storage prep | Wizard is strictly between-spray: `+page.svelte` has **no** `winteriz/antifreeze/storage/nozzle-removal` step; 30-min ammonia-soak dwell copy (`:42-43`) confirms between-spray intent. No "sprayer is now stored" state. | **UC-45** |
| **S8-A3** | `/equipment/[id]` → look for "Winterize" | `equipment_state` schema has **no** `winterized_at` / `storage_location` column (grep → 0). `equipment_log` (`schema.ts:692`) has no `'winterize'` kind. No winterize control under `routes/equipment/`. `/equipment/winterize` → **404**. | **UC-45** |
| **S8-A4** | `/settings/records` → archive or lock the year | `+page.svelte` has **zero** `<form>` / POST / `use:enhance` — read-only explainer + export GET links only. No "close year", no purge of aged data, no archive. | **UC-44** (year-lock) + **UC-46** (summary export) |
| **S8-A5** | `/settings/season` → "Use last year's answers" | `carryForward()` (`setup.server.ts:156-170`) copies exactly **7 SeasonSetup fields** (philosophy, weedStrategy, pestStrategy, fertilityApproach, coverCropIntent, sprayCapacity, transitioningStartedYear). **No** plantings, rotation, stock, or equipment. Live POST `/api/season/setup/carry-forward` → 200, `{"setup":...}` shape = SeasonSetup only. | **UC-47** |
| **S8-A6** | `/plan` in January → allocate next season | Allocator has no prior-year rotation constraint; `nCreditForIntent()` keys off the setup *enum*, not actual terminated cover-crop plantings (per spec + S8-G4). | **UC-47** |
| **S8-A7** | `/harvest` → "season complete" after last pick | `GET /harvest` grep `season complete / all plantings resolved / close-season` → **0 matches**. Half-harvested plantings persist forever with no aggregate resolution state. | **UC-44** (checklist predicate) |
| **S8-A8** | Anywhere → year-end summary | No aggregated season report on any route (grep "year in review"/"season summary" → 0). Per-record CSV/PDF exports exist; no aggregate. | **UC-46** |
| — | `/settings/season/close-out`, `/settings/season/close`, `/api/season/close` | All → **HTTP 404** (routes do not exist). | **UC-44** |

### Dead-end → feature-epic mapping (S8-G register)

| Feature epic | Backing dead-ends | Gap ID |
|---|---|---|
| **UC-44** — Season close-out state machine (checklist, year hard-lock, dormant /today, audit, reopen) | S8-A1, S8-A4, S8-A7, + 404 close routes | **S8-G1** |
| **UC-45** — Equipment winterization (chemistry-aware SOP, `winterized_at`, spring de-winterize task) | S8-A2, S8-A3 | **S8-G2** |
| **UC-46** — Year-end summary (deterministic aggregate + optional AI narrative, PDF/CSV) | S8-A8, S8-A4 | **S8-G3** |
| **UC-47** — Full carry-forward + rotation advisor (plantings→history, cover-crop N-credit, overwintering survives boundary) | S8-A5, S8-A6 | **S8-G4** |

---

## Notes for the roadmap

- **S7 keystone fix:** S7-G2 (date-range dropped on CSV/PDF) is a 2-line-per-file fix (thread `from`/`to` into `listSprayEvents`) and is the single most user-visible S7 defect — an operator who filters and exports gets a silently wrong file. USDA additionally needs `sprayerId` threaded.
- **S7 receiver-blockers (UC-22):** S7-G4 (nonexistent CLI in the PDF), S7-G6 (hay invisible), S7-G7 (no moisture), S7-G8 (missing crop/cert/total-amount columns) are the four that would make a real VDACS/NRCS inspector send Dale back with questions.
- **S7-G1/G3/G5** cluster on `/settings/records` — the whole page is a candidate for a rewrite once UC-44 (year-lock) and UC-46 (summary) give it real actions to host.
- **S8 is greenfield:** zero code hits for the entire close-out/winterize surface. UC-44 is the keystone (its checklist + year-lock is the only safety-adjacent piece needing kernel-grade tests); UC-45/46/47 hang off its boundary but are each independently shippable.
