// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { renderRefusalResponse, withRenderRefusal } from './refusal';
import { RenderRefused } from './queue';

const html = { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' };
const req = (headers: Record<string, string> = {}) =>
  new Request('http://app.test/api/records/export.vdacs.pdf', { headers });

describe('renderRefusalResponse (R-06)', () => {
  it('answers a busy queue with 429, Retry-After 15 and JSON for fetch callers', async () => {
    const res = renderRefusalResponse(req(), 'en', new RenderRefused('RENDER_BUSY'));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('15');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      error: 'Another export is being made right now. Try again in a minute.',
      code: 'RENDER_BUSY'
    });
  });

  it('answers a link click with a short page and a way back, in Spanish', async () => {
    const res = renderRefusalResponse(req(html), 'es', new RenderRefused('RENDER_BUSY'));
    expect(res.status).toBe(429);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('lang="es"');
    expect(body).toContain('Ahora mismo se está preparando otra exportación.');
    expect(body).toContain('La exportación no está lista');
    expect(body).toContain('Volver');
    expect(body).toContain('Vuelve a intentarlo en un minuto.');
    expect(body).not.toMatch(/Vuelva|Pruebe/);
  });

  it('speaks Spanish with tú on the failed render advice, like the rest of the app', async () => {
    const res = renderRefusalResponse(req(), 'es', new RenderRefused('RENDER_TIMEOUT'));
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Prueba con un rango de fechas más corto.');
    expect(body.error).not.toMatch(/Pruebe|Vuelva/);
  });

  it.each(['RENDER_TIMEOUT', 'RENDER_FAILED'] as const)(
    'answers %s with 503 and the shorter-range advice',
    async (code) => {
      const res = renderRefusalResponse(req(), 'en', new RenderRefused(code));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        error: 'This export took too long to make. Try a shorter date range.',
        code
      });
    }
  );

  it('prefers JSON when the caller accepts both', async () => {
    const res = renderRefusalResponse(
      req({ accept: 'text/html, application/json' }),
      'en',
      new RenderRefused('RENDER_BUSY')
    );
    expect(res.headers.get('content-type')).toBe('application/json');
  });

  it('answers UPDATING with the handoff updating response', async () => {
    const res = renderRefusalResponse(req(), 'en', new RenderRefused('UPDATING'));
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('10');
    expect(res.headers.get('x-cropcard-updating')).toBe('1');
  });
});

describe('withRenderRefusal', () => {
  it('turns a refused render into its answer and rethrows anything else', async () => {
    const event = { request: req(), locals: { locale: 'en' } };
    const res = await withRenderRefusal(event, async () => {
      throw new RenderRefused('RENDER_BUSY');
    });
    expect(res.status).toBe(429);
    await expect(
      withRenderRefusal(event, async () => {
        throw new Error('db down');
      })
    ).rejects.toThrow('db down');
  });
});
