// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { anthropicClient } from './anthropicClient';
import { E2E_FIXTURE_API_KEY } from './aiFixture/claude';

const vars = ['E2E_CLAUDE_FIXTURE', 'ENABLE_DEV_ROUTES'] as const;
const saved = Object.fromEntries(vars.map((v) => [v, process.env[v]]));

afterEach(() => {
  for (const v of vars) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
});

function setGate(fixture: string | undefined, devRoutes: string | undefined) {
  if (fixture === undefined) delete process.env.E2E_CLAUDE_FIXTURE;
  else process.env.E2E_CLAUDE_FIXTURE = fixture;
  if (devRoutes === undefined) delete process.env.ENABLE_DEV_ROUTES;
  else process.env.ENABLE_DEV_ROUTES = devRoutes;
}

describe('anthropicClient', () => {
  it('returns the real SDK client for the sentinel key whenever the gate is off', () => {
    for (const [f, d] of [
      [undefined, undefined],
      ['1', undefined],
      [undefined, '1'],
      ['1', '0'],
      ['true', '1']
    ] as const) {
      setGate(f, d);
      expect(anthropicClient(E2E_FIXTURE_API_KEY)).toBeInstanceOf(Anthropic);
    }
  });

  it('returns the real SDK client for any other key when the gate is on', () => {
    setGate('1', '1');
    expect(anthropicClient('sk-ant-real-looking-key')).toBeInstanceOf(Anthropic);
    expect(anthropicClient('')).toBeInstanceOf(Anthropic);
  });

  it('returns the fixture only for the sentinel key with the gate on', () => {
    setGate('1', '1');
    const client = anthropicClient(E2E_FIXTURE_API_KEY);
    expect(client).not.toBeInstanceOf(Anthropic);
    expect(typeof client.messages.create).toBe('function');
  });
});

describe('the fixture is never switched on in production config', () => {
  const infra = (rel: string) =>
    readFileSync(fileURLToPath(new URL(`../../../../../infra/${rel}`, import.meta.url)), 'utf8');

  for (const file of ['azure/main.bicep', 'Dockerfile', 'docker-compose.yml', '.env.dev.example']) {
    it(`${file} never sets E2E_CLAUDE_FIXTURE or ENABLE_DEV_ROUTES`, () => {
      const text = infra(file);
      expect(text).not.toMatch(/E2E_CLAUDE_FIXTURE/);
      expect(text).not.toMatch(/ENABLE_DEV_ROUTES/);
    });
  }

  it('the Playwright config sets E2E_CLAUDE_FIXTURE=1 on the main preview server only', () => {
    const config = readFileSync(
      fileURLToPath(new URL('../../../playwright.config.ts', import.meta.url)),
      'utf8'
    );
    expect(config.match(/E2E_CLAUDE_FIXTURE=1/g)).toHaveLength(1);
    const main = config.indexOf('E2E_CLAUDE_FIXTURE=1');
    const magic = config.indexOf('AUTH_MODE=magic-link AUTH_SECRET');
    expect(main).toBeGreaterThan(0);
    expect(main).toBeLessThan(magic);
  });

  it('no server module builds an SDK client except through anthropicClient', async () => {
    const { readdirSync } = await import('node:fs');
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'anthropicClient.ts')
      .filter((f) => readFileSync(`${dir}/${f}`, 'latin1').includes('new Anthropic('));
    expect(offenders).toEqual([]);
  });
});
