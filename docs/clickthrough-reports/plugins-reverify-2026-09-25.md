# Re-verify — /plugins ecosystem (epic #236) — 2026-09-25

**Source audit:** `plugins-flows-2026-05-25.md`
**Setup:** production build on port 5318, seeded DB, owner session.

Both children were closed as "resolved via the unified /inventory list + detail surface". That is
true for `/inventory`. However, `/plugins` and `/plugins/[pluginId]` are still live and linked:
`PluginRef` chips, the `A_InventoryEditForm` "upload a new version" link, AllocationWizard and
`/plugins/community`. Both defects still reproduced there.

| Finding | Issue | Status | Evidence |
|---|---|---|---|
| CT-PLG-001 `[object Object]` on postHarvestCuring range fields | #237 (closed) | **Was still broken on `/plugins/[pluginId]` → fixed in this pass** (`2d46532`) | Before: `/plugins/corn-bloody-butcher` read "Rack cure … · [object Object] weeks · target [object Object]% moisture". The page interpolated the `{min,max}` objects directly. `/inventory/crop/<id>` was already clean. Fix: `lib/plugins/rangeText.ts` (range, half-open, legacy scalar), with 5 tests. After: "· 2–4 weeks · target 14–15% moisture". |
| CT-PLG-002 search doesn't filter the installed list | #238 (closed) | **Was still broken on `/plugins` → fixed in this pass** (`e04efa8`) | The only search box drives the add-new AI lookup, and the installed list had type tabs only. Fix: a 48px "Filter by name or plugin id" input that combines with the type tab and bulk-select. `lib/plugins/filterRegistered.ts` has 5 tests. After: 691 rows → "roundup" → 2 rows. `/inventory` catalog search also works (376 → "bloody" → 2). |
| Kernel invariant #2 (schema reject, bypass reject, JS strip) | — | **Holds** | Not re-driven. No changes to `lib/plugins/` validation or bypass code. |

**Verdict:** ready to close. Both findings are now fixed on both surfaces.
