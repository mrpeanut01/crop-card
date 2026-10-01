import type { DocumentMeta } from './apiSchemas';
import type { DocumentKind, DocumentSubjectType } from './kinds';
import { VAULT_OFF_COPY } from './kinds';

export type UploadResult =
  { ok: true; document: DocumentMeta } | { ok: false; code: string; message: string };

const OFFLINE_COPY = 'Uploads need a connection.';

/** Sends one file as the raw request body (A-29). */
export async function uploadDocument(
  file: File,
  opts: {
    kind: DocumentKind;
    title?: string;
    subject?: { type: DocumentSubjectType; id: string };
    fetchImpl?: typeof fetch;
  }
): Promise<UploadResult> {
  const params = new URLSearchParams({ kind: opts.kind, name: file.name.slice(0, 200) });
  if (opts.title?.trim()) params.set('title', opts.title.trim().slice(0, 120));
  if (opts.subject) {
    params.set('subjectType', opts.subject.type);
    params.set('subjectId', opts.subject.id);
  }
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(`/api/documents?${params}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: file
    });
  } catch {
    return { ok: false, code: 'OFFLINE', message: OFFLINE_COPY };
  }
  const body = (await res.json().catch(() => ({}))) as {
    document?: DocumentMeta;
    code?: string;
    error?: string;
  };
  if (res.ok && body.document) return { ok: true, document: body.document };
  return {
    ok: false,
    code: body.code ?? `HTTP_${res.status}`,
    message: refusalCopy(res.status, body)
  };
}

export function refusalCopy(status: number, body: { code?: string; error?: string }): string {
  if (body.code === 'VAULT_OFF') return VAULT_OFF_COPY;
  if (body.code === 'OWNER_ONLY' || status === 403) return 'Only the farm owner can upload files.';
  if (body.error && body.code && body.code !== 'INVALID') return body.error;
  if (status === 413) return 'This file is bigger than 20 MB. Use a smaller file.';
  return "We couldn't save this file. Try again.";
}

export function fileHref(documentId: string): string {
  return `/api/documents/${encodeURIComponent(documentId)}/file`;
}
