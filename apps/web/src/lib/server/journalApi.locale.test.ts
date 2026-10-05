import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { badRequest, cleanPhoto } from './journalApi';

async function errorOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: string }).error;
}

describe('journal API refusals follow the locale', () => {
  it('keeps the English text byte-identical without a locale', async () => {
    const photo = cleanPhoto('not a photo');
    expect(photo.ok).toBe(false);
    if (!photo.ok) {
      expect(await errorOf(photo.response)).toBe('That photo could not be read. Use a JPEG photo.');
    }
    const parsed = z.object({ a: z.string() }).safeParse({});
    if (parsed.success) throw new Error('expected a parse failure');
    expect(await errorOf(badRequest(parsed.error))).toBe('invalid request');
  });

  it('answers in Spanish when asked', async () => {
    const photo = cleanPhoto('not a photo', 'es');
    if (photo.ok) throw new Error('expected a refusal');
    expect(await errorOf(photo.response)).toBe('No se pudo leer esa foto. Usa una foto JPEG.');
    const parsed = z.object({ a: z.string() }).safeParse({});
    if (parsed.success) throw new Error('expected a parse failure');
    expect(await errorOf(badRequest(parsed.error, 'es'))).toBe('solicitud no válida');
  });
});
