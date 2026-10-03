/**
 * The render worker's entry (R-08). Runs one job at a time for the queue in
 * `queue.ts` and answers with the bytes, their buffers transferred. It never
 * opens the database: it only sees the plain data each job carries.
 */

import { parentPort } from 'node:worker_threads';
import { executeRenderJob, preloadRenderer, transferablesOf, type RenderJob } from './jobs';
import type { WorkerReply } from './protocol';

const port = parentPort;
if (port) {
  port.on('message', async (msg: { id: number; job: RenderJob }) => {
    try {
      const result = await executeRenderJob(msg.job);
      const reply: WorkerReply = { type: 'done', id: msg.id, result };
      port.postMessage(reply, transferablesOf(result));
    } catch (e) {
      const reply: WorkerReply = {
        type: 'error',
        id: msg.id,
        message: e instanceof Error ? e.message : String(e)
      };
      port.postMessage(reply);
    }
  });
  preloadRenderer().then(
    () => port.postMessage({ type: 'ready' } satisfies WorkerReply),
    (e) => {
      port.postMessage({
        type: 'fatal',
        message: e instanceof Error ? e.message : String(e)
      } satisfies WorkerReply);
      process.exit(1);
    }
  );
}
