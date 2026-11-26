/**
 * A tiny software WebAuthn authenticator for tests (Phase 38): an ES256
 * key pair, a hand-rolled CBOR encoder for the few shapes WebAuthn needs,
 * and real registration and sign-in responses that @simplewebauthn/server
 * verifies the same way it verifies a phone's. Test-only.
 */

import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

type Cbor = number | string | Uint8Array | Cbor[] | Map<Cbor, Cbor> | { [k: string]: Cbor };

function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n]);
  if (n < 0x10000) {
    const b = Buffer.alloc(3);
    b[0] = (major << 5) | 25;
    b.writeUInt16BE(n, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(n, 1);
  return b;
}

export function cbor(v: Cbor): Buffer {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') {
    const s = Buffer.from(v, 'utf-8');
    return Buffer.concat([head(3, s.length), s]);
  }
  if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), Buffer.from(v)]);
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cbor)]);
  const entries = v instanceof Map ? [...v.entries()] : Object.entries(v);
  return Buffer.concat([
    head(5, entries.length),
    ...entries.flatMap(([k, x]) => [cbor(k), cbor(x)])
  ]);
}

const b64u = (b: Uint8Array | string) => Buffer.from(b).toString('base64url');
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest();

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;
const FLAG_AT = 0x40;

export interface SoftAuthenticatorOptions {
  rpID: string;
  origin: string;
  /** The `user.id` from the registration options, base64url. */
  userHandle?: string;
  attachment?: 'platform' | 'cross-platform';
  userVerified?: boolean;
  synced?: boolean;
  aaguid?: string;
}

export class SoftAuthenticator {
  readonly credentialId = randomBytes(16);
  private readonly privateKey: KeyObject;
  private readonly publicJwk: JsonWebKey;
  counter = 0;
  userHandle: string | undefined;

  constructor(private readonly opts: SoftAuthenticatorOptions) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = privateKey;
    this.publicJwk = publicKey.export({ format: 'jwk' });
    this.userHandle = opts.userHandle;
  }

  get id(): string {
    return b64u(this.credentialId);
  }

  private flags(extra: number): number {
    let f = FLAG_UP | extra;
    if (this.opts.userVerified !== false) f |= FLAG_UV;
    if (this.opts.synced) f |= FLAG_BE | FLAG_BS;
    return f;
  }

  private cosePublicKey(): Buffer {
    return cbor(
      new Map<Cbor, Cbor>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(this.publicJwk.x as string, 'base64url')],
        [-3, Buffer.from(this.publicJwk.y as string, 'base64url')]
      ])
    );
  }

  private aaguidBytes(): Buffer {
    return this.opts.aaguid
      ? Buffer.from(this.opts.aaguid.replace(/-/g, ''), 'hex')
      : Buffer.alloc(16);
  }

  register(challenge: string, override: Partial<{ origin: string; rpID: string }> = {}) {
    const rpID = override.rpID ?? this.opts.rpID;
    const counter = Buffer.alloc(4);
    const idLen = Buffer.alloc(2);
    idLen.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([
      sha256(rpID),
      Buffer.from([this.flags(FLAG_AT)]),
      counter,
      this.aaguidBytes(),
      idLen,
      this.credentialId,
      this.cosePublicKey()
    ]);
    const clientDataJSON = JSON.stringify({
      type: 'webauthn.create',
      challenge,
      origin: override.origin ?? this.opts.origin,
      crossOrigin: false
    });
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      authenticatorAttachment: this.opts.attachment ?? 'platform',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64u(clientDataJSON),
        attestationObject: b64u(cbor({ fmt: 'none', attStmt: {}, authData })),
        transports: this.opts.attachment === 'cross-platform' ? ['hybrid'] : ['internal']
      }
    };
  }

  signIn(challenge: string, override: Partial<{ origin: string; rpID: string }> = {}) {
    this.counter += 1;
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.counter);
    const authData = Buffer.concat([
      sha256(override.rpID ?? this.opts.rpID),
      Buffer.from([this.flags(0)]),
      counter
    ]);
    const clientDataJSON = JSON.stringify({
      type: 'webauthn.get',
      challenge,
      origin: override.origin ?? this.opts.origin,
      crossOrigin: false
    });
    const signature = sign(
      'sha256',
      Buffer.concat([authData, sha256(clientDataJSON)]),
      this.privateKey
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      authenticatorAttachment: this.opts.attachment ?? 'platform',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64u(clientDataJSON),
        authenticatorData: b64u(authData),
        signature: b64u(signature),
        ...(this.userHandle ? { userHandle: this.userHandle } : {})
      }
    };
  }
}
