#!/usr/bin/env node
/**
 * NFR-06 — generate a VAPID key pair for Web Push.
 *
 * Usage: node scripts/gen-vapid.mjs [mailto:hello@cropcard.io]
 *        node scripts/gen-vapid.mjs --raw
 *
 * Prints env lines for VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT.
 * --raw prints only the public key then the private key, one per line, for
 * scripts/set-azure-secret.sh to stream into Key Vault without touching disk.
 * Keep the private key secret (Container Apps secret / .env, never git).
 * Rotating the pair invalidates every existing browser subscription.
 */

import { createECDH } from 'node:crypto';

const raw = process.argv[2] === '--raw';
const subject = raw ? '' : (process.argv[2] ?? 'mailto:hello@cropcard.io');
if (!raw && !/^(mailto:|https:)/.test(subject)) {
  console.error('subject must start with mailto: or https:');
  process.exit(1);
}

const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
let priv = ecdh.getPrivateKey();
if (priv.length < 32) priv = Buffer.concat([Buffer.alloc(32 - priv.length), priv]);

const publicKey = ecdh.getPublicKey().toString('base64url');
const privateKey = priv.toString('base64url');

if (raw) {
  process.stdout.write(`${publicKey}\n${privateKey}\n`);
} else {
  console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
  console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
  console.log(`VAPID_SUBJECT=${subject}`);
}
