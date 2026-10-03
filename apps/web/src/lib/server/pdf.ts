/**
 * Every compliance PDF goes through here (R-01). The document arrives as a
 * plain `PdfJobDoc` and is rendered by the render queue: in the worker in
 * production, on this thread in dev and tests (R-10). Throws
 * `RenderRefused` when the queue says no; see `render/refusal.ts`.
 */

import type { PdfJobDoc } from '$lib/server/render/pdfSpec';
import { runRenderJob } from '$lib/server/render/queue';

export type { PdfJobDoc };

export async function renderPdf(
  spec: PdfJobDoc,
  ctx: { ownerId: string; signal?: AbortSignal }
): Promise<Buffer> {
  const result = await runRenderJob({ kind: 'pdf', spec }, ctx);
  if (result.kind !== 'pdf') throw new Error(`render returned ${result.kind}, expected pdf`);
  return Buffer.from(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength);
}
