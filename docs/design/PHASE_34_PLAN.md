# Phase 34: follow-ups from Phases 30 to 33, organic plugin data and the rest of the Spanish

Started 2026-10-02. Phase 34 picks up the tracked follow-ups left after Phases 32 and 33 went live. It runs as two sprints at once: 34A for the code follow-ups and the organic plugin data, and 34B for the Spanish work in issues #509 and #510. Neither sprint changes a safety rule, so `RULES_VERSION` stays 0.7.1. The CLAUDE.md invariants bind both, invariant 9 (bilingual by default) included.

Task assignees are already done. 32F shipped owner assignment, the Mine/Everyone filter, the time sheet and `task_time_entries`, all on the migration 0067 columns, so Phase 34 has no assignee work. The 34A decider should confirm that against the code and record it as a ruling.

## 34A: finish the Phase 30 open items and wire the organic plugin data

### Start closes the task outside the spray flows

Today Start on a task card opens the matching flow, but only the three spray flows close the task when their record saves (`data.preselect.taskId` on `/spray`, and the insecticide and fungicide equivalents). Harvest, hay, fertility and scout open the right page, and the farmer still has to come back and tap Done. Each of those four flows should carry the task id through to its record endpoint and close the task in the same `writeRecord()` transaction as the record. The offline replay of that record has to close the task exactly once, however many times it replays. A task that is already closed stays as it was, and so does a task belonging to another Owner (tenant check through `foreignRefs.ts`). Helpers can close any task of the farm, as they do from /today, and inspectors cannot. If the farmer opens the flow from a task and then saves a record for a different block or crop than the task named, the task is left open, and the page says so in one line.

### Scheduling a crop calendar suggestion offline

Scheduling a crop calendar suggestion (the Schedule button on /today's suggestions, and on the calendar views that show them) needs signal today and is not queued. It should go through the offline queue as a routed kind and replay idempotently through `withClientRecordId`, with the same "Will save when online" badge the other queued writes show. A suggestion scheduled offline should appear as a pending task in the deck at once and stay visible across a reload. The decider rules on whether the deck builds that pending task from the queue row or from the snapshot.

### One empty state on /plan

An empty `/plan` shows the "Where will this grow?" card (Draw it on the map, Sketch it by size, Just give it a name), and `PlanV2Shell` has its own empty state with overlapping wording. Merge them into one, keeping all three choices, the helper "Ask the owner" variant, the 375px layout and both languages.

### Organic plugin data for the animal-health library

None of the 16 shipped animal-health plugins carries `organicUse`, so the automatic loss of organic status that #521 turned on only fires for plugins a farm uploads itself. `apps/web/scripts/nop-sources.json` already holds a researched status for each plugin under `entries["livestock.<pluginId>"]` (`allowed`, `allowed-with-annotation`, `not-listed`, `prohibited` or `unknown`), each with a quoted 7 CFR 205.603 or 205.604 paragraph and a note. Wire each one into the plugin's `organicUse` following the 33B rulings (B-23 in `PHASE_33_PLAN.md`), with the source recorded and a gate test that fails when a plugin's `organicUse` disagrees with its research entry or has none.

Be conservative here. A product reaches `not-allowed` only when the research shows it is prohibited, or shows it is a synthetic substance that 205.603 does not list. A `not-listed` entry whose note leaves any doubt about whether the product is synthetic stays `unknown`, which the app shows as "needs review". An annotation (parasiticides prohibited in slaughter stock, milk-label waits after fenbendazole or moxidectin) is carried as an annotation the owner reads. The code does not enforce it unless the 33B model already does. The app still never claims certification.

## 34B: the rest of the Spanish (#509, #510)

### Helpers that still return English (#509)

Spanish round 2 (#518) moved many `lib/**` helpers to an optional trailing `locale`. #509's list predates that. Audit every spot it names against the current code, and finish the ones that still return a finished English sentence on a translated surface. Use the round 2 pattern: an optional last `locale`, with byte-identical English when it is left out and the existing tests kept. Server `fail()` and `error()` text that the UI shows goes through `t(event.locals?.locale, ...)`. Safety, hold, withdrawal, grazing, decon, spray rate and mix text stays English by rule (`lib/i18n/englishOnly.ts`), and so do exports, stored text and anything sent to Claude.

### Phase 33 surfaces (#510)

Translate whatever is still English on the 33A to 33D surfaces: organic status and treatment review chrome, `DispositionPanel`, `OrganicInputNotice`, the certifier pack panel, seed sourcing on the seed detail page, the "Where it went" column and the harvest-saved strip on /harvest, the document vault (/settings/documents, `DocumentAttach`), and anything else merged after `c66c842` that renders chrome. Regulatory wording (7 CFR 205 quotes and citations) stays English. The certifier pack and the treatment log CSV and PDF stay English.

### Guards

- Extend the `cropcard/no-raw-text` ESLint rule from TopBar and /settings/account to the translated route and component directories, at `error`, so new untranslated text fails CI. Fix or explicitly exempt (with a reason) everything it finds. Safety text that stays English by rule needs a clear exemption mechanism, not a pile of disables.
- Extend the e2e check "main pages render in Spanish with no raw message keys" so it also fails on a list of known English sentences from the surfaces above.
- That spec's route sweep checks 21 routes inside a 30 s test timeout and fails under full-suite load. Give it a timeout that fits the route count, or split it, without dropping a route.
- `pnpm i18n:check` passes, and `apps/web/scripts/i18n-crawl.mjs` shows nothing new in English on the touched screens.

Issue #511 (the native speaker's review) belongs to the owner's proofreader and stays open. Phase 34 does not chase Spanish proofreading.
