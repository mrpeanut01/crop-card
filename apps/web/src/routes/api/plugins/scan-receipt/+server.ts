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
 * count. The receipt's hold shrinks to what it has spent so far, each line
 * lookup reserves again under 'plugin-search', and a line is skipped once
 * the budget is out.
 */

import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { requireOwner } from '$lib/server/auth';
import { recordCall, reserveGuard } from '$lib/server/aiGuard';
import { recordFallback, tryAiWithGuard } from '$lib/server/aiDegrade';
import type { FallbackReason } from '$lib/server/aiTry';
import { claudeReceiptScanStreaming, type ReceiptStreamEvent } from '$lib/server/aiPluginScan';

const requestSchema = z.object({
  /** Base64-encoded payload (no data: prefix). */
  document: z.string().min(1),
  /** MIME type. PDFs go through Anthropic's document content block;
   *  JPEG/PNG go through the image content block. */
  mediaType: z.enum(['image/jpeg', 'image/png', 'application/pdf'])
});

type ErrorFrame = {
  phase: 'error';
  message: string;
  provenance?: 'fallback';
  fallbackReason?: FallbackReason;
};

function encodeFrame(event: ReceiptStreamEvent | ErrorFrame): Uint8Array {
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
        const tried = await tryAiWithGuard({
          endpoint: 'plugin-batch-scan',
          userId: session.id,
          timeoutMs: 120_000,
          prompt: (_signal, hold) =>
            claudeReceiptScanStreaming(
              parsed.data.document,
              parsed.data.mediaType,
              send,
              (receiptUsd) => {
                hold?.adjust(receiptUsd);
                const line = reserveGuard(session.id, 'plugin-search');
                if (!line.ok) return null;
                return () => line.hold?.release();
              }
            )
        });
        if (tried.provenance === 'fallback') {
          recordFallback(
            session.id,
            'plugin-batch-scan',
            tried.fallbackReason,
            tried.error instanceof Error ? tried.error.name : undefined
          );
          controller.enqueue(
            encodeFrame({
              phase: 'error',
              message: tried.fallbackMessage,
              provenance: 'fallback',
              fallbackReason: tried.fallbackReason
            })
          );
          return;
        }
        const { meta, proposed } = tried.value;
        recordCall({
          userId: session.id,
          endpoint: 'plugin-batch-scan',
          model: meta.model,
          inputTokens: meta.inputTokens,
          cachedInputTokens: meta.cachedInputTokens,
          outputTokens: meta.outputTokens,
          usdEstimate: meta.usdEstimate,
          success: proposed.length > 0,
          provenance: 'ai'
        });
      } catch {
        /* client disconnected */
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
