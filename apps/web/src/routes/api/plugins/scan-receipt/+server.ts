/**
 * POST /api/plugins/scan-receipt
 *
 * Path C — operator uploads a vendor receipt / invoice / packing list /
 * order confirmation as an image or PDF. Server extracts line items via
 * Claude vision, then enriches each line via the existing web_search path
 * to produce plugin candidates the operator can review + bulk-commit.
 *
 * Returns Server-Sent Events so the UI can render per-line progress:
 *   - phase: 'extracting' → vision pass running
 *   - phase: 'extracted'  → got N lines, starting per-line enrichment
 *   - phase: 'enriching'  → looking up line K of N
 *   - phase: 'enriched'   → line K candidate ready (or null)
 *   - phase: 'complete'   → all done; full proposed[] payload
 *
 * Quota: ONE 'plugin-batch-scan' call per receipt regardless of line
 * count. Per-line enrichment uses the existing 'plugin-search' quota.
 */

import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { requireOwner } from '$lib/server/auth';
import { checkGuard, recordCall } from '$lib/server/aiGuard';
import {
  AnthropicOverloadedError,
  claudeReceiptScanStreaming,
  type ReceiptStreamEvent
} from '$lib/server/aiPluginScan';

const requestSchema = z.object({
  /** Base64-encoded payload (no data: prefix). */
  document: z.string().min(1),
  /** MIME type. PDFs go through Anthropic's document content block;
   *  JPEG/PNG go through the image content block. */
  mediaType: z.enum(['image/jpeg', 'image/png', 'application/pdf'])
});

function encodeFrame(event: ReceiptStreamEvent | { phase: 'error'; message: string }): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export const POST: RequestHandler = async (event) => {
  const session = requireOwner(event);
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return new Response('invalid JSON body', { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response('invalid request', { status: 400 });
  }

  const guard = checkGuard(session.id, 'plugin-batch-scan');
  if (!guard.ok) {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encodeFrame({ phase: 'error', message: guard.message }));
        controller.close();
      }
    });
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: ReceiptStreamEvent) => {
        try {
          controller.enqueue(encodeFrame(e));
        } catch {
          /* client disconnected */
        }
      };

      try {
        const { meta, proposed } = await claudeReceiptScanStreaming(
          parsed.data.document,
          parsed.data.mediaType,
          send
        );
        recordCall({
          userId: session.id,
          endpoint: 'plugin-batch-scan',
          model: meta.model,
          inputTokens: meta.inputTokens,
          cachedInputTokens: meta.cachedInputTokens,
          outputTokens: meta.outputTokens,
          usdEstimate: meta.usdEstimate,
          success: proposed.length > 0
        });
      } catch (err) {
        const message =
          err instanceof AnthropicOverloadedError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        send({ phase: 'error', message });
        recordCall({
          userId: session.id,
          endpoint: 'plugin-batch-scan',
          model: 'unknown',
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          usdEstimate: 0,
          success: false,
          errorClass: err instanceof Error ? err.name : 'unknown'
        });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no'
    }
  });
};
