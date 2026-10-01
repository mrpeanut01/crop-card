/**
 * GET /api/account/export.zip — the GDPR export with every stored file
 * (A-40). `export.json` is the same object `export.json` returns; each live
 * document follows as `documents/<id>-<slug>.<ext>`. Streamed, so a large
 * farm never sits in memory. A file whose bytes are gone is skipped and
 * named in `documents/MISSING.txt`.
 */

import type { RequestHandler } from '@sveltejs/kit';
import { listDocuments, type DocumentRow } from '$lib/db/documents';
import { requireUser } from '$lib/server/auth';
import { buildAccountExport } from '$lib/server/accountExport';
import { isInteractiveOwner } from '$lib/server/interactiveOwner';
import { documentRefusal, extensionFor, slugify } from '$lib/server/documentAccess';
import { openDocument } from '$lib/server/vault/documents';
import { crc32, zipStream, type ZipEntry } from '$lib/server/zip';

export function _documentEntryName(doc: Pick<DocumentRow, 'id' | 'title' | 'mime'>): string {
  return `documents/${doc.id}-${slugify(doc.title)}.${extensionFor(doc.mime)}`;
}

function bytesEntry(name: string, bytes: Uint8Array, mtime: Date): ZipEntry {
  return { name, mtime, size: bytes.byteLength, crc32: crc32(bytes), open: async () => bytes };
}

export function _exportEntries(
  json: Uint8Array,
  docs: readonly DocumentRow[],
  now: Date,
  open: (doc: DocumentRow) => Promise<ReadableStream<Uint8Array> | null> = openDocument
): { entries: Generator<ZipEntry>; onSkipped: (e: ZipEntry) => void } {
  const missing: string[] = [];
  const byName = new Map<string, DocumentRow>();
  function* entries(): Generator<ZipEntry> {
    yield bytesEntry('export.json', json, now);
    for (const doc of docs) {
      const name = _documentEntryName(doc);
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
      const text =
        'These files are listed in export.json but their bytes could not be read, so they are not in this download:\n\n' +
        missing.join('\n') +
        '\n';
      yield bytesEntry('documents/MISSING.txt', new TextEncoder().encode(text), now);
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

export const GET: RequestHandler = async (event) => {
  const user = requireUser(event);
  if (!isInteractiveOwner(event, user)) {
    return documentRefusal(
      403,
      'INTERACTIVE_OWNER_ONLY',
      'Only the owner, signed in on their own account, can download the full export.'
    );
  }
  const payload = await buildAccountExport(event);
  const json = new TextEncoder().encode(JSON.stringify(payload, null, 2));
  const docs = listDocuments();
  const now = new Date();
  const { entries, onSkipped } = _exportEntries(json, docs, now);
  return new Response(zipStream(entries, { onSkipped }), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="cropcard-export-${now.toISOString().slice(0, 10)}.zip"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
};
