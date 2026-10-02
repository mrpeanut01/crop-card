/**
 * 33B (plan item 7, B-43 to B-47): the certifier pack's CSV files and
 * README, from rows the server has already resolved. Pure. Every CSV's
 * first row is the one-cell preamble "Prepared from records kept in
 * CropCard. This is not a certification." and its column header is row 2.
 * Facts only: no status is inferred, nothing says a record qualifies.
 */

import { csvDocument, PACK_PREAMBLE, type CsvValue } from './packCsv';
import { treatmentLogCsv, type TreatmentLogRow } from './animalTreatmentLog';

export const PACK_FILES = {
  readme: 'README.txt',
  summary: 'summary.pdf',
  statuses: '01-statuses.csv',
  activity: '02-activity.csv',
  inputs: '03-inputs.csv',
  seed: '04-seed-sourcing.csv',
  treatments: '05-animal-treatments.csv',
  harvests: '06-harvests.csv',
  documents: '07-documents.csv'
} as const;

export interface PackStatusRow {
  subjectType: string;
  name: string;
  area: string | null;
  status: string | null;
  effective: string | null;
  certifier: string | null;
  note: string | null;
  enteredBy: string | null;
  enteredOn: string | null;
  documents: string | null;
  /** The B-14 line in force today, blank when none. */
  inForceToday: string | null;
}

export interface PackActivityRow {
  date: string;
  activity: string;
  block: string | null;
  area: string | null;
  crop: string | null;
  detail: string | null;
  pluginId: string | null;
  libraryMark: string | null;
  /** The block's B-14 line at the record's date, blank when none. */
  blockStatus: string | null;
  savedLate: string | null;
}

export interface PackInputRow {
  name: string;
  type: string;
  pluginId: string | null;
  epaRegistrationNumber: string | null;
  complianceFlags: string;
  libraryMark: string;
  provenance: 'plugin' | 'manual';
  uses: number;
}

export interface PackSeedRow {
  item: string;
  lot: string | null;
  supplier: string | null;
  received: string;
  seedStatus: string;
  sourcesChecked: string;
  unavailabilityNote: string | null;
  flag: string | null;
  documents: string | null;
}

export interface PackHarvestRow {
  harvestDate: string;
  block: string | null;
  crop: string;
  harvestQuantity: string | null;
  lot: string | null;
  statusAtHarvest: string | null;
  where: string | null;
  quantity: string | null;
  dispositionDate: string | null;
  recipient: string | null;
  soldAsOrganic: string | null;
  /** Owner: the amount ("$12.00", "Linked sale deleted"); inspector: yes or no. */
  sale: string | null;
}

export interface PackDocumentRow {
  id: string;
  title: string;
  kind: string;
  bytes: number;
  sha256: string;
  uploaded: string;
  linkedTo: string;
  fileInPack: string | null;
}

export interface PackData {
  farmName: string;
  from: string;
  to: string;
  generatedAt: string;
  libraryBuild: string;
  /** Owner downloads carry sale amounts (B-47). */
  forOwner: boolean;
  statuses: PackStatusRow[];
  activity: PackActivityRow[];
  inputs: PackInputRow[];
  seed: PackSeedRow[];
  treatments: TreatmentLogRow[];
  harvests: PackHarvestRow[];
  documents: PackDocumentRow[];
}

const P = { preamble: true };

export function statusesCsv(rows: readonly PackStatusRow[]): string {
  return csvDocument(
    [
      'Subject',
      'Name',
      'Area',
      'Status (owner-entered)',
      'Effective',
      'Certifier',
      'Note',
      'Entered by',
      'Entered on',
      'Documents',
      'Status in force today'
    ],
    rows.map((r): CsvValue[] => [
      r.subjectType,
      r.name,
      r.area,
      r.status,
      r.effective,
      r.certifier,
      r.note,
      r.enteredBy,
      r.enteredOn,
      r.documents,
      r.inForceToday
    ]),
    P
  );
}

export function activityCsv(rows: readonly PackActivityRow[]): string {
  return csvDocument(
    [
      'Date',
      'Activity',
      'Block',
      'Area',
      'Crop',
      'Product or detail',
      'Plugin id',
      'Library mark',
      'Block status at the time (owner-entered)',
      'Saved late'
    ],
    rows.map((r): CsvValue[] => [
      r.date,
      r.activity,
      r.block,
      r.area,
      r.crop,
      r.detail,
      r.pluginId,
      r.libraryMark,
      r.blockStatus,
      r.savedLate
    ]),
    P
  );
}

export function inputsCsv(rows: readonly PackInputRow[]): string {
  return csvDocument(
    [
      'Input',
      'Type',
      'Plugin id',
      'EPA registration number',
      'Compliance flags as stored',
      'Library mark',
      'Provenance',
      'Times used in window'
    ],
    rows.map((r): CsvValue[] => [
      r.name,
      r.type,
      r.pluginId,
      r.epaRegistrationNumber,
      r.complianceFlags,
      r.libraryMark,
      r.provenance,
      r.uses
    ]),
    P
  );
}

export function seedCsv(rows: readonly PackSeedRow[]): string {
  return csvDocument(
    [
      'Seed',
      'Lot',
      'Supplier',
      'Received',
      'Seed status (owner-entered)',
      'Sources checked',
      'Commercial unavailability note',
      'Flag',
      'Documents'
    ],
    rows.map((r): CsvValue[] => [
      r.item,
      r.lot,
      r.supplier,
      r.received,
      r.seedStatus,
      r.sourcesChecked,
      r.unavailabilityNote,
      r.flag,
      r.documents
    ]),
    P
  );
}

export function harvestsCsv(rows: readonly PackHarvestRow[], forOwner: boolean): string {
  return csvDocument(
    [
      'Harvest date',
      'Block',
      'Crop',
      'Harvest quantity',
      'Lot',
      'Block status at harvest (owner-entered)',
      'Where it went',
      'Quantity',
      'Date',
      'Recipient',
      'Sold as organic',
      forOwner ? 'Sale amount' : 'Sale recorded'
    ],
    rows.map((r): CsvValue[] => [
      r.harvestDate,
      r.block,
      r.crop,
      r.harvestQuantity,
      r.lot,
      r.statusAtHarvest,
      r.where,
      r.quantity,
      r.dispositionDate,
      r.recipient,
      r.soldAsOrganic,
      r.sale
    ]),
    P
  );
}

export function documentsCsv(rows: readonly PackDocumentRow[]): string {
  return csvDocument(
    [
      'Document id',
      'Title',
      'Kind',
      'Bytes',
      'SHA-256',
      'Uploaded',
      'Linked to',
      'File in this pack'
    ],
    rows.map((r): CsvValue[] => [
      r.id,
      r.title,
      r.kind,
      r.bytes,
      r.sha256,
      r.uploaded,
      r.linkedTo,
      r.fileInPack
    ]),
    P
  );
}

export function packCsvFiles(data: PackData): Record<string, string> {
  return {
    [PACK_FILES.statuses]: statusesCsv(data.statuses),
    [PACK_FILES.activity]: activityCsv(data.activity),
    [PACK_FILES.inputs]: inputsCsv(data.inputs),
    [PACK_FILES.seed]: seedCsv(data.seed),
    [PACK_FILES.treatments]: treatmentLogCsv(data.treatments, { preamble: true }),
    [PACK_FILES.harvests]: harvestsCsv(data.harvests, data.forOwner),
    [PACK_FILES.documents]: documentsCsv(data.documents)
  };
}

export function packReadme(data: PackData, opts: { withDocuments: boolean }): string {
  const lines = [
    PACK_PREAMBLE,
    '',
    `Farm: ${data.farmName}`,
    `Records from ${data.from} to ${data.to}. Organic status history is complete, not limited to these dates.`,
    `Prepared ${data.generatedAt}.`,
    `Library marks are read from the plugin library in ${data.libraryBuild} on the day this pack was prepared, not as they read when each record was saved.`,
    '',
    'Every organic status in this pack was entered by the farm owner. CropCard does not decide whether land, animals or crops qualify. Ask your certifier.',
    '',
    'Files:',
    `  ${PACK_FILES.summary}  A summary of this pack.`,
    `  ${PACK_FILES.statuses}  Every growing Area, block, animal and group with its owner-entered status history. A blank status means none is on file.`,
    `  ${PACK_FILES.activity}  Every application, planting, seed start, fertility application, harvest and hay cutting in the window.`,
    `  ${PACK_FILES.inputs}  Each input used in the window, with its EPA registration number and the library's compliance flags as stored.`,
    `  ${PACK_FILES.seed}  Seed lots received or planted in the window, with the owner's seed status and suppliers checked.`,
    `  ${PACK_FILES.treatments}  The animal treatment log: one row per dose.`,
    `  ${PACK_FILES.harvests}  Harvests and where they went.`,
    `  ${PACK_FILES.documents}  An index of linked documents.`,
    ...(opts.withDocuments
      ? ['  documents/  The linked documents themselves, named <id>-<title>.']
      : []),
    '',
    'In every CSV file the first row is the line above ("Prepared from records kept in CropCard. This is not a certification.") and the column names are on row 2.',
    'A record marked "Saved N days after its date" reached the server more than 48 hours after the date it records, for example from a phone that was offline.',
    ''
  ];
  return lines.join('\r\n');
}
