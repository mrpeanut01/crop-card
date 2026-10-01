import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { filesystemVaultStore } from './filesystemStore';
import { _setVaultStoreForTests } from './store';

/** A filesystem vault in a fresh temp directory, set as the process store.
 *  Call `cleanup` in `afterEach`/`afterAll`. Synchronous setup so it works
 *  at the top of a `describe`. */
export function useTestVault(): { dir: string; cleanup(): Promise<void> } {
  const dir = path.join(
    tmpdir(),
    `cropcard-vault-${process.pid}-${Math.random().toString(36).slice(2)}`
  );
  _setVaultStoreForTests(filesystemVaultStore(dir));
  return {
    dir,
    async cleanup() {
      _setVaultStoreForTests(undefined);
      await rm(dir, { recursive: true, force: true });
    }
  };
}
