import { describe, it, expect, vi } from 'vitest';
import {
  LabelBatch,
  MAX_BATCH_FILES,
  MAX_FILE_BYTES,
  classifyScanResponse,
  type LabelBatchDeps
} from './labelBatch.svelte';

function file(name: string, size = 10): File {
  const f = new File(['x'], name, { type: 'image/jpeg' });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

const found = (name: string) => ({
  found: true,
  source: 'claude-vision',
  displayName: name,
  category: 'herbicide'
});

function makeBatch(responder: (i: number, image: string) => Response | Promise<Response>) {
  let call = 0;
  const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const { image } = JSON.parse(String(init?.body));
    return responder(call++, image);
  });
  const deps: Partial<LabelBatchDeps> = {
    fetch: fetchMock as unknown as typeof fetch,
    readAsDataUrl: async (f) => `data:image/jpeg;base64,${f.name}`,
    createThumb: () => null,
    revokeThumb: () => {}
  };
  return { batch: new LabelBatch(deps), fetchMock };
}

describe('classifyScanResponse', () => {
  it('turns a found result into an ai-sourced draft', () => {
    const out = classifyScanResponse(200, found('Roundup'));
    expect(out).toEqual({
      ok: true,
      draft: expect.objectContaining({ displayName: 'Roundup', source: 'ai' })
    });
  });

  it('treats found:false as a per-row failure that does not stop the queue', () => {
    const out = classifyScanResponse(200, { found: false, source: 'none' });
    expect(out).toMatchObject({ ok: false, stop: false });
  });

  it.each([
    [402, { error: 'Monthly AI cap of $5.00 reached ($5.01 spent).' }],
    [429, { error: 'Daily quota for label scans exhausted' }],
    [400, { message: 'No Anthropic API key configured' }],
    [200, { found: false, fallbackReason: 'no-key' }],
    [200, { found: false, fallbackReason: 'over-cap' }],
    [200, { found: false, fallbackReason: 'rate-limit' }],
    [200, { found: false, message: 'No Anthropic API key configured' }]
  ])('status %i %j stops the queue', (status, body) => {
    expect(classifyScanResponse(status, body)).toMatchObject({ ok: false, stop: true });
  });

  it('a timeout fallback or a 503 fails the row but keeps going', () => {
    expect(classifyScanResponse(200, { found: false, fallbackReason: 'timeout' })).toMatchObject({
      ok: false,
      stop: false
    });
    expect(classifyScanResponse(503, { message: 'Anthropic overloaded' })).toMatchObject({
      ok: false,
      stop: false,
      message: 'Anthropic overloaded'
    });
  });

  it('gives the no-key reason an honest default message', () => {
    const out = classifyScanResponse(200, { found: false, fallbackReason: 'no-key' });
    expect(out).toMatchObject({ message: expect.stringMatching(/No Anthropic API key/) });
  });
});

describe('LabelBatch', () => {
  it('processes files strictly one at a time, in order', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const { batch, fetchMock } = makeBatch(async (_i, image) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return jsonResponse(200, found(image.split(',')[1]));
    });
    batch.add([file('a.jpg'), file('b.jpg'), file('c.jpg')]);
    await batch.run();
    expect(maxInFlight).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(batch.rows.map((r) => r.status)).toEqual(['done', 'done', 'done']);
    expect(batch.rows.map((r) => r.draft?.displayName)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    for (const [url] of fetchMock.mock.calls) expect(url).toBe('/api/scan-label');
  });

  it('a no-key failure on file 2 stops the queue with the rest left unsent', async () => {
    const { batch, fetchMock } = makeBatch((i) =>
      i === 1
        ? jsonResponse(400, { message: 'No Anthropic API key configured' })
        : jsonResponse(200, found(`p${i}`))
    );
    batch.add([file('1.jpg'), file('2.jpg'), file('3.jpg'), file('4.jpg')]);
    await batch.run();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(batch.rows.map((r) => r.status)).toEqual(['done', 'failed', 'queued', 'queued']);
    expect(batch.stopped).toBe(true);
    expect(batch.stoppedOnNoKey).toBe(true);
    expect(batch.rows[1].error).toMatch(/No Anthropic API key/);
  });

  it('an over-cap failure stops the queue; resume continues from the next queued file', async () => {
    let capped = true;
    const { batch, fetchMock } = makeBatch((i) =>
      i === 0 || !capped
        ? jsonResponse(200, found(`p${i}`))
        : jsonResponse(402, { error: 'Monthly AI cap of $5.00 reached' })
    );
    batch.add([file('1.jpg'), file('2.jpg'), file('3.jpg')]);
    await batch.run();
    expect(batch.rows.map((r) => r.status)).toEqual(['done', 'failed', 'queued']);
    expect(batch.stoppedOnNoKey).toBe(false);
    capped = false;
    await batch.run();
    expect(batch.stopped).toBe(false);
    expect(batch.rows.map((r) => r.status)).toEqual(['done', 'failed', 'done']);
    await batch.retry(batch.rows[1].id);
    expect(batch.rows[1].status).toBe('done');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('a found:false row fails but later rows still run', async () => {
    const { batch } = makeBatch((i) =>
      i === 0 ? jsonResponse(200, { found: false }) : jsonResponse(200, found('ok'))
    );
    batch.add([file('blurry.jpg'), file('good.jpg')]);
    await batch.run();
    expect(batch.rows.map((r) => r.status)).toEqual(['failed', 'done']);
    expect(batch.rows[0].error).toMatch(/could not identify/);
    expect(batch.stopped).toBe(false);
  });

  it('a network TypeError is treated as offline and stops the queue', async () => {
    const { batch } = makeBatch(() => {
      throw new TypeError('Failed to fetch');
    });
    batch.add([file('1.jpg'), file('2.jpg')]);
    await batch.run();
    expect(batch.rows.map((r) => r.status)).toEqual(['failed', 'queued']);
    expect(batch.stopMessage).toMatch(/offline/);
  });

  it('rejects oversize files without calling the API and caps the batch size', async () => {
    const { batch, fetchMock } = makeBatch(() => jsonResponse(200, found('x')));
    batch.add([file('huge.jpg', MAX_FILE_BYTES + 1)]);
    await batch.run();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(batch.rows[0]).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/10 MB/)
    });

    batch.clear();
    batch.add(Array.from({ length: MAX_BATCH_FILES + 3 }, (_, i) => file(`${i}.jpg`)));
    expect(batch.rows).toHaveLength(MAX_BATCH_FILES);
    expect(batch.overflow).toBe(3);
  });

  it('discard, markSaved, nextReviewable and counts track the queue', async () => {
    const revoke = vi.fn();
    const batch = new LabelBatch({
      fetch: (async () => jsonResponse(200, found('x'))) as unknown as typeof fetch,
      readAsDataUrl: async () => 'data:,',
      createThumb: (f) => `blob:${f.name}`,
      revokeThumb: revoke
    });
    batch.add([file('a.jpg'), file('b.jpg'), file('c.jpg')]);
    await batch.run();
    const [a, b, c] = batch.rows;
    batch.markSaved(a.id);
    expect(batch.nextReviewable()?.id).toBe(b.id);
    expect(batch.nextReviewable(b.id)?.id).toBe(c.id);
    batch.discard(c.id);
    expect(revoke).toHaveBeenCalledWith('blob:c.jpg');
    expect(batch.counts).toMatchObject({ saved: 1, done: 1, queued: 0 });
    batch.markSaved(a.id);
    expect(batch.counts.saved).toBe(1);
  });
});
