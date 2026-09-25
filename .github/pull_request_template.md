## What and why

## Checks (delete what doesn't apply)
- [ ] Safety kernel change → `RULES_VERSION` bumped + vitest/fast-check tests
- [ ] New tenant-scoped table or query → `tenantScoped(...)`, `owner_id` index, cross-tenant test
- [ ] Migration → numbered next in sequence, applied with `pnpm db:migrate`
- [ ] Behaviour change → matching UC in `docs/use-cases.md` updated
- [ ] UI change → checked at 375px and desktop
