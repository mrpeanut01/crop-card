import { describe, expect, it } from 'vitest';
import { parseMetarRain, routineRainHours } from './metarRain';

const H = 3_600_000;
const at = (iso: string) => Date.parse(iso);

describe('parseMetarRain', () => {
  it('reads the hourly P group in hundredths of an inch', () => {
    expect(
      parseMetarRain('KIAD 291452Z 18008KT 3SM RA BR OVC008 17/16 A2990 RMK AO2 P0023 T01720161')
        .inches
    ).toBe(0.23);
  });

  it('counts a trace (P0000) as zero', () => {
    expect(parseMetarRain('KIAD 291452Z 00000KT 10SM OVC020 RMK AO2 P0000').inches).toBe(0);
  });

  it('treats PNO as unknown even with a P group', () => {
    expect(parseMetarRain('KIAD 291452Z 00000KT 10SM CLR RMK AO2 P0010 PNO').inches).toBeNull();
    expect(parseMetarRain('KIAD 291452Z 00000KT 10SM CLR RMK AO2 PNO').inches).toBeNull();
  });

  it('counts an automated report with no P group as zero', () => {
    const r = parseMetarRain('KJYO 291455Z AUTO 00000KT 10SM CLR 17/09 A3012 RMK AO2 T01700090');
    expect(r).toEqual({ speci: false, automated: true, inches: 0 });
  });

  it('leaves a report with no P group and no automated station type unknown', () => {
    expect(parseMetarRain('KXYZ 291455Z 00000KT 10SM CLR 17/09 A3012').inches).toBeNull();
    expect(
      parseMetarRain('KXYZ 291455Z 00000KT 10SM CLR 17/09 A3012 RMK SLP199').inches
    ).toBeNull();
  });

  it('does not mistake peak wind or pressure remarks for rain', () => {
    const r = parseMetarRain('KIAD 291452Z 27025G35KT 10SM CLR RMK AO2 PK WND 27040/1420 PRESRR');
    expect(r.inches).toBe(0);
  });

  it('flags SPECI reports and ignores remarks-less text', () => {
    expect(parseMetarRain('SPECI KIAD 291405Z 00000KT 2SM RA RMK AO2 P0005').speci).toBe(true);
    expect(parseMetarRain('').inches).toBeNull();
  });
});

describe('routineRainHours', () => {
  it('keeps one routine report per hour and ignores specials', () => {
    const obs = [
      { ms: at('2026-09-29T12:52:00Z'), raw: 'KIAD 291252Z RMK AO2 P0010' },
      { ms: at('2026-09-29T13:20:00Z'), raw: 'KIAD 291320Z RMK AO2 P0030' },
      { ms: at('2026-09-29T13:52:00Z'), raw: 'KIAD 291352Z RMK AO2 P0040' },
      { ms: at('2026-09-29T14:52:00Z'), raw: 'KIAD 291452Z RMK AO2' },
      { ms: at('2026-09-29T14:10:00Z'), raw: 'SPECI KIAD 291410Z RMK AO2 P0001' }
    ];
    expect(routineRainHours(obs)).toEqual([
      { t: at('2026-09-29T12:00:00Z'), inches: 0.1 },
      { t: at('2026-09-29T13:00:00Z'), inches: 0.4 },
      { t: at('2026-09-29T14:00:00Z'), inches: 0 }
    ]);
  });

  it('leaves an hour with no routine report missing, never zero', () => {
    const obs = [
      { ms: at('2026-09-29T10:52:00Z'), raw: 'KIAD RMK AO2' },
      { ms: at('2026-09-29T12:52:00Z'), raw: 'KIAD RMK AO2' },
      { ms: at('2026-09-29T13:52:00Z'), raw: 'KIAD RMK AO2' }
    ];
    const hours = routineRainHours(obs).map((h) => h.t);
    expect(hours).not.toContain(at('2026-09-29T11:00:00Z'));
    expect(hours).toHaveLength(3);
  });

  it('returns nothing for empty input or blank raw messages', () => {
    expect(routineRainHours([])).toEqual([]);
    expect(routineRainHours([{ ms: 5 * H, raw: '  ' }])).toEqual([]);
  });
});
