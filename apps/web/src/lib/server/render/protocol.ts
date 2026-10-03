import type { RenderJob, RenderResult } from './jobs';

export interface WorkerRequest {
  id: number;
  job: RenderJob;
}

export type WorkerReply =
  | { type: 'ready' }
  | { type: 'fatal'; message: string }
  | { type: 'done'; id: number; result: RenderResult }
  | { type: 'error'; id: number; message: string };
