/**
 * 33B (plan item 7, B-42 to B-49): the certifier pack. Reads the active
 * farm through the tenant-scoped repos and the C-B1, C-B2 and C-B3
 * helpers, builds the CSVs and the summary PDF in memory, then streams a
 * store-only ZIP through the 33A writer, adding the linked documents with
 * their stored size and CRC when asked. Every page and every CSV says
 * "Prepared from records kept in CropCard. This is not a certification."
 * Read-only.
 */

import type { Prefs } from '$lib/prefs';
import { formatCalendarDate, formatInstant } from '$lib/prefs';
import { listFields } from '$lib/db/fields';
import { listBlocks } from '$lib/db/blocks';
import { listAnimals } from '$lib/db/animals';
import { listAnimalGroups } from '$lib/db/animalGroups';
import { listCrops } from '$lib/db/crops';
import { listSeedStartsForCrops } from '$lib/db/seedStarts';
import { listSprayEvents } from '$lib/db/sprayEvents';
import { listInsecticideEvents } from '$lib/db/insecticideEvents';
import { listFungicideEvents } from '$lib/db/fungicideEvents';
import { listHarvestEvents } from '$lib/db/harvestEvents';
import { listAllCuttings } from '$lib/db/hayCuttings';
import { listFertilityApplicationsInWindow } from '$lib/db/organicFacts';
import { listApplicationTombstones } from '$lib/db/admin';
import { listOrganicStatusEntries } from '$lib/db/organicStatus';
import { listDispositionsForHarvests } from '$lib/db/harvestDispositions';
import { getLedgerEntry } from '$lib/db/ledger';
import { DISPOSITION_KIND_LABEL } from '$lib/harvest/apiSchemas';
import { documentPeople, listDocuments, type DocumentRow } from '$lib/db/documents';
import { animalLabel } from '$lib/animals/display';
import { CROP_AREA_KINDS } from '$lib/farm/areaKinds';
import { isPhotoKind, DOCUMENT_KIND_LABEL, DOCUMENT_SUBJECT_LABEL } from '$lib/documents/kinds';
import type { DocumentMeta } from '$lib/documents/apiSchemas';
import { canReadDocument } from '$lib/documents/access';
import { identityLabel } from '$lib/identity';
import {
  organicStatusLine,
  resolveAreaStatus,
  resolveBlockStatus,
  ORGANIC_STATUS_LABEL,
  type OrganicStatusEntry
} from '$lib/organic/status';
import { organicDateFormatter } from '$lib/organic/status.server';
import { animalOrganicProjection } from '$lib/organic/animalStatus.server';
import { organicHealthPlugins } from '$lib/organic/plugins.server';
import {
  complianceFlagsText,
  organicInputClass,
  ORGANIC_INPUT_CLASS_LABEL,
  type OrganicComplianceFlags
} from '$lib/organic/inputCompliance';
import { listSeedSourcing } from '$lib/stock/seedSourcing.server';
import {
  SEED_ORGANIC_STATUS_LABEL,
  SEED_SEARCH_FLAG_LABEL,
  seedSearchFlag,
  sortChecks
} from '$lib/stock/seedSourcing';
import { daysLate } from '$lib/server/animalProductionGate';
import { getRegistry } from '$lib/server/registry';
import { runRenderJob } from '$lib/server/render/queue';
import { extensionFor, slugify, toDocumentMeta } from '$lib/server/documentAccess';
import { openDocument } from '$lib/server/vault/documents';
import { crc32, zipStream, type ZipEntry } from '$lib/server/zip';
import type { AuthenticatedUser } from '$lib/server/auth';
import { APP_VERSION } from '$lib/version';
import { buildTreatmentLog } from '$lib/records/animalTreatmentLog.server';
import { lateLabel } from '$lib/records/lateLabel';
import { farmNameOf } from '$lib/records/farmName.server';
import {
  PACK_FILES,
  type PackActivityRow,
  type PackData,
  type PackDocumentRow,
  type PackHarvestRow,
  type PackInputRow,
  type PackSeedRow,
  type PackStatusRow
} from '$lib/records/organicPack';

type PluginRecord = {
  type: string;
  displayName?: string;
  epaRegistrationNumber?: string;
  complianceFlags?: OrganicComplianceFlags;
};

const LIMIT = 1_000_000;

export interface OrganicPackOptions {
  fromMs: number;
  toMs: number;
  documents: boolean;
  viewer: AuthenticatedUser;
  prefs: Prefs;
  from: string;
  to: string;
  now?: Date;
  /** The request's signal: a pack still waiting to render is dropped when
   *  the download is abandoned (R-04). */
  signal?: AbortSignal;
}

export function libraryBuild(): string {
  return `CropCard v${APP_VERSION} (build ${process.env.BUILD_SHA || 'dev'})`;
}

/** B-47: only an owner's pack carries money; an inspector's never carries
 *  a money document, and every document passes `canReadDocument`. */
export function packDocuments(
  role: string,
  rows: readonly DocumentRow[]
): { row: DocumentRow; meta: DocumentMeta }[] {
  const metas = toDocumentMeta(rows.filter((r) => !isPhotoKind(r.kind)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return metas
    .filter((m) => m.links.length > 0)
    .filter((m) => canReadDocument(role, m))
    .filter((m) => role === 'owner' || !m.links.some((l) => l.subjectType === 'ledger-entry'))
    .map((meta) => ({ row: byId.get(meta.id)!, meta }));
}

export function packDocumentEntryName(doc: Pick<DocumentRow, 'id' | 'title' | 'mime'>): string {
  return `documents/${doc.id}-${slugify(doc.title)}.${extensionFor(doc.mime)}`;
}

/** Everything the pack's files are built from. */
export async function buildOrganicPackData(opts: OrganicPackOptions): Promise<PackData> {
  const now = opts.now ?? new Date();
  const window = { fromMs: opts.fromMs, toMs: opts.toMs };
  const inWindow = (ms: number | null | undefined) =>
    ms !== null && ms !== undefined && ms >= opts.fromMs && ms <= opts.toMs;
  const day = (ms: number) => formatInstant(ms, opts.prefs, 'date');
  const statusDay = organicDateFormatter();
  const registry = await getRegistry();
  const plugin = (id: string | null | undefined): PluginRecord | undefined =>
    id ? (registry.get(id)?.plugin as PluginRecord | undefined) : undefined;

  const fields = listFields();
  const blocks = listBlocks({ plantings: 'none' });
  const fieldName = new Map(fields.map((f) => [f.id, f.name]));
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const blockName = (id: string | null | undefined) => {
    const b = id ? blockById.get(id) : undefined;
    return b ? (b.blockLabel ?? b.name) : id ? 'A removed block' : null;
  };
  const areaOfBlock = (id: string | null | undefined) => {
    const f = id ? blockById.get(id)?.fieldId : undefined;
    return f ? (fieldName.get(f) ?? null) : null;
  };

  const entries = listOrganicStatusEntries();
  const entriesOf = new Map<string, OrganicStatusEntry[]>();
  for (const e of entries) {
    const k = `${e.subjectType}:${e.subjectId}`;
    entriesOf.set(k, [...(entriesOf.get(k) ?? []), e]);
  }
  const blockStatusAt = (blockId: string | null | undefined, atMs: number) => {
    if (!blockId || entries.length === 0) return null;
    const b = blockById.get(blockId);
    const area =
      b?.fieldId && fieldName.has(b.fieldId)
        ? {
            id: b.fieldId,
            name: fieldName.get(b.fieldId)!,
            entries: entriesOf.get(`field:${b.fieldId}`) ?? []
          }
        : null;
    return organicStatusLine(
      resolveBlockStatus(entriesOf.get(`block:${blockId}`) ?? [], area, atMs),
      statusDay
    );
  };

  // ── 01 statuses ──
  const animals = listAnimals({ status: 'all' });
  const groups = listAnimalGroups({ status: 'all' });
  const animalName = new Map(animals.map((a) => [a.id, animalLabel(a)]));
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const projection = entries.some((e) => e.subjectType === 'animal' || e.subjectType === 'group')
    ? animalOrganicProjection(await organicHealthPlugins())
    : null;
  const nowMs = now.getTime();
  const people = documentPeople(entries.map((e) => e.createdBy));
  const subjects: { type: OrganicStatusEntry['subjectType']; id: string }[] = [
    ...fields
      .filter((f) => (CROP_AREA_KINDS as readonly string[]).includes(f.kind))
      .map((f) => ({ type: 'field' as const, id: f.id })),
    ...blocks.map((b) => ({ type: 'block' as const, id: b.id })),
    ...animals
      .filter((a) => a.status === 'active')
      .map((a) => ({ type: 'animal' as const, id: a.id })),
    ...groups
      .filter((g) => g.status === 'active')
      .map((g) => ({ type: 'group' as const, id: g.id }))
  ];
  const listed = new Set(subjects.map((s) => `${s.type}:${s.id}`));
  for (const e of entries) {
    const k = `${e.subjectType}:${e.subjectId}`;
    if (!listed.has(k)) {
      listed.add(k);
      subjects.push({ type: e.subjectType, id: e.subjectId });
    }
  }
  const subjectLabel = { field: 'Area', block: 'Block', animal: 'Animal', group: 'Group' } as const;
  const nameOf = (type: OrganicStatusEntry['subjectType'], id: string): string => {
    if (type === 'field') return fieldName.get(id) ?? 'A removed Area';
    if (type === 'block') return blockName(id) ?? 'A removed block';
    if (type === 'animal') return animalName.get(id) ?? 'A removed animal';
    return groupName.get(id) ?? 'A removed group';
  };
  const inForceToday = (type: OrganicStatusEntry['subjectType'], id: string) => {
    if (entries.length === 0) return null;
    if (type === 'block') return blockStatusAt(id, nowMs);
    if (type === 'field') {
      return organicStatusLine(
        resolveAreaStatus(entriesOf.get(`field:${id}`) ?? [], nowMs),
        statusDay
      );
    }
    return projection
      ? organicStatusLine(projection.statusAt({ type, id }, nowMs), statusDay)
      : null;
  };
  const statuses: PackStatusRow[] = [];
  for (const s of subjects) {
    const base = {
      subjectType: subjectLabel[s.type],
      name: nameOf(s.type, s.id),
      area: s.type === 'block' ? areaOfBlock(s.id) : null,
      inForceToday: inForceToday(s.type, s.id)
    };
    const own = entriesOf.get(`${s.type}:${s.id}`) ?? [];
    if (own.length === 0) {
      statuses.push({
        ...base,
        status: null,
        effective: null,
        certifier: null,
        note: null,
        enteredBy: null,
        enteredOn: null,
        documents: null
      });
      continue;
    }
    for (const e of own) {
      const who = e.createdBy ? people.get(e.createdBy) : undefined;
      statuses.push({
        ...base,
        status: ORGANIC_STATUS_LABEL[e.status],
        effective: statusDay(e.effectiveAt),
        certifier: e.certifier,
        note: e.note,
        enteredBy: who ? identityLabel(who) : e.createdBy ? 'A former member' : null,
        enteredOn: day(e.createdAt),
        documents: e.documentIds.length ? e.documentIds.join('; ') : null
      });
    }
  }

  // ── 02 activity and 03 inputs ──
  const activity: (PackActivityRow & { atMs: number })[] = [];
  const inputs = new Map<string, PackInputRow>();
  const markOf = (p: PluginRecord | undefined) =>
    ORGANIC_INPUT_CLASS_LABEL[organicInputClass(p ?? null)];
  const useInput = (pluginId: string | null, name: string, kind: string) => {
    const p = plugin(pluginId);
    const key = p && pluginId ? `plugin:${pluginId}` : `manual:${name}`;
    const row = inputs.get(key) ?? {
      name: p?.displayName ?? name,
      type: p?.type ?? kind,
      pluginId: p ? pluginId : null,
      epaRegistrationNumber: p?.epaRegistrationNumber ?? null,
      complianceFlags: complianceFlagsText(p?.complianceFlags),
      libraryMark: markOf(p),
      provenance: p ? ('plugin' as const) : ('manual' as const),
      uses: 0
    };
    row.uses += 1;
    inputs.set(key, row);
  };
  const cropName = (id: string | null | undefined) => plugin(id)?.displayName ?? id ?? null;
  const pushApp = (
    activityLabel: string,
    kind: string,
    e: { blockId: string; occurredAt: number; cropId?: string },
    products: { pluginId: string | null; displayName?: string }[]
  ) => {
    for (const p of products) {
      const rec = plugin(p.pluginId);
      const name = rec?.displayName ?? p.displayName ?? p.pluginId ?? 'Product not named';
      useInput(p.pluginId, name, kind);
      activity.push({
        atMs: e.occurredAt,
        date: day(e.occurredAt),
        activity: activityLabel,
        block: blockName(e.blockId),
        area: areaOfBlock(e.blockId),
        crop: null,
        detail: name,
        pluginId: p.pluginId,
        libraryMark: markOf(rec),
        blockStatus: blockStatusAt(e.blockId, e.occurredAt),
        savedLate: null
      });
    }
  };
  const listWindow = { fromMs: opts.fromMs, toMs: opts.toMs, limit: LIMIT };
  for (const e of listSprayEvents(listWindow))
    pushApp('Herbicide spray', 'herbicide', e, e.products);
  for (const e of listInsecticideEvents(listWindow))
    pushApp('Insecticide', 'insecticide', e, e.products);
  for (const e of listFungicideEvents(listWindow)) pushApp('Fungicide', 'fungicide', e, e.products);
  const DELETED_APP = ' (record deleted, still counted as applied)';
  const TOMBSTONE_LABEL = {
    spray: ['Herbicide spray', 'herbicide'],
    insecticide: ['Insecticide', 'insecticide'],
    fungicide: ['Fungicide', 'fungicide']
  } as const;
  for (const t of listApplicationTombstones(opts.fromMs)) {
    if (t.occurredAt > opts.toMs) continue;
    const [label, kind] = TOMBSTONE_LABEL[t.source];
    pushApp(
      label + DELETED_APP,
      kind,
      t,
      t.products.map((p) => ({
        pluginId: p.pluginId ?? null,
        displayName: p.displayName || p.pluginId || 'Product not named'
      }))
    );
  }
  for (const f of listFertilityApplicationsInWindow(window)) {
    const sourcePlugin = plugin(f.source);
    const pluginId = f.stockPluginId ?? (sourcePlugin?.type === 'fertilizer' ? f.source : null);
    const rec = plugin(pluginId);
    const name = rec?.displayName ?? f.stockItemName ?? f.source;
    useInput(pluginId, name, 'fertilizer');
    activity.push({
      atMs: f.occurredAt,
      date: day(f.occurredAt),
      activity: 'Fertility application',
      block: blockName(f.blockId),
      area: areaOfBlock(f.blockId),
      crop: null,
      detail: name,
      pluginId,
      libraryMark: markOf(rec),
      blockStatus: blockStatusAt(f.blockId, f.occurredAt),
      savedLate: null
    });
  }
  const crops = listCrops();
  const cropById = new Map(crops.map((c) => [c.id, c]));
  for (const c of crops) {
    if (!inWindow(c.plantingDate)) continue;
    activity.push({
      atMs: c.plantingDate!,
      date: formatCalendarDate(c.plantingDate!, 'date', {}, opts.prefs.locale),
      activity: 'Planting',
      block: blockName(c.blockId),
      area: areaOfBlock(c.blockId),
      crop: c.varietyDisplayName || cropName(c.cropPluginId),
      detail: null,
      pluginId: c.cropPluginId,
      libraryMark: null,
      blockStatus: blockStatusAt(c.blockId, c.plantingDate!),
      savedLate: null
    });
  }
  for (const s of listSeedStartsForCrops(crops.map((c) => c.id))) {
    if (!inWindow(s.sownAt)) continue;
    const c = cropById.get(s.cropId);
    activity.push({
      atMs: s.sownAt,
      date: day(s.sownAt),
      activity: 'Seed start',
      block: blockName(c?.blockId),
      area: areaOfBlock(c?.blockId),
      crop: c ? c.varietyDisplayName || cropName(c.cropPluginId) : null,
      detail: s.trayLabel,
      pluginId: c?.cropPluginId ?? null,
      libraryMark: null,
      blockStatus: c ? blockStatusAt(c.blockId, s.sownAt) : null,
      savedLate: null
    });
  }
  const harvestEvents = listHarvestEvents({ fromMs: opts.fromMs, toMs: opts.toMs });
  for (const h of harvestEvents) {
    activity.push({
      atMs: h.occurredAt,
      date: day(h.occurredAt),
      activity: 'Harvest',
      block: blockName(h.blockId),
      area: areaOfBlock(h.blockId),
      crop: cropName(h.cropPluginId),
      detail:
        [h.quantity, h.lotNumber ? `lot ${h.lotNumber}` : null].filter(Boolean).join(', ') || null,
      pluginId: h.cropPluginId,
      libraryMark: null,
      blockStatus: blockStatusAt(h.blockId, h.occurredAt),
      savedLate: null
    });
  }
  for (const h of listAllCuttings()) {
    if (!inWindow(h.mowAt)) continue;
    activity.push({
      atMs: h.mowAt!,
      date: day(h.mowAt!),
      activity: 'Hay cutting',
      block: blockName(h.blockId),
      area: areaOfBlock(h.blockId),
      crop: cropName(h.cropPluginId),
      detail: `Cutting ${h.cuttingNumber}${h.balesQuantity ? `, ${h.balesQuantity} bales` : ''}`,
      pluginId: h.cropPluginId,
      libraryMark: null,
      blockStatus: blockStatusAt(h.blockId, h.mowAt!),
      savedLate: lateLabel(h.recordedLate, daysLate(h.mowAt!, h.createdAt))
    });
  }
  activity.sort((a, b) => a.atMs - b.atMs || a.activity.localeCompare(b.activity));

  // ── 04 seed sourcing ──
  const seed: PackSeedRow[] = listSeedSourcing(window).map((s) => {
    const flag = seedSearchFlag(s);
    return {
      item: s.itemName,
      lot: s.lotNumber,
      supplier: s.supplier,
      received: day(s.receivedAt),
      seedStatus: s.status ? SEED_ORGANIC_STATUS_LABEL[s.status] : 'Not recorded',
      sourcesChecked: sortChecks(s.sourcesChecked)
        .map((c) => `${c.checkedAt} ${c.supplier}: ${c.result}`)
        .join('; '),
      unavailabilityNote: s.unavailabilityNote,
      flag: flag ? SEED_SEARCH_FLAG_LABEL[flag] : null,
      documents: s.documentIds.length ? s.documentIds.join('; ') : null
    };
  });

  // ── 05 treatments ──
  const treatments = await buildTreatmentLog(window, opts.prefs, nowMs);

  // ── 06 harvests ──
  const forOwner = opts.viewer.role === 'owner';
  const dispositions = listDispositionsForHarvests(harvestEvents.map((h) => h.id));
  const harvests: PackHarvestRow[] = [];
  for (const h of [...harvestEvents].sort((a, b) => a.occurredAt - b.occurredAt)) {
    const base = {
      harvestDate: day(h.occurredAt),
      block: blockName(h.blockId),
      crop: cropName(h.cropPluginId) ?? h.cropPluginId,
      harvestQuantity: h.quantity ?? null,
      lot: h.lotNumber ?? null,
      statusAtHarvest: blockStatusAt(h.blockId, h.occurredAt)
    };
    const list = dispositions.get(h.id) ?? [];
    if (list.length === 0) {
      harvests.push({
        ...base,
        where: null,
        quantity: null,
        dispositionDate: null,
        recipient: null,
        soldAsOrganic: null,
        sale: null
      });
      continue;
    }
    for (const d of list) {
      let sale: string | null = null;
      if (d.ledgerEntryId) {
        const entry = getLedgerEntry(d.ledgerEntryId);
        if (!entry || entry.deletedAt) sale = 'Linked sale deleted';
        else sale = forOwner ? `$${(entry.amountCents / 100).toFixed(2)}` : 'yes';
      } else if (!forOwner) {
        sale = 'no';
      }
      harvests.push({
        ...base,
        where: DISPOSITION_KIND_LABEL[d.kind],
        quantity: `${d.quantity} ${d.unit}`,
        dispositionDate: day(d.occurredAt),
        recipient: d.recipient,
        soldAsOrganic: d.soldAsOrganic === null ? null : d.soldAsOrganic ? 'yes' : 'no',
        sale
      });
    }
  }

  // ── 07 documents ──
  const docs = packDocuments(opts.viewer.role, listDocuments());
  const documents: PackDocumentRow[] = docs.map(({ row, meta }) => ({
    id: row.id,
    title: row.title,
    kind: DOCUMENT_KIND_LABEL[row.kind] ?? row.kind,
    bytes: row.byteSize,
    sha256: row.sha256,
    uploaded: day(row.createdAt.getTime()),
    linkedTo: [...new Set(meta.links.map((l) => DOCUMENT_SUBJECT_LABEL[l.subjectType]))].join('; '),
    fileInPack: opts.documents ? packDocumentEntryName(row) : null
  }));

  return {
    farmName: farmNameOf(opts.viewer.activeOwnerId),
    from: opts.from,
    to: opts.to,
    generatedAt: `${formatInstant(now, opts.prefs)}`,
    libraryBuild: libraryBuild(),
    forOwner,
    statuses,
    activity: activity.map(({ atMs: _atMs, ...rest }) => rest),
    inputs: [...inputs.values()].sort((a, b) => a.name.localeCompare(b.name)),
    seed,
    treatments,
    harvests,
    documents
  };
}

function bytesEntry(name: string, bytes: Uint8Array, mtime: Date, crc = crc32(bytes)): ZipEntry {
  return { name, mtime, size: bytes.byteLength, crc32: crc, open: async () => bytes };
}

export interface OrganicPackFiles {
  readme: Uint8Array;
  summary: Uint8Array;
  /** The seven CSV files in pack order, encoded with their CRC (R-09). */
  csv: readonly { name: string; bytes: Uint8Array; crc32: number }[];
}

/** The ZIP entries: README, summary, the seven CSVs, then any documents. */
export function organicPackEntries(
  files: OrganicPackFiles,
  docs: readonly DocumentRow[],
  now: Date,
  open: (doc: DocumentRow) => Promise<ReadableStream<Uint8Array> | null> = openDocument
): { entries: Generator<ZipEntry>; onSkipped: (e: ZipEntry) => void } {
  const enc = new TextEncoder();
  const missing: string[] = [];
  const byName = new Map<string, DocumentRow>();
  function* entries(): Generator<ZipEntry> {
    yield bytesEntry(PACK_FILES.readme, files.readme, now);
    yield bytesEntry(PACK_FILES.summary, files.summary, now);
    for (const file of files.csv) yield bytesEntry(file.name, file.bytes, now, file.crc32);
    for (const doc of docs) {
      const name = packDocumentEntryName(doc);
      byName.set(name, doc);
      yield {
        name,
        mtime: doc.createdAt,
        size: doc.byteSize,
        crc32: doc.crc32,
        open: async () => {
          try {
            return await open(doc);
          } catch {
            return null;
          }
        }
      };
    }
    if (missing.length) {
      yield bytesEntry(
        'documents/MISSING.txt',
        enc.encode(
          'These files are listed in 07-documents.csv but their bytes could not be read, so they are not in this download:\r\n\r\n' +
            missing.join('\r\n') +
            '\r\n'
        ),
        now
      );
    }
  }
  return {
    entries: entries(),
    onSkipped: (e) => {
      const doc = byName.get(e.name);
      missing.push(doc ? `${doc.id}  ${doc.title}` : e.name);
    }
  };
}

/** Contract C-B4: the whole pack as one stream. The caller holds the
 *  per-Owner single flight (B-49) until the stream ends. The README, the
 *  summary PDF and the CSV files are built by the render queue from data
 *  read here (R-09); the ZIP and the vault files stream on this thread. */
export async function streamOrganicPack(
  opts: OrganicPackOptions
): Promise<ReadableStream<Uint8Array>> {
  const now = opts.now ?? new Date();
  const data = await buildOrganicPackData({ ...opts, now });
  const docs = opts.documents
    ? packDocuments(opts.viewer.role, listDocuments()).map((d) => d.row)
    : [];
  const rendered = await runRenderJob(
    {
      kind: 'organic-pack-files',
      input: {
        data,
        exporter: identityLabel(opts.viewer),
        role: opts.viewer.role,
        prefs: opts.prefs,
        nowMs: now.getTime(),
        withDocuments: opts.documents
      }
    },
    { ownerId: opts.viewer.activeOwnerId ?? '', signal: opts.signal }
  );
  if (rendered.kind !== 'organic-pack-files') {
    throw new Error(`render returned ${rendered.kind}, expected organic-pack-files`);
  }
  const { entries, onSkipped } = organicPackEntries(rendered, docs, now);
  return zipStream(entries, { onSkipped });
}

const building = new Set<string>();

/** B-49: one pack build per Owner at a time. */
export function tryStartPack(ownerId: string): (() => void) | null {
  if (building.has(ownerId)) return null;
  building.add(ownerId);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    building.delete(ownerId);
  };
}

/** Releases `release` when the stream finishes, fails or is cancelled. */
export function releaseWhenDone(
  stream: ReadableStream<Uint8Array>,
  release: () => void
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          release();
          controller.close();
        } else controller.enqueue(value);
      } catch (err) {
        release();
        controller.error(err);
      }
    },
    async cancel(reason) {
      release();
      await reader.cancel(reason);
    }
  });
}
