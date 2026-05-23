/**
 * Custom ESLint rule: flag raw Drizzle queries against tenant-scoped tables.
 *
 * Tenant-scoped tables in `apps/web/src/lib/db/schema.ts` carry the
 * TenantScoped brand. Reads/writes against them MUST go through the
 * `tenantWhere`, `withTenant`, or `tenantValues` helpers from
 * `apps/web/src/lib/db/tenant.ts` so the active Owner's filter / stamp
 * is always applied. This rule catches the common forgetting pattern:
 *
 *   db.select().from(blocks).where(eq(blocks.id, id))    // ❌ flagged
 *   db.insert(sprayEvents).values({...})                  // ❌ flagged
 *
 * Recommended:
 *
 *   db.select().from(blocks).where(withTenant(blocks, eq(blocks.id, id)))
 *   db.insert(sprayEvents).values(tenantValues({...}))
 *
 * If you genuinely need an unscoped query (e.g. cross-tenant superadmin
 * lookup or a global table like users), call `unscopedQueryNote('reason')`
 * in the same function — the rule's heuristic allows the file when that
 * call is present.
 *
 * Heuristic: the rule operates at FILE granularity, not call-chain
 * granularity — chasing `.from(X).where(tenantWhere(X))` through the
 * Drizzle fluent API across nodes is fragile. If the file references
 * ANY of `tenantWhere`, `withTenant`, `tenantValues`, or
 * `unscopedQueryNote`, it is treated as tenant-aware and the rule
 * suppresses. The real value of the rule is catching new files that
 * touch a tenant-scoped table without importing any of the helpers —
 * the "forgot to wire tenant scoping at all" case.
 *
 * Maintain the `TENANT_SCOPED_TABLE_NAMES` list when the schema gains a
 * new branded table. The compile-time `TenantScoped` brand in
 * `schema.ts` is the canonical gate; this rule is a secondary safety net.
 */

'use strict';

const TENANT_SCOPED_TABLE_NAMES = new Set([
  'fields',
  'blocks',
  'shadeSources',
  'crops',
  'plantingRecords',
  'cropEquipment',
  'sprayers',
  'sprayEvents',
  'harvestEvents',
  'equipment',
  'equipmentState',
  'equipmentLog',
  'pendingCalibrations',
  'stockItems',
  'stockLots',
  'stockMovements',
  'soilTests',
  'fertilityApplications',
  'fertilityCredits',
  'insecticideEvents',
  'hayCuttings',
  'tasks',
  'appSettings',
  'aiCallLog',
  'pluginOverrides'
]);

function isTenantTableIdentifier(node) {
  return node && node.type === 'Identifier' && TENANT_SCOPED_TABLE_NAMES.has(node.name);
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow raw Drizzle reads/writes against tenant-scoped tables — funnel through tenantWhere/withTenant/tenantValues.',
      category: 'Possible Errors',
      recommended: true
    },
    messages: {
      rawFrom:
        "Raw `.from({{name}})` on a tenant-scoped table. Add `.where(tenantWhere({{name}}))` (or `withTenant({{name}}, ...)` to combine with other conditions). If this is intentionally cross-tenant, call `unscopedQueryNote('reason')` in this file.",
      rawInsert:
        "Raw `db.insert({{name}})` on a tenant-scoped table. Wrap the values payload in `tenantValues({...})`. If this is intentionally cross-tenant, call `unscopedQueryNote('reason')` in this file.",
      rawUpdate:
        "Raw `db.update({{name}})` on a tenant-scoped table. Combine your WHERE with `withTenant({{name}}, ...)`. If this is intentionally cross-tenant, call `unscopedQueryNote('reason')` in this file.",
      rawDelete:
        "Raw `db.delete({{name}})` on a tenant-scoped table. Combine your WHERE with `withTenant({{name}}, ...)`. If this is intentionally cross-tenant, call `unscopedQueryNote('reason')` in this file."
    },
    schema: []
  },

  create(context) {
    let fileIsTenantAware = false;

    return {
      Program() {
        // Scan once: if the file references any tenant helper (tenant
        // accessors or an explicit cross-tenant note), treat it as
        // tenant-aware and suppress this rule file-wide. See the file
        // header for the why.
        const src = context.getSourceCode().getText();
        fileIsTenantAware =
          /\b(tenantWhere|withTenant|tenantValues|unscopedQueryNote)\s*\(/.test(src);
      },

      // db.select(...).from(blocks)
      'CallExpression[callee.property.name="from"]'(node) {
        if (fileIsTenantAware) return;
        const arg = node.arguments[0];
        if (isTenantTableIdentifier(arg)) {
          context.report({
            node,
            messageId: 'rawFrom',
            data: { name: arg.name }
          });
        }
      },

      // db.insert(blocks).values({...})
      'CallExpression[callee.property.name="insert"]'(node) {
        if (fileIsTenantAware) return;
        const arg = node.arguments[0];
        if (isTenantTableIdentifier(arg)) {
          context.report({
            node,
            messageId: 'rawInsert',
            data: { name: arg.name }
          });
        }
      },

      // db.update(blocks).set({...}).where(...)
      'CallExpression[callee.property.name="update"]'(node) {
        if (fileIsTenantAware) return;
        const arg = node.arguments[0];
        if (isTenantTableIdentifier(arg)) {
          context.report({
            node,
            messageId: 'rawUpdate',
            data: { name: arg.name }
          });
        }
      },

      // db.delete(blocks).where(...)
      'CallExpression[callee.property.name="delete"]'(node) {
        if (fileIsTenantAware) return;
        const arg = node.arguments[0];
        if (isTenantTableIdentifier(arg)) {
          context.report({
            node,
            messageId: 'rawDelete',
            data: { name: arg.name }
          });
        }
      }
    };
  }
};
