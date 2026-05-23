/**
 * Upload scan pipeline. The Sub-task E security boundary.
 *
 * Order of checks (any reject short-circuits and audit-logs):
 *   1. Size cap         — body > 256 KB → reject 400
 *   2. JSON structural  — depth/keys/string-length/control-char → reject 400
 *   3. Injection sweep  — <script>, javascript:, etc → reject 400
 *   4. Prompt injection — flag (not reject); forces pending_review
 *   5. ClamAV           — virus → reject 400; scanner down → throw 503
 *   6. Schema           — Zod pluginSchema.safeParse → reject 400
 *   7. Bypass           — detectBypass() (kernel widening claims) → reject 400
 *   8. Dedup            — sha256(canonical JSON); existing → noChange:true
 *
 * Used by both the upload endpoint (POST /api/v1/plugins) and the
 * bulk-import library (Sub-task G).
 */

import { createHash } from 'node:crypto';
import {
  pluginSchema,
  detectBypass,
  type BypassError,
  type Plugin
} from '@cropcard/plugin-validation';
import type { ZodIssue } from 'zod';
import { scanBytes, ClamAvUnavailableError, type ClamAvVerdict } from './clamav';
import { structuralScan, type StructuralIssue } from './structural';
import { injectionScan, type InjectionMatch } from './injection';
import { promptInjectionScan, type PromptInjectionFlag } from './promptInjection';

export const MAX_PAYLOAD_BYTES = 256 * 1024;

export interface ScanResult {
  /** Final verdict — what the persistence layer should do. */
  verdict: 'pass' | 'quarantine' | 'reject';
  /** Reason summary for audit log + API response. First item wins. */
  rejectReasons: string[];
  /** sha256 of the canonical JSON of the parsed payload (only set when JSON parsed OK). */
  hash?: string;
  /** Validated plugin payload (only set when schema + bypass passed). */
  plugin?: Plugin;
  /** Per-stage detail surfaced in scan_results column + admin UI. */
  scanResults: {
    sizeBytes: number;
    structural: StructuralIssue[];
    injection: InjectionMatch[];
    promptInjection: PromptInjectionFlag[];
    clamav: ClamAvVerdict | { status: 'unavailable'; error: string };
    schemaIssues: ZodIssue[];
    bypassErrors: BypassError[];
  };
}

export class ScannerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScannerUnavailableError';
  }
}

/**
 * Run the full pipeline against raw bytes. Throws ScannerUnavailableError
 * if clamd is unreachable (caller should return 503; never persist).
 */
export async function scanUpload(rawBytes: Buffer): Promise<ScanResult> {
  const result: ScanResult = {
    verdict: 'pass',
    rejectReasons: [],
    scanResults: {
      sizeBytes: rawBytes.length,
      structural: [],
      injection: [],
      promptInjection: [],
      clamav: { status: 'clean' },
      schemaIssues: [],
      bypassErrors: []
    }
  };

  // 1. Size cap
  if (rawBytes.length > MAX_PAYLOAD_BYTES) {
    result.verdict = 'reject';
    result.rejectReasons.push(
      `scan.size: ${rawBytes.length} bytes > ${MAX_PAYLOAD_BYTES} cap`
    );
    return result;
  }

  // 2. JSON parse (also gates everything downstream)
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBytes.toString('utf-8'));
  } catch (err) {
    result.verdict = 'reject';
    result.rejectReasons.push(`scan.json: ${err instanceof Error ? err.message : 'parse failed'}`);
    return result;
  }

  // 3. Structural caps
  const structural = structuralScan(parsed);
  result.scanResults.structural = structural;
  if (structural.length > 0) {
    result.verdict = 'reject';
    result.rejectReasons.push(`scan.structural.${structural[0].kind} at ${structural[0].path}`);
    return result;
  }

  // 4. XSS / injection sweep
  const injection = injectionScan(parsed);
  result.scanResults.injection = injection;
  if (injection.length > 0) {
    result.verdict = 'reject';
    result.rejectReasons.push(
      `scan.injection.${injection[0].pattern} at ${injection[0].path}`
    );
    return result;
  }

  // 5. Prompt-injection heuristic (flag, don't reject — but forces quarantine)
  const promptInj = promptInjectionScan(parsed);
  result.scanResults.promptInjection = promptInj;
  if (promptInj.length > 0) {
    result.verdict = 'quarantine';
  }

  // 6. ClamAV
  try {
    const clamavVerdict = await scanBytes(rawBytes);
    result.scanResults.clamav = clamavVerdict;
    if (clamavVerdict.status === 'infected') {
      result.verdict = 'reject';
      result.rejectReasons.push(`scan.clamav.infected: ${clamavVerdict.signature ?? 'unknown'}`);
      return result;
    }
  } catch (err) {
    if (err instanceof ClamAvUnavailableError) {
      // Fail-closed — caller should return 503 + audit, never persist.
      throw new ScannerUnavailableError(err.message);
    }
    throw err;
  }

  // 7. Schema validation
  const parseResult = pluginSchema.safeParse(parsed);
  if (!parseResult.success) {
    result.verdict = 'reject';
    result.scanResults.schemaIssues = parseResult.error.issues;
    const first = parseResult.error.issues[0];
    result.rejectReasons.push(
      `scan.schema: ${first?.path.join('.') ?? '$'}: ${first?.message ?? 'invalid'}`
    );
    return result;
  }
  const plugin = parseResult.data;
  result.plugin = plugin;

  // 8. Bypass detection (herbicides claiming kernel-lethal safety)
  const bypassErrors = detectBypass(plugin);
  if (bypassErrors.length > 0) {
    result.verdict = 'reject';
    result.scanResults.bypassErrors = bypassErrors;
    result.rejectReasons.push(
      `scan.bypass: ${bypassErrors[0].pluginId} claims safe-for ${bypassErrors[0].cropPluginId} but ${bypassErrors[0].reason}`
    );
    return result;
  }

  // 9. Hash (canonical JSON)
  result.hash = canonicalJsonHash(plugin);

  return result;
}

/**
 * Canonical JSON: sorted-key serialization → SHA-256 hex. Ensures
 * (pluginId, hash) is stable across whitespace / key-order variation.
 */
export function canonicalJsonHash(value: unknown): string {
  const canon = canonicalize(value);
  return createHash('sha256').update(canon).digest('hex');
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + canonicalize((value as Record<string, unknown>)[k]))
      .join(',') +
    '}'
  );
}
