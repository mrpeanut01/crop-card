export interface RatePreviewInput {
  amount: number;
  unit: string;
}

export type RatePreview =
  | { kind: 'calibrated'; label: string; gpa: number }
  | { kind: 'uncalibrated'; label: string }
  | { kind: 'no-sprayer'; label: string };

export function herbicideRatePreview(
  rate: RatePreviewInput,
  sprayer: { calibratedGpa: number | null } | null | undefined
): RatePreview {
  const base = `${rate.amount} ${rate.unit}/A`;
  if (!sprayer) return { kind: 'no-sprayer', label: `${base} · pick a sprayer for GPA` };
  const gpa = sprayer.calibratedGpa;
  if (gpa == null || !Number.isFinite(gpa) || gpa <= 0) {
    return { kind: 'uncalibrated', label: `${base} · sprayer uncalibrated` };
  }
  return { kind: 'calibrated', label: `${base} @ ${gpa} GPA`, gpa };
}
