# Pending migration: `map_features` (Phase 30H)

The schema for `map_features` is in `src/lib/db/schema.ts` (`mapFeatures`), but
no migration file is committed on this branch, because another sprint adds a
migration in parallel. The integrator generates this one after that lands:

```sh
cd apps/web
pnpm db:generate            # drizzle-kit picks the next number
mv drizzle/00NN_*.sql drizzle/00NN_map_features.sql   # optional rename; update meta/_journal.json "tag" to match
rm drizzle/PENDING_map_features.md
```

`drizzle-kit generate` against this schema produces exactly the DDL below
(checked locally on top of `0053_client_record_receipts`). If the generated
file differs, the schema and this note have drifted, so stop and compare.

```sql
CREATE TABLE `map_features` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`field_id` text,
	`kind` text NOT NULL,
	`geometry_geojson` text NOT NULL,
	`name` text NOT NULL,
	`details_json` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`field_id`) REFERENCES `fields`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `map_features_owner_kind_idx` ON `map_features` (`owner_id`,`kind`);--> statement-breakpoint
CREATE INDEX `map_features_owner_field_idx` ON `map_features` (`owner_id`,`field_id`);
```

Notes:

- New table only; no backfill and no change to existing rows.
- `kind` is one of `fence | gate | water_source | hydrant | irrigation_line | path`
  (a TEXT enum, enforced by Zod in `lib/farm/mapFeatures.ts` and the API).
- `geometry_geojson` is a GeoJSON `LineString` for fence, irrigation line and
  path, and a `Point` for gate, water source and hydrant.
- `details_json` is only used by water sources today:
  `{ "source"?: "well" | "municipal" | "pond" | "rain", "flowRateGpm"?: number }`.
- `field_id` is optional. Deleting an Area unlinks its features
  (`deleteFieldCascade` sets `field_id` to null, and the FK does the same), so
  a fence stays on the map when the pasture it bordered is removed.
- Tenant checklist (Invariant 6): branded `tenantScoped(...)`, `owner_id NOT
  NULL`, composite indexes on `(owner_id, kind)` and `(owner_id, field_id)`,
  wired into `tenant.crossTenant.test.ts`, and listed in
  `packages/eslint-plugin-cropcard/tenant-scoped-tables.json`.
