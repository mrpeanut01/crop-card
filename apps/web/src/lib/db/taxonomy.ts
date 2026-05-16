/**
 * User-managed taxonomy terms.
 *
 * Domain-scoped lists that drive the "Type" dropdown across the app:
 *   - inventory:<category>  → e.g., inventory:seed, inventory:herbicide
 *   - equipment             → tractor, sprayer, baler, …
 *
 * Phase 18a has mixed scope here:
 *   - System defaults (is_default=1, owner_id IS NULL) are globally visible.
 *   - User-added terms (is_default=0, owner_id=<owner>) are per-Owner.
 *
 * Reads must union both shapes via `WHERE owner_id = ? OR owner_id IS NULL`;
 * writes always stamp the active Owner. Because of this hybrid semantics
 * the table is intentionally NOT branded `TenantScoped` — `tenantWhere`
 * would over-filter and hide the global defaults.
 */

import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from './client';
import { taxonomyTerms } from './schema';
import { requireOwnerId, unscopedQueryNote } from './tenant';

export interface TaxonomyTerm {
  id: string;
  domain: string;
  name: string;
  description?: string;
  isDefault: boolean;
  createdAt: number;
}

function rowToTerm(row: typeof taxonomyTerms.$inferSelect): TaxonomyTerm {
  return {
    id: row.id,
    domain: row.domain,
    name: row.name,
    description: row.description ?? undefined,
    isDefault: row.isDefault,
    createdAt: row.createdAt.getTime()
  };
}

/** Returns globally-visible defaults UNION the active Owner's user-added
 *  terms. Owner filter is added inline (no tenantWhere helper because of
 *  the OR clause). */
function visibleTermsCondition() {
  const ownerId = requireOwnerId();
  return or(isNull(taxonomyTerms.ownerId), eq(taxonomyTerms.ownerId, ownerId))!;
}

export function listTaxonomyTerms(filter?: { domain?: string }): TaxonomyTerm[] {
  const conds = [visibleTermsCondition()];
  if (filter?.domain) conds.push(eq(taxonomyTerms.domain, filter.domain));
  const rows = db
    .select()
    .from(taxonomyTerms)
    .where(and(...conds))
    .all();
  return rows.map(rowToTerm).sort((a, b) => {
    if (a.domain !== b.domain) return a.domain.localeCompare(b.domain);
    return a.name.localeCompare(b.name);
  });
}

export function getTaxonomyTerm(id: string): TaxonomyTerm | undefined {
  const row = db
    .select()
    .from(taxonomyTerms)
    .where(and(eq(taxonomyTerms.id, id), visibleTermsCondition()))
    .get();
  return row ? rowToTerm(row) : undefined;
}

export function findTaxonomyTermByName(domain: string, name: string): TaxonomyTerm | undefined {
  const row = db
    .select()
    .from(taxonomyTerms)
    .where(
      and(
        visibleTermsCondition(),
        eq(taxonomyTerms.domain, domain),
        sql`lower(${taxonomyTerms.name}) = lower(${name})`
      )
    )
    .get();
  return row ? rowToTerm(row) : undefined;
}

export interface CreateTaxonomyTermInput {
  domain: string;
  name: string;
  description?: string;
}

export class DuplicateTaxonomyTermError extends Error {
  constructor(domain: string, name: string) {
    super(`taxonomy term '${name}' already exists in domain '${domain}'`);
    this.name = 'DuplicateTaxonomyTermError';
  }
}

export function createTaxonomyTerm(input: CreateTaxonomyTermInput): TaxonomyTerm {
  const name = input.name.trim();
  if (!name) throw new Error('name required');
  const existing = findTaxonomyTermByName(input.domain, name);
  if (existing) throw new DuplicateTaxonomyTermError(input.domain, name);
  const id = randomUUID();
  const ownerId = requireOwnerId();
  const row = db
    .insert(taxonomyTerms)
    .values({
      id,
      ownerId,
      domain: input.domain,
      name,
      description: input.description?.trim() || null,
      isDefault: false
    })
    .returning()
    .get();
  return rowToTerm(row);
}

export interface UpdateTaxonomyTermInput {
  name?: string;
  description?: string | null;
}

export function updateTaxonomyTerm(id: string, input: UpdateTaxonomyTermInput): TaxonomyTerm {
  const existing = getTaxonomyTerm(id);
  if (!existing) throw new Error(`unknown taxonomy term: ${id}`);

  const set: Partial<typeof taxonomyTerms.$inferInsert> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new Error('name cannot be empty');
    if (name.toLowerCase() !== existing.name.toLowerCase()) {
      const dupe = findTaxonomyTermByName(existing.domain, name);
      if (dupe && dupe.id !== id) throw new DuplicateTaxonomyTermError(existing.domain, name);
    }
    set.name = name;
  }
  if ('description' in input) {
    set.description = input.description?.trim() || null;
  }
  if (Object.keys(set).length === 0) return existing;
  // Allow updates to either system defaults (ownerId IS NULL) or owner's
  // own terms — but never to another tenant's. The visibleTermsCondition
  // makes that distinction.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = db
    .update(taxonomyTerms)
    .set(set as any)
    .where(and(eq(taxonomyTerms.id, id), visibleTermsCondition()))
    .returning()
    .get();
  return rowToTerm(row);
}

export class DefaultTermDeleteError extends Error {
  constructor(name: string) {
    super(`default taxonomy term '${name}' cannot be deleted`);
    this.name = 'DefaultTermDeleteError';
  }
}

export function deleteTaxonomyTerm(id: string): void {
  const existing = getTaxonomyTerm(id);
  if (!existing) return;
  if (existing.isDefault) throw new DefaultTermDeleteError(existing.name);
  const ownerId = requireOwnerId();
  // User-added terms only deletable by their own Owner.
  db.delete(taxonomyTerms)
    .where(and(eq(taxonomyTerms.id, id), eq(taxonomyTerms.ownerId, ownerId)))
    .run();
}

export function resolveTaxonomyTerm(
  domain: string,
  idOrName: string | null | undefined
): TaxonomyTerm | undefined {
  if (!idOrName) return undefined;
  const byId = getTaxonomyTerm(idOrName);
  if (byId && byId.domain === domain) return byId;
  return findTaxonomyTermByName(domain, idOrName);
}

export function inventoryDomain(category: string): string {
  return `inventory:${category}`;
}

export const EQUIPMENT_DOMAIN = 'equipment';

export function allDomains(): string[] {
  unscopedQueryNote('listing all domains spans system defaults + per-owner terms by design');
  const rows = db
    .selectDistinct({ domain: taxonomyTerms.domain })
    .from(taxonomyTerms)
    .orderBy(asc(taxonomyTerms.domain))
    .all();
  return rows.map((r) => r.domain);
}
