# 32C ruling C-35: backdating and the hold guard

Status: adopted by the 32C hardening decision panel on 2026-09-27 (judges 1 and 2, with judge 3 dissenting in favour of a read-time clamp). The implementation on this branch was interrupted by a container restart and is unfinished; see the checkpoint PR.

## Votes

| Judge | Lens                     | Choice (in substance)                                                                                                                                                                                  |
| ----- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Owner-farmer             | **One write-time monotone-holds guard.** It compares the state with the write against the same record entered today. Adds a tiered date window, and the owner can confirm a shortening.                |
| 2     | Food safety and security | **One write-time monotone-holds guard.** It closes open facts at now, projects the whole tenant, and compares before with after. Adds rules for declarations. The owner can void a record within 48 h. |
| 3     | Engineering              | Read-time clamp on effective time (the stated date for facts that open a hold, `max(stated, recorded)` for facts that close one). Same rule for every role.                                            |

**Adopted: option E, one transactional guard that never lets a hold shorten, checked at write time (judges 1 and 2).**

Judges 1 and 2 agree on the core:

- one enforcement point inside `writeRecord()`'s transaction, in `lib/server/holdGuard.ts`, backed by a pure kernel comparator;
- it covers every write that can affect a hold, including edits, deletes, undo, plugin, block and attestation writes;
- honest records dated now always pass, and records that only add holds pass;
- `409 HOLD_WOULD_SHORTEN`;
- terminal events must come last;
- only an interactive cookie owner has a narrow, audited exception. It is never open to Bearer tokens or impersonation, and never covers prohibited or indefinite holds;
- one fast-check property plus replays of all 56 earlier bypasses.

Judge 3's read-time clamp is not adopted as the mechanism. Three of its ideas are compatible and are kept:

- hold parameters take the maximum of the snapshot and current data;
- deleted records leave tombstones;
- fact kinds are classified exhaustively, so a new kind fails typecheck.

Where judges 1 and 2 differed on a detail, the safer choice (judge 2) was taken, unless judges 2 and 3 together outvoted it. The choice made at each such point is noted inline below.

---

## Spec

### 0. Terms

- **Hold:** a period during which a subject may not be used for a purpose:
  - withdrawal for meat, milk or eggs;
  - the pre-slaughter removal hold;
  - grazing-interval and hay holds on a block.
- **Subject key:**
  - an individual animal id for meat and milk, and for the pre-slaughter hold;
  - a flock id for eggs;
  - a stable area id (the block or field lineage id, which survives delete and reassign) for graze and hay.
  - Never a group id or a source-record id, so splits, joins, leaves and renames cannot drop a key.
- **Declaration:** a record that reads holds rather than changing them:
  - slaughter;
  - sale for meat;
  - an egg or milk production log whose use is food or sale;
  - hay cut, bale or feed steps;
  - a harvest record on a forage or grazeable block;
  - a meat declaration (C-06).
- **Interactive owner:** `isInteractiveOwner(event)` in `lib/server/interactiveOwner.ts`: a cookie session, `activeRole==='owner'`, not impersonating. Bearer tokens (service accounts too) and impersonation sessions are **helper tier** everywhere in this spec.
- `now`: the server clock when the transaction starts. Client clocks are never used. An offline replay uses the time the server received it.

### 1. Date checks (run first, before the guard)

Applies to every write in the section 3 coverage list.

| Check                | Rule                                                                                                                            | Code / status                       | Copy                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Future               | `occurredAt > now + MAX_FUTURE_SKEW_MS` (5 min, `animals/model.ts`) for **every** kind, including mow, hay steps and production | `IN_THE_FUTURE` 400 (existing code) | "That date is in the future. Records are for what already happened. Use a task to plan ahead."                                                          |
| Declaration lookback | Interactive owner: 7 days back at most. Helper tier: 24 h at most.                                                              | `BACKDATE_TOO_FAR` 422              | "Eggs, milk, meat and hay can be dated up to 7 days back (24 hours for helpers). For anything older, add a note to a record. It won't change any hold." |
| Other lookback       | Every role, back to 400 days                                                                                                    | `BACKDATE_TOO_FAR` 422              | "Records older than 400 days can't be entered."                                                                                                         |

Notes on the table:

- **Declarations:** judge 2's window. It bounds the one risk the guard cannot see, a false date on a declaration.
- **Other records:** judges 2 and 3 outvote judge 1's 48 h limit for helpers. The guard already makes backdated records safe, and refusing a late treatment or spray is a safety regression.
- Birth and acquisition dates are attributes of the animal, not dated records, so these windows do not apply to them.
- **Late label:** a record with `occurredAt < createdAt − 48 h` stores `recorded_late = true`, derived through `daysLate()` in `lib/server/animalProductionGate.ts`. It shows as "Entered N days late" on record cards, /records, USDA/VDACS exports and the year summary. It is a label only and no gate reads it.
- A refused offline-queue item stays in the pending list. It is marked "Owner must enter" or "Change the date" and is never dropped. A refused interactive submit keeps the client draft so the date can be changed without retyping.

### 2. Invariant I1: holds never shorten (pure kernel)

New file `apps/web/src/lib/safety/holdLedger.ts`, with no DB and no I/O:

- `projectHolds(facts: HoldFact[], nowMs): HoldProjection`
  - `holds: Map<SubjectKey × Kind, Interval[]>`, where `Kind ∈ meat | milk | eggs | preSlaughter | graze | hay`, each interval is `[start, clearAt)`, and `clearAt` may be `∞` for a prohibited drug, an unknown label or an indefinite hold.
  - `covered: Set<CoverageId>`, judge 1's C-set. It holds:
    - the ids of production logs that fall inside a hold;
    - meat declarations made under a hold (C-06);
    - stays that break a grazing interval.
  - **Truncation:** an open fact (an open stay, an open treatment course, an open membership) is treated as closed at `nowMs`.
  - Holds on dead, sold or declared subjects stay in the projection.
- **Parameters:** withdrawal days, grazing or haying interval, label class and prohibited flag are taken from the snapshot on the opening fact at write time. The value used is `max(snapshot, current shared plugin, farm copy, stock bottle, label-use answer)`. A later change to data can therefore only lengthen a hold.
- **Deletes and undo** write tombstones: `deleted_at` and `deleted_by` on stays, memberships, block assignments and sprays, extending C-26.
  - A tombstoned fact still counts in the projection, **except** after an owner void (section 5).
  - An edit is recorded as a tombstone of the old fact plus a new fact.
- `FACT_EFFECT: Record<FactKind, 'opens' | 'closes' | 'declares'>` classifies every fact kind, so an unclassified kind fails typecheck.
  - **opens:** health dose or course; spray, insecticide or fungicide application on a block; stay start; animal created with housing; group join; start of split-child lineage; block assignment.
  - **closes:** stay end (move off, leave, undo); group leave; split parent end; block delete or reassign; status outcome (died, sold, culled); pre-slaughter removal.
  - **declares:** see section 0.
- `shortenings(before, after): Shortening[]`
  - For every key, every instant `t` that is in a hold in `before` and not in `after`. It checks all of time, with no horizon. A key missing from `after` counts as never held.
  - Plus every `id ∈ before.covered \ after.covered`.
- **Acceptance:** `shortenings(projectHolds(F, now), projectHolds(F′, now))` must be empty.

Consequences:

- A record dated now can never shorten a hold, because truncation already ends open facts at now. This matches judge 1's rule that a record dated today is always allowed.
- A backdated record that only adds or lengthens holds always passes.
- A backdated move-off, split, leave, join, course end, status, undo, label-use change, block delete or reassign, spray delete, or shorter farm plugin copy is refused **only when it would actually remove held time or coverage**. For example, a late split with no later doses or moves passes.

### 3. The single enforcement point

`apps/web/src/lib/server/holdGuard.ts` exports `guardedHoldWrite(event, fn, opts?)`. It runs inside the existing `writeRecord()` transaction (`lib/server/recordWrite.ts`, which includes the replay receipt):

1. Run the date checks (section 1) and lifecycle ordering (section 4).
2. Load **all** hold facts for the tenant through tenant-scoped repos, tombstones included, and project `before`.
   - Whole tenant, not an affected set. Judge 2's safer choice: affected-set logic caused C-16 and C-06.
   - Perf budget: ≤ 25 ms for a farm with 500 animals, 200 blocks and 5 years of records, covered by a perf test.
3. Run `fn`.
4. Reload inside the same transaction and project `after`.
5. If `shortenings` is not empty and there is no valid void (section 5), throw `AnimalRuleError('HOLD_WOULD_SHORTEN', 409, …)`. The transaction rolls back.

Single replica plus SQLite's single writer means there is no gap between check and write.

Coverage: every mutation under

- `/api/animals/**`: create, housing, `PATCH/DELETE /api/animals/[id]`, move, `PATCH/DELETE locations/[id]`, undo, status, health and withdrawal, production, grazing-attestations, label-use answers;
- `/api/animal-groups/**`: create, split, join, leave;
- `/api/spray/**`, `/api/insecticide/**` and `/api/fungicide/**`: record and delete;
- `/api/hay/**`, and `/api/harvest/**` on forage or grazeable blocks;
- `/api/blocks/**` and `/api/fields/**`: delete, reassign, and geometry edits that move blocks;
- plugin_overrides upload and retire;
- offline-queue replays of any of the above.

Gates around the guard:

- **Static gate:** a new lint rule `cropcard/no-unguarded-hold-write`. Its table list comes from `schema.ts`, in the same way as `no-raw-tenant-table`, and a drift test keeps it current. It forbids writes to hold-fact tables outside `guardedHoldWrite`.
- **Plugin registration check (defence in depth):** a farm plugin copy is refused with `422 PLUGIN_SHORTENS_HOLD` if it
  - lowers any withdrawal, grazing, hay or PHI field below the shared value,
  - relaxes the label class, or
  - removes a prohibited flag.

  Copy: "This farm copy would shorten a hold ({field}: {shared} → {new}). Farm copies can only keep or lengthen holds."

- **Retiring the ad-hoc checks:** `cutShortensHolds` (`areaGrazing.ts`), the "shortens" checks in `animals/[id]` and grazing-attestations, and `moveOrderRefusal` / `meatMoveOrderRefusal` all remain as defence in depth. Each gets a regression test showing the guard alone refuses the same case. The proof rests only on the guard.

### 4. Invariant I2: declarations and lifecycle order (same guard, step 1)

- **(a) Clear at the date:** a declaration's gate is evaluated at `occurredAt` against the full current record set, tombstones included, and must be clear. Existing FoodStop copy, with `resubmitAs: 'discard'`, and `askOwner` for helpers.
- **(b) Terminal events come last:** slaughter, sale for meat and death must be dated at or after the latest record of any kind that reaches the subject (dose, move, membership change, production). No record may be dated after a subject's terminal status. This generalises `animalOrder.ts`.
- **(c) No crossing a known hold start:** a declaration may not be dated before the start of a hold on its key that is already on file with a start ≤ now.
  - This is the accepted honest cost: eggs from before a treatment, entered after the treatment is on file, are refused. The record can still be saved as discard.
- Errors for (b) and (c): `OUT_OF_ORDER` 409, keeping the existing copy. For (c) the copy is: "{Product} is on record for {subject} on {date}, after the date entered. Save as discarded, or record it when it happens."
- A later record that lengthens a hold across a declaration already accepted is **never refused**. It saves and raises an owner alert, "Check this sale or slaughter: {subject}", as a /today card and a push notification.

### 5. The only way to shorten a hold: void a fresh mistake

The two proposals are merged. Judge 2's scope (the narrower one) is used with judge 1's confirmation mechanism.

- **Who:** interactive owner only. Helper tier gets 403 `OWNER_ONLY`.
- **What:** void one record within 48 h of its server-set `created_at` (the FR-09 lock, `LOCK_WINDOW_MS`). After 48 h nothing can shorten a hold. Locked and force-deleted records keep holding.
- **How:**
  1. `POST …/[id]/void {reason}` (reason required, ≤ 500 chars) returns `409 HOLD_WOULD_SHORTEN` with the diff and a `diffHash`.
  2. The client shows the diff and resubmits with `confirmShorten: diffHash`.
  3. The server recomputes. If the hash differs it returns `409 HOLD_DIFF_STALE`: "The holds changed since you looked. Review again."
- **Never:** for any hold whose `clearAt = ∞` or whose drug class is prohibited (`403 HOLD_NOT_VOIDABLE`: "Holds from a prohibited drug or unknown label can't be shortened."). Also never through Bearer or impersonation sessions.
- **Audit:** the record becomes a void tombstone that stays in exports and the hash chain. A `hold_corrections` row is written, tenant-scoped with `owner_id`, in the cross-tenant test: user, reason, the full diff and `diffHash`, and it goes into the hash chain. The affected holds show as "Owner-corrected" on the animal page, record cards and exports.
- A void is an FR-09 correction, not an override of a gate. No endpoint can ever pass a "clear" verdict past a block.

### 6. What users see when the guard refuses (`409 HOLD_WOULD_SHORTEN`)

- **Body:**
  - `holds: [{subject, subjectLabel, kind, clearBefore, clearAfter}]`
  - `coverage: [{id, label}]`
  - `diffHash`
  - `todayVersionPasses: boolean`
- **Copy for each hold:** "Saving this with that date would end {Bessie}'s {milk} hold on {Oct 3} instead of {Oct 9}." Up to 3 lines are shown, then "+N more".
- **Actions:**
  - "Save with today's date" for every role, shown when `todayVersionPasses`. That is always true for inserts, by truncation.
  - Helper tier also sees: "Or ask the owner to enter it."
  - An interactive owner, only when the target record is within 48 h of entry, sees "Void this entry…", which leads to section 5.

### 7. Schema (one migration)

- `to_recorded_at` on `animal_locations`, group memberships and lineage rows. `setStayEnd` writes it, for audit and history ("recorded {date}").
- `deleted_at` and `deleted_by` tombstones on stays, memberships, block assignments and spray records where they are missing, plus `void_reason` and `voided_at`.
- Hold-parameter snapshot columns on doses and spray applications: `hold_params_json`, SHA-256 in the hash chain.
- A `recorded_late` boolean on dated animal and forage records.
- A new `hold_corrections` table, branded with `tenantScoped(...)`, with an `owner_id` composite index, wired into `tenant.crossTenant.test.ts`.
- Bump `RULES_VERSION` from 0.6.0 to 0.7.0.

### 8. Test plan

Unit tests in `lib/safety/holdLedger.test.ts`:

- truncation at now;
- interval difference, including ∞ and a key that disappears;
- the `covered` set difference;
- max-merge of parameters;
- exhaustiveness of `FACT_EFFECT`, as both a typecheck and a runtime key check.

Property tests in `lib/safety/holdLedger.properties.test.ts`, using fast-check:

- **P1 (required: no accepted write can shorten or remove any existing hold).**
  - Generate random farm timelines: animals, flocks, groups with split, join and leave, blocks, stays, doses (including prohibited and unknown labels), sprays, plugin copies, label answers, production logs and declarations.
  - Run random write sequences over every kind in section 3 (insert, edit, delete, undo, void), with random dates in `[now − 450 d, now + 1 h]`, random roles (owner cookie, helper, Bearer, impersonation) and random offline replays.
  - Run each write through the real `guardedHoldWrite` against an in-memory SQLite database.
  - For every **accepted** write without a valid owner void: `shortenings(before, after) = ∅`. Every hold interval and every coverage id from before is still present after.
- **P2:** every accepted write dated `now` with only additive or closing effect is accepted (liveness, so the rule stays usable).
- **P3:** every accepted declaration was clear at its `occurredAt` at the moment it was accepted, and satisfies rules (b) and (c).
- **P4:** the only accepted writes with a non-empty `shortenings` are interactive-owner voids within 48 h, with a `diffHash` that matches, touching no ∞ or prohibited hold. Each has exactly one `hold_corrections` row.
- **P5:** existing kernel monotonicity (the verdict is monotone in exposure, doses and parameters). Extend `grazingInterval.properties` and the `animalWithdrawal` properties.

Regression and integration tests:

- All 56 bypasses from the four review rounds become named cases the guard must refuse.
- Every retired ad-hoc check keeps its test, now passing through the guard.
- Void path:
  - helper, Bearer and impersonation get 403;
  - a stale `diffHash` gets `HOLD_DIFF_STALE`;
  - a void after 48 h is refused;
  - ∞ and prohibited holds get `HOLD_NOT_VOIDABLE`.
- Date checks: `IN_THE_FUTURE` at 5 min + 1 ms; `BACKDATE_TOO_FAR` at each tier's boundary; offline-queue items stay pending with the right marker.
- `PLUGIN_SHORTENS_HOLD` matrix for every field.
- Cross-tenant: the guard projects only the active tenant, and `hold_corrections` does not leak.
- Lint: `no-unguarded-hold-write` flags a direct repo write in a fixture, and its drift test runs against `schema.ts`.
- Perf test for the section 3 budget.
