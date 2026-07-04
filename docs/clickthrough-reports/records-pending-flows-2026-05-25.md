# Clickthrough report — /records/pending offline queue audit — 2026-05-25

**Tester:** playwright-clickthrough subagent
**Build:** ca8cb96
**Seed:** apps/web/scripts/seed-test-data.mjs (dev server at :5173)
**Viewport:** default desktop (Playwright default)
**Auth:** owner role via `/?/demo` form action → Home Farm selected from owner-picker

---

## Summary

- Surfaces walked: 7 (route render, empty state, seeded queue, drain attempt, discard, cross-tenant list, banner link)
- Pass: 4 | Fail: 3 (findings below) | Blocked: 0
- New findings: P0=0, P1=1, P2=2

---

## What was tested

### 1. Route renders — PASS

`/records/pending` renders without error boundary or 4xx/5xx. The page correctly imports
syncQueue via dynamic `import()` inside `onMount`, gracefully falling back to
`dexieAvailable = false` if IndexedDB is unavailable. Console errors were all font-CDN
404s (Google Fonts unreachable in the test environment — not app errors).

**Empty state:** "Queue is empty." paragraph rendered. "Sync now (0)" button correctly
disabled. "All records →" link to `/records` present. Screenshot:
`./screenshots/2026-05-25-pending-empty.png`

### 2. Seeded queue — PASS

Inserted a test row via `db().pendingSprayRecords.put(...)` from the browser console.
After navigation refresh, the page displayed the pending row with:
- Occurred-at timestamp (`<strong>`)
- Queued time meta (`queued HH:MM:SS`)
- Attempt count badge (`0 attempts`)
- Discard button
- Expandable Payload `<details>` block

"Sync now (1)" button became enabled. Layout banner showed "1 pending record queued."
with `role="status"`. TopBar `OfflineIndicator` showed "Syncing · 1".

Screenshot: `./screenshots/2026-05-25-pending-with-record.png`

### 3. Manual drain (Sync now) — PASS (server rejection correctly handled)

Clicking "Sync now (1)" triggered `drainQueue()`. The fake payload was rejected by
the server with HTTP 400 (missing required fields: `blockCrops`, `productPluginIds`,
`sprayer`, `conditions`). The page correctly:
- Incremented attempt count to 2
- Displayed the error message in the `.err` element below the row header
- Showed result text "Synced 0; 1 still pending."

This is correct behavior — the server re-runs the kernel and rejects invalid payloads.

Screenshot: `./screenshots/2026-05-25-pending-after-drain-attempt.png`

### 4. Discard affordance — PASS

Clicking "Discard" (with `window.confirm` intercepted to return `true`) deleted the row
from Dexie. The page refreshed to empty state, the layout banner cleared, TopBar returned
to "Online · synced".

---

## Findings

### CT-001 — /records/pending list shows cross-tenant (other owner) records [P1]

- **Route:** `apps/web/src/routes/records/pending/+page.svelte`
- **Expected (per Phase 18h spec):** The pending queue page should show only records
  belonging to the active owner. Phase 18h spec states `drainQueue` filters to active
  owner so "a helper switching tenants can't accidentally submit Farm A's offline
  records against Farm B's session." The same isolation should apply to the *display*.
- **Observed:** The page calls `listPending()` from `syncQueue.ts`, which does
  `db().pendingSprayRecords.orderBy('createdAt').toArray()` — no owner filter. When
  two records were seeded (one with `ownerId = 'owner_home_farm'`, one with
  `ownerId = 'other-owner-fake-id'`), both appeared in the list with no farm label
  distinguishing them. The "Sync now" button label showed "(2)" and drain correctly
  skipped the foreign record, but the UI exposed its existence (timestamp, queued time,
  0 attempts, Discard button) to the active-owner user.
- **Risk:** Low data-sensitivity — the IndexedDB is local to the browser, so no
  server-side cross-tenant leak occurs. However a shared-device scenario (farm helper
  using a shared tablet) could expose a different owner's queued record metadata.
  The Discard button is interactive, allowing permanent deletion of another owner's
  queued record without navigating to their tenant first.
- **Console:** No errors beyond font 404s.
- **Network:** Only the expected 400 from the fake active-owner drain attempt.
- **Screenshot:** `./screenshots/2026-05-25-pending-cross-tenant.png`
- **Recommendation:** Replace `listPending()` call in the page with a filtered variant,
  or add a `listPendingForOwner(ownerId)` helper that calls
  `db().pendingSprayRecords.where('ownerId').equals(ownerId).toArray()`. The existing
  `pendingCountForActiveOwner()` helper shows the right pattern. Any other-owner rows
  that exist should be listed separately with a "From another farm — will sync when
  you switch back" section, not mixed into the primary action list.
- **Cross-ref:** Relates to Phase 18h design goal of surfacing `skippedOtherOwner`.

### CT-002 — Layout pending banner is not clickable / not linked to /records/pending [P2]

- **Route:** `apps/web/src/routes/+layout.svelte` lines 85–88
- **Expected:** The "N pending records queued." banner should provide a direct path to
  the `/records/pending` queue management page. This is the only affordance visible
  app-wide when records are queued — the user needs to be able to act on it.
- **Observed:** The `<Banner tone="wheat">` renders plain text with no link or action
  snippet. The `Banner` component supports an `action` snippet slot, but it is not
  used here. There is no navigation path from the banner to `/records/pending`.
  The user must know to navigate to Records → then guess at `/records/pending` (which
  itself has no link in the main nav).
- **Console:** None.
- **Network:** None.
- **Recommendation:** Wrap the banner text in an `<a href="/records/pending">` or
  use the `action` snippet:
  ```svelte
  {#snippet action()}
    <a href="/records/pending">Review queue</a>
  {/snippet}
  ```

### CT-003 — Drain result message has no aria-live; screen reader users miss sync outcome [P2]

- **Route:** `apps/web/src/routes/records/pending/+page.svelte` line 62
- **Expected:** After clicking "Sync now", the result message ("Synced 0; 1 still
  pending.") should be announced to screen readers via `role="status"` or
  `aria-live="polite"`.
- **Observed:** The `.result` paragraph has no `role`, no `aria-live` attribute.
  The element is only visible; a keyboard/screen-reader user who activates "Sync now"
  receives no accessible feedback that the operation completed.
- **Console:** None.
- **Network:** None.
- **Recommendation:** Add `aria-live="polite"` (or `role="status"`) to the result
  paragraph. Since the element conditionally appears via `{#if lastDrainResult}`, also
  ensure it exists in the DOM before content is injected — use a persistent
  `aria-live` region that is always mounted:
  ```svelte
  <p class="result" aria-live="polite" role="status">
    {lastDrainResult ?? ''}
  </p>
  ```

---

## Surfaces NOT tested (and why)

| Surface | Reason not tested |
|---------|------------------|
| Online → offline → online transition | Service Worker disabled in dev (Workbox dev mode intentionally skips precaching and offline interception). Submitting a spray form while "offline" in DevTools Network throttle does not queue — the form POST fails with a network error because SvelteKit server actions do not go through the SW in dev mode. A real PWA build with `pnpm build` + `npx serve` would be needed. |
| watchOnline auto-drain on reconnect | Same SW/dev-mode limitation. Simulated offline via DevTools does not trigger the `online` event reliably in Playwright without explicit `browser.setOffline(false)` cycling. The `watchOnline()` code path was confirmed by code review to be correct. |
| Audit-trail: queued-at vs synced-at distinction in /records | The fake payload was always rejected (invalid spray), so no successful drain-to-server→appears-in-records flow was observable. Code review of `insertSprayEvent` shows only `occurredAt` is persisted — there is no `syncedAt` or `queuedAt` timestamp stored server-side. This is a known trade-off for the single-farm scope. |
| Owner-switch mid-drain | The `drainQueue` correctly filters; confirmed by `skippedOtherOwner = 1` returned when other-owner record was present. UI switch tested through owner-picker; no new findings. |
| Conflict resolution (last-write-wins) | Noted as a known follow-up in CLAUDE.md; deliberately not tested. |

---

## Other observations (no finding raised)

- The `pendingCountForOtherOwners()` helper exists in `syncQueue.ts` and returns
  the correct count, but is unused by both the layout and the pending page. Phase 18h
  spec mentions a "N pending for other farm" badge; this is unimplemented. Given
  the P1 finding (CT-001) already flags the list leak, this is folded into that
  recommendation rather than raised as a separate finding.
- The `skippedOtherOwner` field of `DrainResult` is computed correctly but never
  displayed in `lastDrainResult`. After the CT-001 fix (filtering the list), the
  drain result message should include "N skipped (other farms)" to explain any
  discrepancy between "Sync now (N)" count and "Synced M" outcome.
- No `+page.server.ts` exists for `/records/pending`, so there is no server-side
  auth guard specific to this route. Route is protected at the hooks layer
  (`ANONYMOUS_PATHS` does not include it), which is correct.
- Font 404s (Google Fonts CDN unreachable) appear on every page in this environment.
  These are environment-specific, not app bugs.
