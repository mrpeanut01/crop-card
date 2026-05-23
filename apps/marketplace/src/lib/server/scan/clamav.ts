/**
 * ClamAV INSTREAM client. Connects to clamd over TCP and streams the
 * bytes to scan. Returns a verdict + engine/signature metadata.
 *
 * INSTREAM protocol (clamd's binary command):
 *   1. Send command: 'zINSTREAM\0'
 *   2. Send chunks: 4-byte big-endian length + bytes
 *   3. Send terminator: 4-byte big-endian zero
 *   4. Read response: 'stream: OK\0' on clean, 'stream: <sig> FOUND\0' on hit
 *
 * Env config:
 *   CLAMAV_HOST       — clamd host (compose: 'clamav'; prod sidecar: 'localhost')
 *   CLAMAV_PORT       — defaults to 3310
 *   CLAMAV_SCAN_MODE  — 'enforce' (default) | 'skip' (dev escape hatch
 *                       when no clamd is running — logs a warning but
 *                       returns 'clean'; never use in prod)
 *
 * Failure modes:
 *   - clamd unreachable        → throws ClamAvUnavailableError (caller returns 503)
 *   - command timeout (30s)    → throws ClamAvUnavailableError
 *   - malformed response       → throws ClamAvUnavailableError
 *   - 'FOUND' verdict          → returns { status: 'infected', signature }
 *   - 'OK' verdict             → returns { status: 'clean' }
 */

import { Socket } from 'node:net';

export interface ClamAvVerdict {
  status: 'clean' | 'infected' | 'skipped';
  signature?: string;
  engineHost?: string;
  enginePort?: number;
}

export class ClamAvUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClamAvUnavailableError';
  }
}

const COMMAND_TIMEOUT_MS = 30_000;
const CHUNK_SIZE = 64 * 1024;

export async function scanBytes(bytes: Buffer): Promise<ClamAvVerdict> {
  const mode = process.env.CLAMAV_SCAN_MODE ?? 'enforce';
  if (mode === 'skip') {
    console.warn('[clamav] CLAMAV_SCAN_MODE=skip — bypassing virus scan');
    return { status: 'skipped' };
  }
  const host = process.env.CLAMAV_HOST;
  const port = Number(process.env.CLAMAV_PORT ?? '3310');
  if (!host) {
    throw new ClamAvUnavailableError(
      'CLAMAV_HOST is unset; refusing to bypass virus scan (set CLAMAV_SCAN_MODE=skip in dev to override)'
    );
  }

  return new Promise<ClamAvVerdict>((resolve, reject) => {
    const sock = new Socket();
    let response = Buffer.alloc(0);
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      try {
        sock.destroy();
      } catch {
        // ignore
      }
      fn();
    };

    sock.setTimeout(COMMAND_TIMEOUT_MS, () => {
      finish(() =>
        reject(new ClamAvUnavailableError(`clamd timeout after ${COMMAND_TIMEOUT_MS}ms`))
      );
    });

    sock.on('error', (err) => {
      finish(() =>
        reject(
          new ClamAvUnavailableError(
            `clamd connect failed (${host}:${port}): ${err instanceof Error ? err.message : String(err)}`
          )
        )
      );
    });

    sock.on('data', (chunk) => {
      response = Buffer.concat([response, chunk]);
    });

    sock.on('close', () => {
      const text = response.toString('utf-8').replace(/\0$/, '').trim();
      if (!text) {
        finish(() => reject(new ClamAvUnavailableError('clamd closed with empty response')));
        return;
      }
      // Examples:
      //   "stream: OK"
      //   "stream: Win.Test.EICAR_HDB-1 FOUND"
      const foundMatch = text.match(/stream:\s+(.+)\s+FOUND/);
      if (foundMatch) {
        finish(() =>
          resolve({ status: 'infected', signature: foundMatch[1], engineHost: host, enginePort: port })
        );
        return;
      }
      if (/stream:\s+OK/.test(text)) {
        finish(() => resolve({ status: 'clean', engineHost: host, enginePort: port }));
        return;
      }
      finish(() => reject(new ClamAvUnavailableError(`unexpected clamd response: ${text.slice(0, 200)}`)));
    });

    sock.connect(port, host, () => {
      sock.write('zINSTREAM\0');
      // Stream bytes in chunks.
      for (let off = 0; off < bytes.length; off += CHUNK_SIZE) {
        const slice = bytes.subarray(off, Math.min(off + CHUNK_SIZE, bytes.length));
        const lenBuf = Buffer.alloc(4);
        lenBuf.writeUInt32BE(slice.length, 0);
        sock.write(lenBuf);
        sock.write(slice);
      }
      // Terminate.
      const terminator = Buffer.alloc(4);
      terminator.writeUInt32BE(0, 0);
      sock.write(terminator);
    });
  });
}
