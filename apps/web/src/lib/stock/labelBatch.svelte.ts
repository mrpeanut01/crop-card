import { draftFromScanResult, type StockEntryDraft } from '$lib/stock/normalizeStockEntry';

export type BatchStatus = 'queued' | 'reading' | 'done' | 'failed' | 'saved';

export interface BatchRow {
  id: string;
  file: File;
  name: string;
  thumbUrl: string | null;
  status: BatchStatus;
  draft: StockEntryDraft | null;
  error: string | null;
}

export type ScanOutcome =
  | { ok: true; draft: StockEntryDraft }
  | { ok: false; stop: boolean; message: string };

export const MAX_BATCH_FILES = 30;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const STOP_REASONS = new Set(['no-key', 'over-cap', 'rate-limit', 'offline']);
const STOP_STATUSES = new Set([401, 402, 403, 429]);
const NO_KEY_RE = /No Anthropic API key configured/i;
const CAP_RE = /\b(cap|quota)\b.*\b(reached|exceeded)\b|\bover[- ]cap\b|rate[- ]limit/i;

export function isNoKeyMessage(message: string | null | undefined): boolean {
  return !!message && NO_KEY_RE.test(message);
}

/** Classify a /api/scan-label response. A `stop` outcome means every
 *  later file would fail the same way (no key, spend cap, quota,
 *  offline), so the queue halts instead of burning through the batch. */
export function classifyScanResponse(status: number, body: unknown): ScanOutcome {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const message =
    (typeof b.message === 'string' && b.message) ||
    (typeof b.error === 'string' && b.error) ||
    null;
  const reason = typeof b.fallbackReason === 'string' ? b.fallbackReason : null;

  if (reason && STOP_REASONS.has(reason)) {
    return { ok: false, stop: true, message: message ?? stopMessageFor(reason) };
  }
  if (status < 200 || status >= 300) {
    const msg = message ?? `HTTP ${status}`;
    const stop = STOP_STATUSES.has(status) || NO_KEY_RE.test(msg) || CAP_RE.test(msg);
    return { ok: false, stop, message: msg };
  }
  if (message && (NO_KEY_RE.test(message) || CAP_RE.test(message)) && b.found !== true) {
    return { ok: false, stop: true, message };
  }
  if (b.found !== true) {
    return {
      ok: false,
      stop: false,
      message:
        message ??
        'Claude could not identify the product. Try a clearer photo, the Barcode scanner, or Manual entry.'
    };
  }
  return {
    ok: true,
    draft: draftFromScanResult(b as Parameters<typeof draftFromScanResult>[0], 'ai')
  };
}

function stopMessageFor(reason: string): string {
  if (reason === 'no-key') return 'No Anthropic API key configured.';
  if (reason === 'over-cap') return 'Monthly AI spend cap reached.';
  if (reason === 'rate-limit') return 'Claude is rate-limited right now.';
  return 'You appear to be offline.';
}

export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('file read failed'));
    r.readAsDataURL(file);
  });
}

export interface LabelBatchDeps {
  fetch: typeof fetch;
  readAsDataUrl: (file: File) => Promise<string>;
  createThumb: (file: File) => string | null;
  revokeThumb: (url: string) => void;
}

function defaultDeps(): LabelBatchDeps {
  const hasObjectUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
  return {
    fetch: (...args) => fetch(...args),
    readAsDataUrl,
    createThumb: (file) => (hasObjectUrl ? URL.createObjectURL(file) : null),
    revokeThumb: (url) => {
      if (hasObjectUrl) URL.revokeObjectURL(url);
    }
  };
}

let seq = 0;

/** Sequential (concurrency = 1) label-scan queue for batch unboxing
 *  (#249). Each file is one POST to /api/scan-label, so the server's
 *  aiGuard meters and audits every call individually. Drafts are only
 *  held here — persistence happens one item at a time through the
 *  canonical inventory form. */
export class LabelBatch {
  rows = $state<BatchRow[]>([]);
  running = $state(false);
  stopMessage = $state<string | null>(null);
  overflow = $state(0);

  readonly #deps: LabelBatchDeps;

  constructor(deps: Partial<LabelBatchDeps> = {}) {
    this.#deps = { ...defaultDeps(), ...deps };
  }

  get counts(): Record<BatchStatus, number> {
    const c: Record<BatchStatus, number> = { queued: 0, reading: 0, done: 0, failed: 0, saved: 0 };
    for (const r of this.rows) c[r.status] += 1;
    return c;
  }

  get stopped(): boolean {
    return this.stopMessage !== null;
  }

  get stoppedOnNoKey(): boolean {
    return isNoKeyMessage(this.stopMessage);
  }

  nextReviewable(excludeId?: string): BatchRow | undefined {
    return this.rows.find((r) => r.status === 'done' && r.id !== excludeId);
  }

  add(files: Iterable<File>): void {
    const room = MAX_BATCH_FILES - this.rows.length;
    const list = Array.from(files);
    this.overflow = Math.max(0, list.length - Math.max(0, room));
    for (const file of list.slice(0, Math.max(0, room))) {
      const tooBig = file.size > MAX_FILE_BYTES;
      this.rows.push({
        id: `lb-${++seq}`,
        file,
        name: file.name || 'photo',
        thumbUrl: this.#deps.createThumb(file),
        status: tooBig ? 'failed' : 'queued',
        draft: null,
        error: tooBig ? 'File is larger than 10 MB — resize it or take a new photo.' : null
      });
    }
  }

  async run(): Promise<void> {
    if (this.running) return;
    this.stopMessage = null;
    this.running = true;
    try {
      for (;;) {
        const row = this.rows.find((r) => r.status === 'queued');
        if (!row) break;
        await this.#process(row.id);
        if (this.stopMessage) break;
      }
    } finally {
      this.running = false;
    }
  }

  retry(id: string): Promise<void> {
    const row = this.#row(id);
    if (!row || row.status !== 'failed' || row.file.size > MAX_FILE_BYTES) {
      return Promise.resolve();
    }
    row.status = 'queued';
    row.error = null;
    return this.run();
  }

  discard(id: string): void {
    const row = this.#row(id);
    if (!row || row.status === 'reading') return;
    if (row.thumbUrl) this.#deps.revokeThumb(row.thumbUrl);
    this.rows = this.rows.filter((r) => r.id !== id);
  }

  markSaved(id: string): void {
    const row = this.#row(id);
    if (row && row.status === 'done') row.status = 'saved';
  }

  clear(): void {
    if (this.running) return;
    for (const r of this.rows) if (r.thumbUrl) this.#deps.revokeThumb(r.thumbUrl);
    this.rows = [];
    this.stopMessage = null;
    this.overflow = 0;
  }

  #row(id: string): BatchRow | undefined {
    return this.rows.find((r) => r.id === id);
  }

  async #process(id: string): Promise<void> {
    const row = this.#row(id);
    if (!row) return;
    row.status = 'reading';
    row.error = null;
    let outcome: ScanOutcome;
    try {
      const image = await this.#deps.readAsDataUrl(row.file);
      const res = await this.#deps.fetch('/api/scan-label', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image })
      });
      const body = await res.json().catch(() => null);
      outcome = classifyScanResponse(res.status, body);
    } catch (err) {
      const offline = err instanceof TypeError;
      outcome = {
        ok: false,
        stop: offline,
        message: offline
          ? 'Network error — you may be offline. Remaining photos were not sent.'
          : err instanceof Error
            ? err.message
            : String(err)
      };
    }
    const current = this.#row(id);
    if (!current) return;
    if (outcome.ok) {
      current.status = 'done';
      current.draft = outcome.draft;
    } else {
      current.status = 'failed';
      current.error = outcome.message;
      if (outcome.stop) this.stopMessage = outcome.message;
    }
  }
}
