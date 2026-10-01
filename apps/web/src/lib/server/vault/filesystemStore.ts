import { createReadStream } from 'node:fs';
import { mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { bodyChunks } from './body';
import {
  VAULT_ROOT_PREFIX,
  assertVaultKey,
  assertVaultPrefix,
  isVaultKey,
  type VaultObject,
  type VaultStore
} from './store';

/** Files under `dir`, one per key. Dev and tests only: in Azure the vault
 *  refuses this backend, because the container disk is wiped on restart. */
export function filesystemVaultStore(dir: string): VaultStore {
  const root = path.resolve(dir);

  function pathFor(rel: string): string {
    const full = path.resolve(root, rel);
    if (full !== root && !full.startsWith(root + path.sep)) {
      throw new Error('vault path escapes VAULT_DIR');
    }
    return full;
  }

  async function* walk(prefix: string): AsyncGenerator<VaultObject> {
    const ownerDirs =
      prefix === VAULT_ROOT_PREFIX
        ? (await safeReaddir(pathFor('owners'))).map((n) => `owners/${n}/`)
        : [prefix];
    for (const ownerPrefix of ownerDirs) {
      const names = await safeReaddir(pathFor(ownerPrefix));
      for (const name of names.sort()) {
        const key = `${ownerPrefix}${name}`;
        if (!isVaultKey(key)) continue;
        try {
          const s = await stat(pathFor(key));
          if (!s.isFile()) continue;
          yield { key, bytes: s.size, lastModified: s.mtimeMs };
        } catch {
          continue;
        }
      }
    }
  }

  const store: VaultStore = {
    backend: 'filesystem',

    async put(key, body) {
      assertVaultKey(key);
      const target = pathFor(key);
      await mkdir(path.dirname(target), { recursive: true });
      const tmp = `${target}.tmp-${randomUUID()}`;
      const fh = await open(tmp, 'wx');
      let bytes = 0;
      try {
        for await (const chunk of bodyChunks(body)) {
          await fh.write(chunk);
          bytes += chunk.byteLength;
        }
        await fh.sync();
        await fh.close();
        await rename(tmp, target);
      } catch (err) {
        await fh.close().catch(() => {});
        await rm(tmp, { force: true });
        throw err;
      }
      return { bytes };
    },

    async get(key) {
      assertVaultKey(key);
      const p = pathFor(key);
      let size: number;
      try {
        const s = await stat(p);
        if (!s.isFile()) return null;
        size = s.size;
      } catch {
        return null;
      }
      const nodeStream = createReadStream(p);
      return {
        body: Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>,
        bytes: size
      };
    },

    async delete(key) {
      assertVaultKey(key);
      await rm(pathFor(key), { force: true });
    },

    async deletePrefix(prefix, opts = {}) {
      assertVaultPrefix(prefix);
      let n = 0;
      for await (const obj of walk(prefix)) {
        if (opts.modifiedBefore !== undefined && obj.lastModified >= opts.modifiedBefore) continue;
        if (opts.keep?.(obj.key)) continue;
        await rm(pathFor(obj.key), { force: true });
        n++;
      }
      return n;
    },

    list(prefix) {
      assertVaultPrefix(prefix);
      return walk(prefix);
    }
  };
  return store;
}

async function safeReaddir(p: string): Promise<string[]> {
  try {
    return await readdir(p);
  } catch {
    return [];
  }
}
