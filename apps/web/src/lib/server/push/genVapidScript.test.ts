// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readVapidConfig } from './webPush';

const script = fileURLToPath(new URL('../../../../scripts/gen-vapid.mjs', import.meta.url));

describe('gen-vapid.mjs --raw (consumed by scripts/set-azure-secret.sh vapid)', () => {
  it('prints a public key then a private key that readVapidConfig accepts', () => {
    const out = execFileSync(process.execPath, [script, '--raw'], { encoding: 'utf8' });
    const lines = out.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe('');
    const [pub, priv] = lines;
    expect(pub).toHaveLength(87);
    expect(priv).toHaveLength(43);
    expect(
      readVapidConfig({
        VAPID_PUBLIC_KEY: pub,
        VAPID_PRIVATE_KEY: priv,
        VAPID_SUBJECT: 'mailto:ops@example.com'
      })
    ).not.toBeNull();
  });
});
