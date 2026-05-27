import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const requestSchema = z.object({
  calibratedGpa: z.number().min(0.5).max(200),
  spreadInches: z.number().positive().optional(),
  ouncesCollected: z.number().nonnegative().optional(),
  notes: z.string().max(500).optional()
});

describe('POST /api/sprayers/[id]/calibration request schema (#217)', () => {
  it('accepts a reasonable in-band GPA', () => {
    expect(requestSchema.safeParse({ calibratedGpa: 15 }).success).toBe(true);
  });

  it('accepts the absolute lower bound (0.5)', () => {
    expect(requestSchema.safeParse({ calibratedGpa: 0.5 }).success).toBe(true);
  });

  it('accepts the absolute upper bound (200)', () => {
    expect(requestSchema.safeParse({ calibratedGpa: 200 }).success).toBe(true);
  });

  it('rejects 0 (was previously accepted as positive: false)', () => {
    expect(requestSchema.safeParse({ calibratedGpa: 0 }).success).toBe(false);
  });

  it('rejects above the 200 absolute clamp (was previously accepted)', () => {
    expect(requestSchema.safeParse({ calibratedGpa: 250 }).success).toBe(false);
  });

  it('rejects negative GPA', () => {
    expect(requestSchema.safeParse({ calibratedGpa: -5 }).success).toBe(false);
  });
});
