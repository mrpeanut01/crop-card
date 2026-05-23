/**
 * POST /api/plugins/search-by-name/stream
 *
 * Streaming variant of `/api/plugins/search-by-name` for the AI Lookup
 * button. Emits Server-Sent Events as Claude progresses through web_search
 * → text generation so the UI can show live status ("Searching for …",
 * "Got 3 sources back", "Building candidates", "Validating", "Done").
 *
 * Frame format: `data: <json>\n\n` per SSE spec. Each frame carries one
 * `SearchStreamEvent`. The final frame is always `phase: 'complete'`
 * (or `phase: 'error'` on failure).
 */

import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { requireOwner } from '$lib/server/auth';
import { checkGuard, recordCall } from '$lib/server/aiGuard';
import {
  AnthropicOverloadedError,
  claudePluginSearchByNameStreaming,
  type PluginKindHint,
  type SearchStreamEvent
} from '$lib/server/aiPluginScan';

const PLUGIN_KIND_HINTS = [
  'crop',
  'herbicide',
  'insecticide',
  'fungicide',
  'fertilizer',
  'companion'
] as const;

const requestSchema = z.object({
  query: z.string().min(2).max(120),
  hintType: z.enum(PLUGIN_KIND_HINTS).optional()
});

function encodeFrame(event: SearchStreamEvent | { phase: 'error'; message: string }): Uint8Array {
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

  const guard = checkGuard(session.id, 'plugin-search');
  if (!guard.ok) {
    const headers = { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' };
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encodeFrame({ phase: 'error', message: guard.message }));
        controller.close();
      }
    });
    return new Response(stream, { headers, status: 200 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: SearchStreamEvent) => {
        try {
          controller.enqueue(encodeFrame(e));
        } catch {
          // controller already closed (client disconnected); swallow.
        }
      };

      try {
        const { meta, candidates } = await claudePluginSearchByNameStreaming(
          parsed.data.query,
          parsed.data.hintType as PluginKindHint | undefined,
          send
        );
        recordCall({
          userId: session.id,
          endpoint: 'plugin-search',
          model: meta.model,
          inputTokens: meta.inputTokens,
          cachedInputTokens: meta.cachedInputTokens,
          outputTokens: meta.outputTokens,
          usdEstimate: meta.usdEstimate,
          success: candidates.length > 0
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
          endpoint: 'plugin-search',
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
