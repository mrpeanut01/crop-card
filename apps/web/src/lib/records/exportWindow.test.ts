import { describe, expect, it } from 'vitest';
import { parseExportWindow } from './exportWindow';

const NY = { timeZone: 'America/New_York' };
const q = (s: string) => new URLSearchParams(s);

describe('parseExportWindow (B-42)', () => {
  it('reads farm-local days, with `to` covering its whole day', () => {
    const r = parseExportWindow(q('from=2026-01-01&to=2026-12-31'), NY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(new Date(r.fromMs).toISOString()).toBe('2026-01-01T05:00:00.000Z');
    expect(new Date(r.toMs + 1).toISOString()).toBe('2027-01-01T05:00:00.000Z');
  });

  it('needs both dates and names the field that is wrong', () => {
    expect(parseExportWindow(q('to=2026-01-01'), NY)).toMatchObject({ ok: false, field: 'from' });
    expect(parseExportWindow(q('from=2026-01-01'), NY)).toMatchObject({ ok: false, field: 'to' });
    expect(parseExportWindow(q('from=2026-02-30&to=2026-03-01'), NY)).toMatchObject({
      ok: false,
      field: 'from'
    });
    expect(parseExportWindow(q('from=1700000000000&to=2026-03-01'), NY)).toMatchObject({
      ok: false,
      field: 'from'
    });
  });

  it('refuses `to` before `from` and a window over 10 years', () => {
    expect(parseExportWindow(q('from=2026-02-01&to=2026-01-31'), NY)).toMatchObject({
      ok: false,
      field: 'to'
    });
    expect(parseExportWindow(q('from=2016-01-01&to=2025-12-31'), NY).ok).toBe(true);
    expect(parseExportWindow(q('from=2016-01-01&to=2026-01-01'), NY)).toMatchObject({
      ok: false,
      field: 'to'
    });
  });
});
