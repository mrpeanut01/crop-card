# Clickthrough — Cross-role Authorization Matrix (Invariants 5 & 8)

- **Date:** 2026-07-04
- **Agent:** lifecycle role-matrix playtest (HTTP curl + source reads; browser tools unavailable)
- **Server:** http://localhost:5283 (seeded test DB)
- **Scope:** role × surface access matrix; UC-21 (helper/inspector invite) + UC-22 (inspector read-only persona); superadmin impersonation; helper privilege-escalation guards.
- **Companion report cited (not re-run):** `scratchpad/playtest/api-authz.md` — Bearer mutation path dead (P1), helper mutation holes on decon / fertility / harvest / block-geometry (P1), inspector coverage gap (I1).

## Headline verdicts

1. **UC-22 inspector IS reachable** — via the real invite flow (not the demo/seed path). This **closes gap I1** from the api-authz report: a live inspector session was minted and its read-only gate exercised end-to-end.
2. **Inspector read-only is enforced globally at the hooks layer**, not per-endpoint — so even the un-guarded endpoints (harvest/record, fertility/*, decon, block-geometry) correctly 403 an inspector. The helper holes from api-authz are helper-vs-owner only; inspector is safe by the global backstop.
3. **No privilege-escalation vector found** for helper (settings/helpers is owner-gated; switch-owner re-derives role from the DB, ignoring client-supplied role).
4. **Superadmin impersonation start/exit round-trips cleanly server-side** — the `impersonating` flag is set and cleared correctly. #221 "stuck banner" is confirmed **client-only**.

---

## CT-ROLE-001 — Inspector persona reachable ONLY via real invite flow (UC-21 + UC-22)

**Setup / mechanism (source):**
- `apps/web/src/lib/server/auth.ts` `loginByEmail()` **ignores the requested `desiredRole`** once the user has `helper_assignments`; session `activeRole` is derived from `helper_assignments.role_within_owner`. When a user has **zero** assignments it mints an **owner-role partial session** (`activeRole:'owner'`, `activeOwnerId:null`) → `/onboarding`.
- The seed (`apps/web/scripts/seed-test-data.mjs`) creates only `owner@`, `helper@`, `superadmin@` — **no inspector user and no `role='inspector'` assignment** (line ~109: "No helper_assignments row by design" is for superadmin; inspector isn't seeded at all).
- `?/demo role=inspector` therefore logs in `inspector@cropcard.local` (fresh user, no assignment) → **owner partial session**. Verified live: cookie decoded to `{activeRole:"owner", activeOwnerId:null}`. **This is exactly the I1 dead-end.**

**Resolution (the correct path):** the invite schema DOES support `inspector`.
- `apps/web/src/lib/server/invites.ts` `InviteRoleWithinOwner = 'helper' | 'inspector' | 'custom-operator'`; `/api/invites` POST accepts `role ∈ {helper,inspector,custom-operator}`.
- `/invite/[token]/+page.server.ts` `accept` action calls `addAssignment({roleWithinOwner: match.roleWithinOwner})` then re-mints the session with `activeRole: match.roleWithinOwner`.

**Steps executed (all HTTP 200):**
1. Owner `POST /api/invites {email:"inspector-test@cropcard.local", role:"inspector"}` → `{ok:true, acceptUrl:.../invite/<token>}`.
2. Sign in as `inspector-test@cropcard.local` (fresh user) via `?/signin` → partial owner session (expected).
3. `GET /invite/<token>` → load returns `status:"ready", roleWithinOwner:"inspector", ownerName:"CropCard Test Farm"`. Page renders "You've been invited to act as an **inspector**".
4. `POST /invite/<token>?/accept` → **session re-minted to `{activeRole:"inspector", activeOwnerId:"1bd75e19-…"}`** (same tenant as owner/helper).

**Finding (P2, coverage):** UC-22 is **reachable but not seedable** — the inspector persona cannot be reached through `?/demo` or any seed fixture; it requires a 4-step live invite ceremony. Recommend the api-authz suggestion: seed an `inspector@` user + `helper_assignments(role='inspector')` row so the read-only gate is testable in one login. (Owner-scoped; not a security hole.)

---

## CT-ROLE-002 — Role × surface GET matrix

`curl -o /dev/null -w %{http_code}` per role. Cookies: owner/helper via `?/demo`; inspector via CT-ROLE-001; superadmin via `?/signin superadmin@cropcard.local`.

| Route | owner | helper | inspector | superadmin | Notes |
|---|---|---|---|---|---|
| `/today` | 200 | 200 | 200 | 303 | superadmin has no active tenant → 303 → `/admin/owners` |
| `/plan` | 200 | 200 | 200 | 303 | |
| `/spray` | 200 | 200 | 200 | 303 | |
| `/scout` | 200 | 200 | 200 | 303 | |
| `/harvest` | 200 | 200 | 200 | 303 | |
| `/hay` | 200 | 200 | 200 | 303 | |
| `/fertility` | 200 | 200 | 200 | 303 | |
| `/inventory` | 200 | 200 | 200 | 303 | Inv 8: helper+inspector read every inventory view by design |
| `/equipment` | 200 | 200 | 200 | 303 | read-allowed (mutations gate at API) |
| `/records` | 200 | 200 | 200 | 303 | |
| `/records/pending` | 200 | 200 | 200 | 303 | |
| `/settings` | 200 | 200 | 200 | 303 | |
| `/admin/owners` | **403** | **403** | **403** | **200** | superadmin-only; `403 superadmin required` |

**Verdict:** clean. All page GETs are 200 for owner/helper/inspector (Invariant 8 — viewing is helper/inspector-visible; mutations gate at the API layer). `/admin/owners` correctly 403s all non-superadmin roles. Superadmin has no active tenant, so every tenant route 303-redirects to `/admin/owners` (correct — no data leak, no partial render).

---

## CT-ROLE-003 — Inspector mutation gate is GLOBAL (hooks-level), closes I1

**Mechanism (source — `apps/web/src/hooks.server.ts:255-261`):**
```
if (user && !canMutate(user.role) && MUTATION_METHODS.has(method) && path.startsWith('/api/'))
  return json({ error: 'inspector role is read-only' }, { status: 403 });
```
This is a **backstop that fires before any endpoint handler**, so it catches endpoints that have no local guard.

**Live probes with the inspector cookie (POST, Origin set):**

| Endpoint | inspector | helper | owner |
|---|---|---|---|
| `POST /api/spray/record` | **403** | 400* | 400* |
| `POST /api/harvest/record` | **403** | 400* | 400* |
| `POST /api/fungicide/record` | **403** | 400* | 400* |
| `POST /api/fertility/soil-tests` | **403** | (past authz)† | (past authz)† |
| `POST /api/scout/record` | **403** | 400* | 400* |
| `POST /api/invites` | **403** | 403 | 200 |

`*400 = schema validation on throwaway payload → auth already passed (the endpoint would mutate with a valid body). †per api-authz: 500 FK / past-authz.`

**Finding (positive):** **inspector = 403 on every `/api/*` mutation**, including the four un-guarded endpoints api-authz flagged (`harvest/record`, `fertility/*`, `sprayers/[id]/decon`, `blocks/[id]/geometry` — grep confirms `<NO-GUARD>` in-handler). The global hooks gate saves them. **I1 is now verified end-to-end against a live inspector session — the read-only invariant holds.**

**Cross-reference (helper holes — cited from api-authz, NOT re-run):** the same four endpoints have NO helper/owner distinction in-handler, so a **helper** reaches the write path (api-authz confirmed a real successful `decon` write and past-authz reaches on the rest). Those are P1 **helper-vs-owner** holes and remain open. Inspector is unaffected because of the global gate; helper is not gated by it (`canMutate('helper') === true`).

---

## CT-ROLE-004 — Superadmin impersonation round-trip (re #221)

**Live sequence (`superadmin@` cookie):**
1. `GET /admin/owners` → 200, lists tenant **"CropCard Test Farm"** with Impersonate + Billing (trial/active/…/suspended) controls. Cross-tenant list confirmed.
2. `POST /admin/owners?/impersonate {ownerId:1bd75e19-…}` → session re-minted `{isSuperadmin:true, activeOwnerId:"1bd75e19-…", activeRole:"owner", impersonating:true}`. `/today` now **200** (borrowed tenant).
3. `POST /admin/owners?/exitImpersonation` → session `{isSuperadmin:true, activeOwnerId:null, activeRole:"owner", impersonating:false}`.

**Verdict:** start/exit **round-trip cleanly server-side**; `impersonating` is set true on enter and **false on exit**, `activeOwnerId` cleared. Every mutation writes a `superadmin_audit` row (`admin/owners/+page.server.ts:40,70`). **#221 "stuck banner" is confirmed client-only** — the server cookie is correct after exit, so the persistent banner is a client-state/reload issue, not a session-authz bug.

---

## CT-ROLE-005 — Helper privilege-escalation guards (no vector found)

| Attack | Result | Guard |
|---|---|---|
| Helper `POST /settings/helpers?/invite {role:owner}` | **403** | `requireOwner` (`settings/helpers/+page.server.ts:43`) |
| Helper `POST /api/invites {role:owner}` | **403** | `requireOwner` (`api/invites/+server.ts`) |
| Helper `POST /api/session/switch-owner {ownerId, activeRole:"owner", role:"owner"}` | **200 but `activeRole:"helper"`** | endpoint re-derives `activeRole` from `activeAssignmentsForUser` DB match; ignores body role (`switch-owner/+server.ts:38`) |

Post-attack the helper cookie still decoded `activeRole=helper`. **No escalation path.** switch-owner also 403s a forged `ownerId` with no assignment (api-authz A19). Bearer sessions can't switch owners at all (dead-code note in api-authz — the `currentUser` 401 fires before the intended `authVia==='bearer'` 403).

---

## Summary of findings

| ID | Sev | Finding |
|---|---|---|
| CT-ROLE-001 | P2 | Inspector persona reachable via live invite only; not seedable / not reachable via `?/demo` (`role=inspector` → owner partial session). Recommend seeding an inspector assignment. |
| CT-ROLE-003 | — (positive) | Inspector read-only enforced globally at `hooks.server.ts:255-261`; **I1 from api-authz now verified** — 403 on all `/api/*` mutations incl. un-guarded endpoints. |
| CT-ROLE-004 | — (positive) | Impersonation server-side is correct; **#221 stuck banner is client-only.** |
| CT-ROLE-005 | — (positive) | No helper privilege-escalation vector. |
| (cited) | P1 | api-authz: helper mutation holes on decon / fertility / harvest / block-geometry (helper-vs-owner, NOT inspector). |
| (cited) | P1 | api-authz: Bearer mutation path dead (`currentUser` reads cookie only, ignores `event.locals.user`). |

**Matrix verdict:** page-read authz is correct across all four roles (Invariant 8 read-everywhere for helper/inspector holds; `/admin/owners` superadmin-only holds). Inspector write-lockdown (Invariant 5-adjacent read-only) is **globally sound**. The open P1s are the pre-existing helper-vs-owner mutation holes and the dead Bearer path — both already filed by the api-authz agent; neither is an inspector read-leak or a privilege-escalation.
