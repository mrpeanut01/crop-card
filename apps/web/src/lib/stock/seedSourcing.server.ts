/**
 * Seed sourcing reads and the one write (33B, B3, contract C-B3). Every
 * query is tenant-scoped; `stock_lots` is not a hold-fact table.
 */

import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { db } from '$lib/db/client';
import {
  documentLinks,
  documents,
  seedStarts,
  stockItems,
  stockLots,
  stockMovements
} from '$lib/db/schema';
import { withTenant } from '$lib/db/tenant';
import {
  parseSourcesChecked,
  type LotSeedSourcing,
  type SeedEvidenceDoc,
  type SeedOrganicStatus,
  type SeedSourcing,
  type SeedSourcingRow
} from './seedSourcing';

export type { LotSeedSourcing, SeedEvidenceDoc, SeedSourcingRow };

type LotRow = typeof stockLots.$inferSelect;

function sourcingOf(row: LotRow): SeedSourcing {
  return {
    status: (row.seedOrganicStatus as SeedOrganicStatus | null) ?? null,
    sourcesChecked: parseSourcesChecked(row.seedSourcesCheckedJson),
    unavailabilityNote: row.seedUnavailabilityNote ?? null
  };
}

const CHUNK = 500;

function chunks<T>(xs: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
}

/** Live documents linked to each lot, oldest link first. */
function evidenceForLots(lotIds: readonly string[]): Map<string, SeedEvidenceDoc[]> {
  const out = new Map<string, SeedEvidenceDoc[]>();
  const unique = [...new Set(lotIds)];
  if (unique.length === 0) return out;
  const links = chunks(unique).flatMap((ids) =>
    db
      .select({
        id: documentLinks.id,
        documentId: documentLinks.documentId,
        subjectId: documentLinks.subjectId
      })
      .from(documentLinks)
      .where(
        withTenant(
          documentLinks,
          eq(documentLinks.subjectType, 'stock-lot'),
          inArray(documentLinks.subjectId, ids)
        )
      )
      .orderBy(documentLinks.createdAt, documentLinks.id)
      .all()
  );
  if (links.length === 0) return out;
  const docIds = [...new Set(links.map((l) => l.documentId))];
  const docs = new Map(
    chunks(docIds)
      .flatMap((ids) =>
        db
          .select({ id: documents.id, title: documents.title, kind: documents.kind })
          .from(documents)
          .where(withTenant(documents, inArray(documents.id, ids), isNull(documents.deletedAt)))
          .all()
      )
      .map((d) => [d.id, d])
  );
  for (const l of links) {
    const d = docs.get(l.documentId);
    if (!d) continue;
    const list = out.get(l.subjectId) ?? [];
    list.push({ id: d.id, linkId: l.id, title: d.title, kind: d.kind });
    out.set(l.subjectId, list);
  }
  return out;
}

/** The lot when it belongs to the item, with the item's category. */
export function lotOfItem(
  stockItemId: string,
  lotId: string
): { lot: LotRow; category: string } | null {
  const lot = db
    .select()
    .from(stockLots)
    .where(withTenant(stockLots, eq(stockLots.id, lotId), eq(stockLots.stockItemId, stockItemId)))
    .get();
  if (!lot) return null;
  const item = db
    .select({ category: stockItems.category })
    .from(stockItems)
    .where(withTenant(stockItems, eq(stockItems.id, stockItemId)))
    .get();
  if (!item) return null;
  return { lot, category: item.category };
}

/** Replaces all three fields (B-38). */
export function setLotSeedSourcing(lotId: string, s: SeedSourcing): SeedSourcing {
  const row = db
    .update(stockLots)
    .set({
      seedOrganicStatus: s.status,
      seedSourcesCheckedJson: s.sourcesChecked.length ? JSON.stringify(s.sourcesChecked) : null,
      seedUnavailabilityNote: s.unavailabilityNote
    })
    .where(withTenant(stockLots, eq(stockLots.id, lotId)))
    .returning()
    .get();
  if (!row) throw new Error('lot not found');
  return sourcingOf(row);
}

/** Sourcing plus evidence for the given lots, for the seed detail page. */
export function seedSourcingForLots(lotIds: readonly string[]): Map<string, LotSeedSourcing> {
  const out = new Map<string, LotSeedSourcing>();
  const unique = [...new Set(lotIds)];
  if (unique.length === 0) return out;
  const rows = chunks(unique).flatMap((ids) =>
    db
      .select()
      .from(stockLots)
      .where(withTenant(stockLots, inArray(stockLots.id, ids)))
      .all()
  );
  const evidence = evidenceForLots(unique);
  for (const r of rows) out.set(r.id, { ...sourcingOf(r), documents: evidence.get(r.id) ?? [] });
  return out;
}

/**
 * B-40: seed lots received in the window, plus seed lots a `planting`
 * stock movement or a seed start used in the window. Sorted by item name,
 * then received date.
 */
export function listSeedSourcing(window: { fromMs: number; toMs: number }): SeedSourcingRow[] {
  const from = new Date(window.fromMs);
  const to = new Date(window.toMs);
  const seedItems = new Map(
    db
      .select({ id: stockItems.id, displayName: stockItems.displayName })
      .from(stockItems)
      .where(withTenant(stockItems, eq(stockItems.category, 'seed')))
      .all()
      .map((i) => [i.id, i.displayName])
  );
  if (seedItems.size === 0) return [];
  const itemIds = [...seedItems.keys()];

  const lots = chunks(itemIds).flatMap((ids) =>
    db
      .select()
      .from(stockLots)
      .where(withTenant(stockLots, inArray(stockLots.stockItemId, ids)))
      .all()
  );
  if (lots.length === 0) return [];
  const lotIds = lots.map((l) => l.id);

  const used = new Set<string>();
  for (const ids of chunks(lotIds)) {
    for (const m of db
      .select({ lotId: stockMovements.stockLotId })
      .from(stockMovements)
      .where(
        withTenant(
          stockMovements,
          and(
            eq(stockMovements.reason, 'planting'),
            inArray(stockMovements.stockLotId, ids),
            gte(stockMovements.occurredAt, from),
            lte(stockMovements.occurredAt, to)
          )
        )
      )
      .all()) {
      used.add(m.lotId);
    }
    for (const s of db
      .select({ lotId: seedStarts.stockLotId })
      .from(seedStarts)
      .where(
        withTenant(
          seedStarts,
          and(
            inArray(seedStarts.stockLotId, ids),
            gte(seedStarts.sownAt, from),
            lte(seedStarts.sownAt, to)
          )
        )
      )
      .all()) {
      if (s.lotId) used.add(s.lotId);
    }
  }

  const inWindow = lots.filter((l) => {
    if (used.has(l.id)) return true;
    if (l.quantityStatus !== 'existing') return false;
    const t = l.receivedAt.getTime();
    return t >= window.fromMs && t <= window.toMs;
  });
  const evidence = evidenceForLots(inWindow.map((l) => l.id));
  return inWindow
    .map((l) => ({
      ...sourcingOf(l),
      stockItemId: l.stockItemId,
      stockLotId: l.id,
      itemName: seedItems.get(l.stockItemId) ?? '',
      lotNumber: l.lotNumber ?? null,
      supplier: l.supplier ?? null,
      receivedAt: l.receivedAt.getTime(),
      documentIds: (evidence.get(l.id) ?? []).map((d) => d.id)
    }))
    .sort((a, b) => a.itemName.localeCompare(b.itemName) || a.receivedAt - b.receivedAt);
}
