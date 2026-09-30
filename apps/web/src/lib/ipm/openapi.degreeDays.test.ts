// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { _requestSchema as biofixPut } from '../../routes/api/pest-models/[id]/biofix/+server';

type Doc = { paths: Record<string, Record<string, Record<string, unknown>>> };
const doc = JSON.parse(readFileSync(resolve(process.cwd(), 'static/openapi.json'), 'utf8')) as Doc;

describe('openapi.json (32E degree days)', () => {
  it('publishes the biofix body the route validates with', () => {
    const op = doc.paths['/api/pest-models/{id}/biofix']?.put as {
      requestBody: { content: { 'application/json': { schema: unknown } } };
    };
    const { $schema: _d, ...json } = z.toJSONSchema(biofixPut, {
      target: 'draft-2020-12',
      io: 'input',
      unrepresentable: 'any'
    });
    expect(op.requestBody.content['application/json'].schema).toEqual(json);
  });

  it('lists the degree-day read', () => {
    expect(doc.paths['/api/weather/degree-days']?.get).toBeDefined();
  });
});
