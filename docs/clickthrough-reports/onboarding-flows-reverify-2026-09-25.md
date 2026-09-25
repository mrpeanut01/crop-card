# Re-verify — Onboarding end-to-end flows (epic #188) — 2026-09-25

**Source audit:** `onboarding-flows-phase-25-verification-2026-05-25.md`
**Setup:** production build (`pnpm build` + `node build/index.js`, port 5318) on a throwaway
SQLite file, migrated and seeded with `scripts/seed-test-data.mjs`. A Playwright script signed in
through the landing form (`POST /?/signin`) as a brand-new email, created a farm on
`/onboarding`, then opened `/today`. Seeded `inspector@`, `superadmin@` and `helper@` fixtures
were signed in the same way.

| Finding | Issue | Status | Evidence |
|---|---|---|---|
| F-01 bootstrap "Get started" card hidden in collapsed `<details>` | #189 (closed) | **Fixed** | Fresh owner on `/today`: "Get started" is visible and `closest('details:not([open])')` is null. |
| F-02 calibrate step auto-completes through the GPA=15 default | #190 (closed) | **Fixed** | `today/+page.server.ts` `hasCalibration` requires `calibratedGpa != null && > 0`. The step shows "3 Calibrate the sprayer" (not done) for a new farm. `/api/spray/record` passes `calibratedGpa ?? undefined`, and `/spray` shows an "uncalibrated" hint instead of 15 GPA. |
| F-03 no superadmin seeded | #191 (closed) | **Fixed** | `superadmin@cropcard.local` lands on `/admin/owners`. The seed also has an inspector (`inspector@` goes to `/today`). |
| Flow 10 superadmin onboarding (previously blocked) | — | **Fixed** | Same as F-03. |

**Verdict:** every finding is fixed. Ready to close.
