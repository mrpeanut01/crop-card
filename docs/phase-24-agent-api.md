# Phase 24 — External Agent API

Canonical tracker for Phase 24. Future sessions should read this first before working on anything in this scope so we don't re-derive context. Mirror format: [phase-21-plan.md](./phase-21-plan.md).

**Status (2026-05-23):** all four sub-tasks shipped on `phase-24-agent-api` branch (PR #70). Phase 22 (Plugin Manager) and Phase 23 (Standalone Plugin Marketplace) shipped first; Phase 24 ports the marketplace's proven Bearer + CSRF pattern into the main web app at `apps/web/`.

**Why this phase exists.** A backend audit (2026-05-22) confirmed all 95 endpoints under `/api/**` already form a coherent JSON API with uniform error shape, server-side safety re-validation, and tight tenant/role gates. **The blocker for external Claude-agent orchestration was not the contract — it was auth, CSRF, discoverability, and the per-user AI quota.** Phase 24 closes those four gaps.

Safety invariants stay server-enforced (48h spray lock, helper custom-rate restriction, tenant isolation via `runWithTenantAsync` + `tenantWhere`, kernel re-evaluation on POST and PATCH). An agent with a valid token cannot violate them. The worst case is bad UX, not safety violations — which is why we can open the surface without re-hardening it.

**Target persona.** [P6](./personas.md) — Integrator / automation owner. Either the farm owner running a personal Claude agent against their own data, or a future SaaS integration (FarmOS sync, accounting bridge, scouting drone uploads).

**New UC.** [UC-43](./use-cases.md#uc-43--external-agent-orchestration-via-api-token) — External agent orchestration via API token.

**Explicitly deferred** (per epic #59 and confirmed during plan approval):
- Token sub-scopes (read-only / spray-only). Today every token has its role's full permissions within the issuing Owner.
- OAuth `client_credentials` for 3rd-party SaaS.
- Webhooks / push delivery.
- Streaming (SSE/WebSocket) on AI refine endpoints.
- MCP server wrapper — strong fit for P6 but cleanly downstream of Sub-task C.

**Phase 23 leverage.** The marketplace at [`apps/marketplace/`](../apps/marketplace/) de-risked every gnarly decision: token format (`ccm_…`), constant-time hash compare, debounced `lastUsedAt`, JSON 401 shape, CSRF Origin bypass mechanics. Sub-tasks A and B lifted that pattern almost verbatim, only rebadging `ccm_` → `cck_` and adding owner scoping. Effort dropped from the epic's original 3.75 days to ~2.75 actual days.

---

## Sub-task A — API token auth (#55)

**Status:** ✓ shipped, commit `c7ab58a`.
**Persona:** P6.
**Ships:** owner-scoped Bearer credentials for external agents. Mint cookie-only; revoke under either auth method.

### What changed

- New table `api_tokens` (migration `0029_phase24_api_tokens.sql`). Columns: `id`, `owner_id` FK, `user_id` FK, `label`, `token_hash` (SHA-256 hex, UNIQUE INDEX), `is_service_account` boolean, `daily_quota_*` (nullable; Sub-task D wires these), `created_at`, `last_used_at`, `request_count`, `revoked_at`. Same migration adds nullable `token_id` to `ai_call_log` for Sub-task D.
- [`apps/web/src/lib/server/apiTokens.ts`](../apps/web/src/lib/server/apiTokens.ts) — modeled on [`invites.ts`](../apps/web/src/lib/server/invites.ts) + [`appCreds.ts`](../apps/marketplace/src/lib/server/appCreds.ts). Functions: `generatePlaintext` (`cck_<base64url-32>`), `issueToken` (owner-scoped), `lookupByPlaintext` (cross-tenant, constant-time, `unscopedQueryNote`'d), `touchToken` (debounced 60s, accumulates request_count deltas in memory), `revokeToken` (composite owner-scoped), `listTokensForOwner`.
- `POST/GET /api/auth/token` + `DELETE /api/auth/token/{id}`. Mint is cookie-only — closes the bootstrap loop on a leaked agent token.
- `/settings/api-tokens` UI mirroring `/settings/helpers` with copy-once modal on mint.
- `hooks.server.ts` resolves `Authorization: Bearer cck_…` **before** cookie lookup. On hit: builds an `AuthenticatedUser` shaped record from the token's `(ownerId, userId, role)` via `buildBearerUser()` reading `users` + `helper_assignments`; on miss: 401 JSON. `event.locals` gains `authVia` / `tokenId` / `isServiceAccountToken`.
- `/api/session/switch-owner` returns 403 for `authVia === 'bearer'` — tokens are owner-scoped at issuance.
- Cross-tenant property test extended: a token issued for Owner A resolves to `ownerId=A`; reads scoped via `runWithTenant(A, ...)` never see Owner B's rows. 50-iteration "fake plaintext never resolves" probe also included.
- [UC-43](./use-cases.md#uc-43--external-agent-orchestration-via-api-token) authored; [P6 persona](./personas.md#p6--integrator--automation-owner-proposed-phase-24) added.

---

## Sub-task B — CSRF / Origin bridge (#56)

**Status:** ✓ shipped, commit `fdd938a`.
**Persona:** P6.
**Ships:** `kit.csrf.checkOrigin: false` in `svelte.config.js` + targeted guard in `hooks.server.ts` so Bearer agents call from arbitrary origins while cookie sessions stay strictly same-origin.

### Policy (pure helper `csrfDecision()` exported for tests)

- Mutation under `/api/**` with Bearer auth → **allow** (agents call from arbitrary origins by design).
- Mutation under a non-`/api/**` path → enforce same-origin **even when** Bearer is set. Form-actions belong to the cookie-session UI and should never accept cross-origin POSTs.
- Cookie-authed mutations under `/api/**` → enforce same-origin when an Origin header is present.
- Mutations with no Origin header → allow. Origin is browser-only; curl / server-to-server lacks it by definition.

Failures return JSON 403 / 400 (not opaque HTML) so API clients see a structured response.

### Tests (six-scenario matrix + edges)

1. Cookie POST under `/api/**` + matching Origin → allow
2. Cookie POST under `/api/**` + foreign Origin → block
3. Cookie POST under `/api/**` + no Origin → allow (curl)
4. Bearer POST under `/api/**` + foreign Origin → allow
5. Bearer POST under `/api/**` + no Origin → allow
6. Form-action `/settings/**` + foreign Origin + Bearer attached → block

Plus: non-mutation methods always allow, malformed Origin → 400 not 403, port-aware host matching, PUT/PATCH/DELETE follow the same policy as POST, undefined `authVia` defaults to the strict cookie policy.

---

## Sub-task C — OpenAPI 3.1 schema (#57)

**Status:** ✓ shipped, commit `e5eb87e`.
**Persona:** P6.
**Ships:** generated `apps/web/static/openapi.json` + public `GET /api/openapi.json` so external agents self-discover the surface without parsing TypeScript.

### What's in v1

Hand-curated registry in [`apps/web/scripts/gen-openapi.mjs`](../apps/web/scripts/gen-openapi.mjs) covers the Phase 24 ship-list endpoints:

- `GET /api/health` (public, returns RULES_VERSION)
- `GET /api/openapi.json` (public, self-reference)
- `POST /api/auth/token` (cookie-only mint), `GET /api/auth/token`
- `DELETE /api/auth/token/{id}` (revoke)
- `POST /api/spray/record` (safety-kernel re-validated)
- `GET /api/blocks`

Both `bearerAuth` and `cookieSession` security schemes declared at the document level. Endpoints can locally override (e.g., `security: []` for public, `security: [{ cookieSession: [] }]` for cookie-only mints).

### Adoption path for the remaining ~85 endpoints

Each route's request schema lives inline today (verified during plan-phase exploration). Adopting an endpoint means:
1. Promote `const requestSchema = z.object(...)` to `export const requestSchema = ...`
2. Append a `paths['/api/...']` block to `gen-openapi.mjs` referencing the schema
3. Run `pnpm gen:openapi` and commit the updated artifact

Domain-batched (auth → plan → spray → fields → plugins → ai) so reviewer load stays bounded. Tracked as a Phase 24 follow-up; **not blocking** further Phase 24 work because each batch ships independently.

### CI drift check

`.github/workflows/ci.yml` runs `pnpm gen:openapi && git diff --exit-code apps/web/static/openapi.json` on every PR. Drift fails the build.

### Tests

`tests/integration/openapi-served.test.ts` — 9 assertions over OpenAPI 3.1 conformance, security-scheme shape, public vs. authed path policy, the served endpoint's MIME + cache headers, and the cck_ token format pattern.

---

## Sub-task D — Service-account quota (#58)

**Status:** ✓ shipped, commit `85222bf`.
**Persona:** P6.
**Ships:** per-`(tokenId, endpoint, UTC-day)` rate-limit branching in [`aiGuard.ts`](../apps/web/src/lib/server/aiGuard.ts) so a runaway scouting drone can't drain the human owner's daily AI quota.

### Policy

- Cookie sessions + personal-use Bearer tokens (`isServiceAccount=false`): per-(userId, endpoint, UTC-day) — the historical behavior. No quota arbitrage for non-service-account tokens.
- Service-account Bearer tokens (`isServiceAccount=true`): per-(tokenId, endpoint, UTC-day). Per-token daily quota override read from `api_tokens.daily_quota_*` columns via `TOKEN_QUOTA_COLUMN` map; falls back to the per-user default when no override is set.
- **Monthly USD cap stays GLOBAL** across all auth paths — the safety brake against a runaway agent. Never per-token.

### Column → endpoint mapping (MVP)

The migration 0029 columns map to AI endpoints as:

| Column | AI endpoint | Used by |
|---|---|---|
| `daily_quota_allocate` | `allocate` | `/api/plan/allocate` |
| `daily_quota_schedule` | `plugin-search` | `/api/plugins/search-by-name` |
| `daily_quota_inputs` | `inputs` | `/api/plan/inputs/*` |
| `daily_quota_stock_refresh` | `rationale` | `/api/plan/refresh-stock` |

Endpoints not in this map use the per-user default for service-account tokens. A follow-up may widen to a JSON column for full per-endpoint coverage; current MVP covers the four endpoints an agent is most likely to spam.

### What's NOT done yet

Callers of `checkGuard()` across `/api/plan/**` and `/api/plugins/**` aren't yet passing `event.locals.tokenId + isServiceAccountToken` through. The new arg is optional, so the existing per-user behavior is preserved. Promoting each call site is small and mechanical — tracked as a follow-up in this doc.

### Tests

`aiGuard.serviceAccount.test.ts` (6 tests):
- runaway service account does NOT drain the user's quota
- per-token `daily_quota_*` override is honored
- personal-use Bearer (`isServiceAccount=false`) shares user quota (no arbitrage)
- cookie sessions unaffected (no regression)
- `recordCall` stamps `tokenId`; next `checkGuard` sees it under per-token keying
- global monthly USD cap blocks a service-account token just like a cookie session

---

## Follow-ups not blocking Phase 24

1. **Promote `checkGuard()` callers** to pass `event.locals.tokenId + isServiceAccountToken` so service-account quota actually engages on existing endpoints. Currently ~7 callers across `/api/plan/**`, `/api/plugins/scan-*/**`, `/api/plugins/search-by-name/**`. Domain-batched.
2. **Promote inline route request schemas** to `export const requestSchema = z.object(...)` and add to `gen-openapi.mjs`. ~85 endpoints. Domain-batched (auth → plan → spray → fields → plugins → ai).
3. **`/api/plan/spend`** response should include a `tokenQuota` block when Bearer-authed so agents can self-throttle. Small addition; was scoped into Sub-task D but punted to keep the PR focused.
4. **Token sub-scopes** (read-only / spray-only). Real defense-in-depth for SaaS integrations. Requires per-route scope-required metadata + a new `requireScope()` helper. Out of scope for Phase 24 v1.

---

## Test counts

| Sub-task | New tests | Total after |
|---|---|---|
| baseline | — | 719 |
| A (api token) | +11 apiTokens + 2 cross-tenant extension | 732 |
| B (CSRF) | +12 csrf-bridge | 744 |
| C (OpenAPI) | +9 openapi-served | 753 |
| D (service-account) | +6 service-account | 759 |

All 759 tests pass on the `phase-24-agent-api` branch.

---

## End-state verification

```sh
# 1. Mint a token: /settings/api-tokens → "Mint" → copy plaintext once.
# 2. External script with the token:
curl -H "Authorization: Bearer cck_…" https://app/api/health           # → 200 (public)
curl https://app/api/openapi.json                                       # → 200 (public; OpenAPI 3.1)
curl -H "Authorization: Bearer cck_…" -X POST https://app/api/spray/record \
    -H "Origin: https://my-agent.example" \                             # foreign origin
    -d '{...}'                                                          # → 200 (kernel re-evaluates server-side)
curl -H "Authorization: Bearer cck_A" https://app/api/blocks            # → only Owner A's blocks
curl -H "Authorization: Bearer cck_A" -X POST https://app/api/session/switch-owner \
    -d '{"ownerId":"some-other-owner"}'                                 # → 403 (tokens are owner-scoped)
```

Cross-tenant invariant holds: token issued for Owner A used against any list/get endpoint returns only Owner A's data regardless of filter combination. Verified by the extended property test at `tenant.crossTenant.test.ts`.
