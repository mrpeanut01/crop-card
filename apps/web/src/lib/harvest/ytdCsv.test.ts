import { describe, expect, it } from 'vitest';
import { harvestYtdCsv } from './ytdCsv';

describe('harvestYtdCsv', () => {
  it('quotes every cell and neutralises spreadsheet formulas', () => {
    const csv = harvestYtdCsv([
      ['2026-07-01', 'North "A"', 'tomato', '=HYPERLINK("http://x")', '@SUM(1)'],
      ['2026-07-02', '+B', 'corn', '12 bu', '-1+1']
    ]);
    expect(csv.split('\n')).toEqual([
      '"Date","Block","Crop plugin","Quantity","Lot #"',
      `"2026-07-01","North ""A""","tomato","'=HYPERLINK(""http://x"")","'@SUM(1)"`,
      `"2026-07-02","'+B","corn","12 bu","'-1+1"`
    ]);
  });
});
