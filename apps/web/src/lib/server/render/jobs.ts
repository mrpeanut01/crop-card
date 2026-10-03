/**
 * Contract C-R1: the render jobs and the one executor that runs them, in
 * the worker (thread mode) or on the main thread (inline mode, R-10). Pure:
 * no database, no vault, no environment (R-07, R-08). pdfmake is loaded
 * lazily so the main thread only pulls it in for inline renders.
 */

import type { Prefs } from '$lib/prefs';
import type { AuthenticatedUser } from '$lib/server/auth';
import { packCsvFiles, packReadme, type PackData } from '$lib/records/organicPack';
import { crc32 } from '$lib/server/zip';
import { materializeDocDef, type PdfJobDoc } from './pdfSpec';
import { organicPackSummaryDoc } from './docs/organicPackSummary';

export interface OrganicPackFilesInput {
  data: PackData;
  /** The viewer's `identityLabel`. */
  exporter: string;
  role: AuthenticatedUser['role'];
  prefs: Prefs;
  nowMs: number;
  withDocuments: boolean;
}

export type RenderJob =
  | { kind: 'pdf'; spec: PdfJobDoc }
  | { kind: 'json-bytes'; value: unknown; space: 2 }
  | { kind: 'organic-pack-files'; input: OrganicPackFilesInput };

export type RenderResult =
  | { kind: 'pdf'; bytes: Uint8Array }
  | { kind: 'json-bytes'; bytes: Uint8Array; crc32: number }
  | {
      kind: 'organic-pack-files';
      readme: Uint8Array;
      summary: Uint8Array;
      csv: { name: string; bytes: Uint8Array; crc32: number }[];
    };

const STANDARD_FONTS = new Set([
  'Helvetica',
  'Helvetica-Bold',
  'Helvetica-Oblique',
  'Helvetica-BoldOblique'
]);

type PdfMake = typeof import('pdfmake').default;
let pdfmakeReady: Promise<PdfMake> | null = null;

function loadPdfmake(): Promise<PdfMake> {
  pdfmakeReady ??= import('pdfmake').then((mod) => {
    const pdfmake = (mod.default ?? mod) as PdfMake;
    pdfmake.setFonts({
      Roboto: {
        normal: 'Helvetica',
        bold: 'Helvetica-Bold',
        italics: 'Helvetica-Oblique',
        bolditalics: 'Helvetica-BoldOblique'
      }
    });
    // Exports never embed remote or on-disk resources; pdfmake 0.3 treats
    // the PDF standard font names as local paths, so only those are allowed.
    pdfmake.setUrlAccessPolicy(() => false);
    pdfmake.setLocalAccessPolicy((path) => STANDARD_FONTS.has(path));
    return pdfmake;
  });
  return pdfmakeReady;
}

/** Loads pdfmake up front, so a worker that cannot render fails at start
 *  instead of on its first job. */
export async function preloadRenderer(): Promise<void> {
  await loadPdfmake();
}

/** A copy that owns its whole ArrayBuffer, so transferring it never
 *  detaches a shared Buffer pool. */
function ownBytes(u8: Uint8Array): Uint8Array {
  if (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength) return u8;
  return new Uint8Array(u8);
}

async function renderPdfBytes(spec: PdfJobDoc): Promise<Uint8Array> {
  const pdfmake = await loadPdfmake();
  const buf = await pdfmake.createPdf(materializeDocDef(spec)).getBuffer();
  return ownBytes(buf);
}

const encoder = new TextEncoder();

export async function executeRenderJob(job: RenderJob): Promise<RenderResult> {
  switch (job.kind) {
    case 'pdf':
      return { kind: 'pdf', bytes: await renderPdfBytes(job.spec) };
    case 'json-bytes': {
      const bytes = encoder.encode(JSON.stringify(job.value, null, job.space));
      return { kind: 'json-bytes', bytes, crc32: crc32(bytes) };
    }
    case 'organic-pack-files': {
      const { data, withDocuments } = job.input;
      const now = new Date(job.input.nowMs);
      const summary = await renderPdfBytes(
        organicPackSummaryDoc(data, {
          exporter: job.input.exporter,
          prefs: job.input.prefs,
          now,
          withDocuments
        })
      );
      const csv = Object.entries(packCsvFiles(data)).map(([name, text]) => {
        const bytes = encoder.encode(text);
        return { name, bytes, crc32: crc32(bytes) };
      });
      return {
        kind: 'organic-pack-files',
        readme: encoder.encode(packReadme(data, { withDocuments })),
        summary,
        csv
      };
    }
  }
}

/** The buffers a result can hand over without copying. */
export function transferablesOf(result: RenderResult): ArrayBuffer[] {
  const list: Uint8Array[] =
    result.kind === 'organic-pack-files'
      ? [result.readme, result.summary, ...result.csv.map((c) => c.bytes)]
      : [result.bytes];
  return [...new Set(list.map((u) => u.buffer as ArrayBuffer))];
}
