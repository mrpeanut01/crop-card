import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { _requestSchema as fieldCreate } from '../fields/+server';
import { _requestSchema as fieldPatch } from '../fields/[id]/+server';
import { _requestSchema as blockCreate } from '../blocks/+server';
import { _requestSchema as blockPatch } from '../blocks/[id]/+server';
import { _requestSchema as hintsPost } from '../me/hints/+server';
import { _requestSchema as gardenPlantings } from '../garden/plantings/+server';
import { _requestSchema as gardenSuccession } from '../garden/beds/[blockId]/succession/+server';
import { _requestSchema as gardenFill } from '../garden/beds/[blockId]/fill/+server';

interface Operation {
  parameters?: { $ref?: string; name?: string; in?: string }[];
  requestBody?: { content: { 'application/json': { schema: Record<string, unknown> } } };
  responses: Record<string, unknown>;
}
type Doc = {
  paths: Record<string, Record<string, Operation>>;
  components: { parameters: Record<string, { name: string; in: string }> };
};

const doc = JSON.parse(readFileSync(resolve(process.cwd(), 'static/openapi.json'), 'utf8')) as Doc;

function published(path: string, method: string): Record<string, unknown> {
  const op = doc.paths[path]?.[method];
  expect(op, `${method.toUpperCase()} ${path}`).toBeDefined();
  return op!.requestBody!.content['application/json'].schema;
}

function generated(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _dialect, ...json } = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'input',
    unrepresentable: 'any'
  });
  return json;
}

describe('openapi.json', () => {
  it.each([
    ['/api/fields', 'post', fieldCreate],
    ['/api/fields/{id}', 'patch', fieldPatch],
    ['/api/blocks', 'post', blockCreate],
    ['/api/blocks/{id}', 'patch', blockPatch],
    ['/api/me/hints', 'post', hintsPost],
    ['/api/garden/plantings', 'post', gardenPlantings],
    ['/api/garden/beds/{blockId}/succession', 'post', gardenSuccession],
    ['/api/garden/beds/{blockId}/fill', 'post', gardenFill]
  ] as const)('%s %s publishes the schema the route validates with', (path, method, schema) => {
    expect(published(path, method)).toEqual(generated(schema));
  });

  it('lists every Phase 30 read endpoint', () => {
    for (const [path, method] of [
      ['/api/geocode', 'get'],
      ['/api/me/hints', 'get'],
      ['/api/cards/snapshot', 'get'],
      ['/api/fields', 'get'],
      ['/api/fields/{id}', 'get'],
      ['/api/blocks', 'get'],
      ['/api/blocks/{id}', 'get'],
      ['/api/blocks/{id}', 'delete']
    ]) {
      expect(doc.paths[path]?.[method], `${method.toUpperCase()} ${path}`).toBeDefined();
    }
    const kinds = doc.paths['/api/fields'].get.parameters?.find((p) => p.name === 'kind');
    expect(kinds?.in).toBe('query');
    expect(doc.paths['/api/cards/snapshot'].get.responses['304']).toBeDefined();
  });

  it('documents the client record id header on all six record endpoints', () => {
    expect(doc.components.parameters.ClientRecordId).toMatchObject({
      name: CLIENT_RECORD_HEADER,
      in: 'header'
    });
    for (const path of [
      '/api/spray/record',
      '/api/insecticide/record',
      '/api/fungicide/record',
      '/api/harvest/record',
      '/api/scout/record',
      '/api/hay/cuttings'
    ]) {
      const op = doc.paths[path]?.post;
      expect(op, path).toBeDefined();
      expect(op!.parameters).toContainEqual({ $ref: '#/components/parameters/ClientRecordId' });
      expect(op!.responses['503']).toBeDefined();
    }
  });
});
