import type { VaultBody } from './store';

/** One iteration shape for every body the store accepts. */
export async function* bodyChunks(body: VaultBody): AsyncGenerator<Uint8Array> {
  if (body instanceof Uint8Array) {
    if (body.byteLength > 0) yield body;
    return;
  }
  if (typeof (body as ReadableStream<Uint8Array>).getReader === 'function') {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        if (value && value.byteLength > 0) yield value;
      }
    } finally {
      reader.releaseLock();
    }
  }
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    if (chunk && chunk.byteLength > 0) yield chunk;
  }
}

/** Pull-based web stream over an async iterator, closed on cancel. */
export function iterableToStream(iter: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const it = iter[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await it.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel(reason) {
      await it.return?.(reason);
    }
  });
}
