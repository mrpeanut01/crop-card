/**
 * OpenAPI artifact + served endpoint (Phase 24, Sub-task C / #57).
 *
 * Two contracts under test:
 *   1. Generator output is well-formed OpenAPI 3.1 covering the Phase 24
 *      ship-list endpoints (auth, health, openapi self-ref, spray/record,
 *      blocks) with the bearerAuth + cookieSession security schemes.
 *   2. The endpoint handler reads the on-disk artifact and serves it
 *      with the right MIME + cache headers. Public (no auth).
 *
 * We import the endpoint module directly rather than spinning up SvelteKit
 * — fast, hermetic, and aligns with the existing pattern in
 * sessionRoleGates.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { GET } from '../../src/routes/api/openapi.json/+server';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFACT_PATH = resolve(__dirname, '../../static/openapi.json');

function loadArtifact() {
  return JSON.parse(readFileSync(ARTIFACT_PATH, 'utf-8'));
}

describe('openapi.json artifact', () => {
  const doc = loadArtifact();

  it('is OpenAPI 3.1', () => {
    expect(doc.openapi).toBe('3.1.0');
  });

  it('includes the Phase 24 ship-list paths', () => {
    expect(doc.paths['/api/health']).toBeDefined();
    expect(doc.paths['/api/openapi.json']).toBeDefined();
    expect(doc.paths['/api/auth/token']).toBeDefined();
    expect(doc.paths['/api/auth/token/{id}']).toBeDefined();
    expect(doc.paths['/api/spray/record']).toBeDefined();
    expect(doc.paths['/api/blocks']).toBeDefined();
  });

  it('exposes both bearerAuth and cookieSession security schemes', () => {
    const schemes = doc.components.securitySchemes;
    expect(schemes.bearerAuth.type).toBe('http');
    expect(schemes.bearerAuth.scheme).toBe('bearer');
    expect(schemes.bearerAuth.bearerFormat).toContain('cck_');
    expect(schemes.cookieSession.type).toBe('apiKey');
    expect(schemes.cookieSession.in).toBe('cookie');
    expect(schemes.cookieSession.name).toBe('cropcard.session');
  });

  it('declares both schemes at the document level (either accepted by default)', () => {
    // Endpoints can locally override with `security: []` for public paths.
    const haveSchemes = doc.security.map((s: Record<string, unknown>) => Object.keys(s)[0]);
    expect(haveSchemes).toContain('bearerAuth');
    expect(haveSchemes).toContain('cookieSession');
  });

  it('marks /api/health and /api/openapi.json as public (security: [])', () => {
    expect(doc.paths['/api/health'].get.security).toEqual([]);
    expect(doc.paths['/api/openapi.json'].get.security).toEqual([]);
  });

  it('restricts POST /api/auth/token to cookie sessions (closes Bearer-mints-Bearer loop)', () => {
    const post = doc.paths['/api/auth/token'].post;
    expect(post.security).toEqual([{ cookieSession: [] }]);
    expect(JSON.stringify(post)).not.toContain('bearerAuth');
  });

  it('POST /api/auth/token response describes the cck_ token format', () => {
    const schema =
      doc.paths['/api/auth/token'].post.responses[201].content['application/json'].schema;
    expect(schema.properties.token.pattern).toBe('^cck_[A-Za-z0-9_-]+$');
  });

  it('reusable schemas include Error + TokenSummary', () => {
    expect(doc.components.schemas.Error).toBeDefined();
    expect(doc.components.schemas.TokenSummary).toBeDefined();
  });
});

describe('GET /api/openapi.json', () => {
  it('returns 200 with the OpenAPI artifact body + JSON MIME', async () => {
    const res = await GET({} as Parameters<typeof GET>[0]);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('cache-control')).toContain('max-age=3600');
    const body = await res.json();
    expect(body.openapi).toBe('3.1.0');
    expect(body.paths['/api/health']).toBeDefined();
  });
});
