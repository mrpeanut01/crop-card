# Re-verify — Marketplace standalone app (epic #231) — 2026-09-25

**Source audit:** the epic links `docs/clickthrough-reports/marketplace-app-2026-05-25.md`, but
**that file is not in the repo**, so the link is dead. This pass works from the epic body.
**Method:** code review of `apps/marketplace` plus a drive of the main app's `/plugins/community`
(production build, port 5318). The marketplace app has no test suite (`vitest run` finds no
files).

| Finding | Issue | Status | Evidence |
|---|---|---|---|
| CT-MP-001 `/admin/verify/[token]` 500 on DB unavailable | #232 (closed) | **Fixed (code-verified)** | `routes/admin/verify/[token]/+page.server.ts` wraps `redeemLoginToken()` in try/catch and returns `error(400, …)`. |
| CT-MP-002 Bearer `ccm_` 500 on DB unavailable (info leak) | #233 (closed) | **Fixed (code-verified)** | `hooks.server.ts` catches credential-lookup errors and returns 401 `invalid or revoked Bearer token`. `touchCredential` is best-effort inside try/catch. |
| CT-MP-003 main-app "Browse marketplace" goes to a static stub | #234 (**open**; fix on branch in `75b5560`) | **Fixed** | `/plugins/community` now says plainly that the marketplace service is not connected. It offers actions that work: upload plugin JSON (`/plugins`), the author wizard (`/plugins/new`), and the installed catalog (`/inventory?type=crop&mode=catalog`). Live marketplace integration (B-31) is future feature work, not a defect. |
| CT-MP-004 env vars missing from `.env.dev.example` | #235 (closed) | **Fixed** | `infra/.env.dev.example` defines `MARKETPLACE_ADMIN_EMAILS`, `MARKETPLACE_SEED_CREDENTIAL`, `MARKETPLACE_MODE`. |

**Follow-ups (not defects in this epic):**
- #232 and #233 have no regression tests, and the marketplace has no vitest setup. Suggested
  follow-up: extract the Bearer branch of `hooks.server.ts` into a pure `resolveBearer(header, lookup)`
  and unit-test the throw → 401 path. Also test the verify loader with a throwing
  `redeemLoginToken` mock. Size is about 80 LOC plus vitest config.
- The source report file is missing. Either restore it or remove the link from the epic.
- The epic's "NOT verified" list (admin surfaces, upload + ClamAV, trust-tier moderation,
  `import-catalog.ts`) is no longer blocked by #235, but nobody has walked it. It is scope for when the
  marketplace design lands.

**Verdict:** ready to close once `75b5560` (#234) merges.
