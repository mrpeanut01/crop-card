import {
  deleteBlob,
  getStream,
  listAll,
  putStream,
  type BlobConfig
} from '../../../../scripts/lib/azureBlob.mjs';
import { bodyChunks } from './body';
import {
  assertVaultKey,
  assertVaultPrefix,
  isVaultKey,
  type VaultObject,
  type VaultStore
} from './store';

/** Azure Blob in the private `documents` container, signed with the
 *  storage account's Shared Key. */
export function blobVaultStore(cfg: BlobConfig): VaultStore {
  async function* list(prefix: string): AsyncGenerator<VaultObject> {
    for await (const b of listAll(cfg, prefix)) {
      if (!isVaultKey(b.name)) continue;
      yield { key: b.name, bytes: b.bytes, lastModified: b.lastModified };
    }
  }

  return {
    backend: 'blob',

    async put(key, body, opts) {
      assertVaultKey(key);
      const { bytes } = await putStream(cfg, key, bodyChunks(body), opts.contentType);
      return { bytes };
    },

    async get(key) {
      assertVaultKey(key);
      const r = await getStream(cfg, key);
      return r ? { body: r.body, bytes: r.bytes } : null;
    },

    async delete(key) {
      assertVaultKey(key);
      await deleteBlob(cfg, key);
    },

    async deletePrefix(prefix, opts = {}) {
      assertVaultPrefix(prefix);
      const doomed: string[] = [];
      for await (const obj of list(prefix)) {
        if (opts.modifiedBefore !== undefined && obj.lastModified >= opts.modifiedBefore) continue;
        if (opts.keep?.(obj.key)) continue;
        doomed.push(obj.key);
      }
      for (const key of doomed) await deleteBlob(cfg, key);
      return doomed.length;
    },

    list(prefix) {
      assertVaultPrefix(prefix);
      return list(prefix);
    }
  };
}
