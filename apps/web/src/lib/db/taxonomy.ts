/**
 * User-managed taxonomy terms.
 *
 * Domain-scoped lists that drive the "Type" dropdown across the app:
 *   - inventory:<category>  → e.g., inventory:seed, inventory:herbicide
 *   - equipment             → tractor, sprayer, baler, …
 *
 * System defaults are seeded on migration (is_default=1). Owners may add,
 * edit, or delete custom terms; default terms can be edited (renamed /
 * described) but not deleted, to keep the seeded taxonomy stable.
 */

import { randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from './client';
import { taxonomyTerms } from './schema';

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

export function listTaxonomyTerms(filter?: { domain?: string }): TaxonomyTerm[] {
  const rows = filter?.domain
    ? db.select().from(taxonomyTerms).where(eq(taxonomyTerms.domain, filter.domain)).all()
    : db.select().from(taxonomyTerms).all();
  return rows.map(rowToTerm).sort((a, b) => {
    if (a.domain !== b.domain) return a.domain.localeCompare(b.domain);
    return a.name.localeCompare(b.name);
  });
}

export function getTaxonomyTerm(id: string): TaxonomyTerm | undefined {
  const row = db.select().from(taxonomyTerms).where(eq(taxonomyTerms.id, id)).get();
  return row ? rowToTerm(row) : undefined;
}

export function findTaxonomyTermByName(domain: string, name: string): TaxonomyTerm | undefined {
  const row = db
    .select()
    .from(taxonomyTerms)
    .where(
      and(
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
  const row = db
    .insert(taxonomyTerms)
    .values({
      id,
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = db.update(taxonomyTerms).set(set as any).where(eq(taxonomyTerms.id, id)).returning().get();
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
  db.delete(taxonomyTerms).where(eq(taxonomyTerms.id, id)).run();
}

/** Best-effort lookup: match by id first, else case-insensitive name in the
 *  given domain. Returns the term if found, else undefined. */
export function resolveTaxonomyTerm(
  domain: string,
  idOrName: string | null | undefined
): TaxonomyTerm | undefined {
  if (!idOrName) return undefined;
  const byId = getTaxonomyTerm(idOrName);
  if (byId && byId.domain === domain) return byId;
  return findTaxonomyTermByName(domain, idOrName);
}

/** Build a domain key for an inventory category. */
export function inventoryDomain(category: string): string {
  return `inventory:${category}`;
}

export const EQUIPMENT_DOMAIN = 'equipment';

/** All canonical domains the UI iterates for the Settings page. */
export function allDomains(): string[] {
  const rows = db
    .selectDistinct({ domain: taxonomyTerms.domain })
    .from(taxonomyTerms)
    .orderBy(asc(taxonomyTerms.domain))
    .all();
  return rows.map((r) => r.domain);
}
