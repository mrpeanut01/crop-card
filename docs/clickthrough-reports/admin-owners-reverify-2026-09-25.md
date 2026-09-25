# /admin/owners + impersonation — re-verification (2026-09-25)

Re-check of epic #220 (children #221–#225) against `main` @ `40d3d4c`.
Original audit: [`admin-owners-flows-2026-05-25.md`](admin-owners-flows-2026-05-25.md).

**Setup:** `pnpm build`, `scripts/migrate.mjs` + `scripts/seed-test-data.mjs` against a
throwaway SQLite file, `node build/index.js` on port 5302. A Playwright script signed
in through the real landing form (`POST /?/signin`) as the seeded
`superadmin@cropcard.local` (`user_superadmin`, no helper assignments) and as
`owner@cropcard.local`. The script decoded the session cookie payload and read
`superadmin_audit` directly.

## Results

| Issue | Status | Evidence |
|-------|--------|----------|
| #221 exit impersonation (P0) | **Fixed; could not reproduce** | Exit is a `<form method="POST" action="/admin/owners?/exitImpersonation" use:enhance>` with a `<button>` (`src/routes/+layout.svelte`). Clicking it sent `POST …?/exitImpersonation`. The cookie went from `impersonating:true, activeOwnerId:<target>` to `impersonating:false, activeOwnerId:null`, and an `exit_impersonation` audit row was written. The banner was gone, including after a hard reload. A `GET ?/exitImpersonation` changed nothing. A cross-origin POST (`Origin: https://evil.example`) got a 403. |
| #222 superadmin with no assignments | **Fixed** | After sign-in the user lands on `/admin/owners`, not `/onboarding` (`LoginResult.next='admin'`; `allowsPartialSession`/`pickRedirectForPartialSession` in `hooks.server.ts`). |
| #223 banner shows "this Owner" | **Fixed** | The banner reads "Impersonating **CropCard Test Farm** as superadmin". `+layout.server.ts` looks up the target Owner directly when the superadmin has no assignment for it. |
| #224 suspended tenant locked out of billing | **Fixed** | After a superadmin set the tenant to `suspended` from the UI, the owner's sign-in and `/today` both go to `/suspended`, while `/settings/billing` returns 200. |
| #225 no search/filter | **Fixed** | The search input and billing-status select filter the rows on the client: 1 row, then 0 for a non-matching query, 1 for "test", and 0 for `status=suspended`. |

## Hardening in this pass

- **Exit audit row now records which tenant was exited.** The row's payload is
  `{"from":"<ownerId>"}`; before this it was `null`. The row is written only
  when the session was actually impersonating, so a stray POST no longer adds a
  meaningless row.
- **`requireSuperadmin` refuses Bearer auth.** An API token minted by a user
  with `is_superadmin=1` used to pass `requireSuperadmin`, so it could drive
  `/admin/owners?/impersonate` and `?/setBilling` without an interactive
  session. API tokens are owner-scoped by design (UC-43), so superadmin actions
  now require a cookie session.
- Tests: `src/routes/admin/owners/exitImpersonation.test.ts` has 6 cases. It
  covers session reverted plus audit row, the no-assignment partial session, no
  audit row when not impersonating, 403 for a non-superadmin, 401 for an
  unauthenticated request, and 403 for a Bearer superadmin.

## Open observations (not fixed here)

- A suspended tenant's `POST /api/**` gets a `303 → /suspended` HTML redirect
  instead of a JSON 402. Browser flows are fine, but Bearer agents see a
  redirect. The fix belongs in `hooks.server.ts`: return
  `json({error:'owner suspended'}, {status: 402})` when the path starts with
  `/api/`.
- One unrelated 404 subresource on `/today`, likely an icon. No functional
  impact.
