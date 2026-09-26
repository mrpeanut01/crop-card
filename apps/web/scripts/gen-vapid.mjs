#!/usr/bin/env node
/**
 * NFR-06 — generate a VAPID key pair for Web Push.
 *
 * Usage: node scripts/gen-vapid.mjs [mailto:hello@cropcard.io]
 *
 * Prints env lines for VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT.
 * Keep the private key secret (Container Apps secret / .env, never git).
 * Rotating the pair invalidates every existing browser subscription.
 */

import { createECDH } from 'node:crypto';

const subject = process.argv[2] ?? 'mailto:hello@cropcard.io';
if (!/^(mailto:|https:)/.test(subject)) {
  console.error('subject must start with mailto: or https:');
  process.exit(1);
}

const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
let priv = ecdh.getPrivateKey();
if (priv.length < 32) priv = Buffer.concat([Buffer.alloc(32 - priv.length), priv]);

console.log(`VAPID_PUBLIC_KEY=${ecdh.getPublicKey().toString('base64url')}`);
console.log(`VAPID_PRIVATE_KEY=${priv.toString('base64url')}`);
console.log(`VAPID_SUBJECT=${subject}`);
