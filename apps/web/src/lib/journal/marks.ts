/** Marks Claude places over a photo (Phase 37F, R-13 and R-14). Pure and
 *  client-safe. One bad mark refuses the whole set, so a grower never sees
 *  half an answer drawn on their plant. Labels go through the one spray
 *  advice guard in `photoHelp.ts` (C-8), then the diagnosis check, and a
 *  `problem` label through the treatment check too (`markGuard.ts`, #869). */

import { PHOTO_MARK_KINDS, type PhotoMark, type PhotoMarkKind } from './model';
import { asksForSprayAdvice } from './photoHelp';
import { namesDiagnosis, namesTreatment } from './markGuard';

export const MAX_PHOTO_MARKS = 12;
export const MAX_MARK_LABEL = 40;
export const MAX_MARK_STEPS = 12;
export const MAX_MARK_STEP_CHARS = 240;

export type MarksRefusal =
  | 'not-a-list'
  | 'too-many'
  | 'not-an-object'
  | 'bad-kind'
  | 'bad-coordinate'
  | 'bad-size'
  | 'bad-label'
  | 'spray-label'
  | 'diagnosis-label'
  | 'treatment-label';

export type ParsedMarks = { ok: true; marks: PhotoMark[] } | { ok: false; reason: MarksRefusal };

const KINDS: ReadonlySet<string> = new Set(PHOTO_MARK_KINDS);

function unit(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
}

function size(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1;
}

/** True when a label names a product, a spray, a rate or asks for one.
 *  `asksForSprayAdvice` runs `isSprayAdvice` plus the question patterns and
 *  undoes leetspeak, so a label is held to the stricter of the two. */
export function isUnsafeMarkLabel(label: string, sprayTerms?: readonly string[]): boolean {
  return asksForSprayAdvice(label, sprayTerms);
}

function oneMark(
  raw: unknown,
  sprayTerms?: readonly string[],
  diagnosisTerms?: readonly string[]
): PhotoMark | MarksRefusal {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'not-an-object';
  const m = raw as Record<string, unknown>;
  if (typeof m.kind !== 'string' || !KINDS.has(m.kind)) return 'bad-kind';
  if (!unit(m.x) || !unit(m.y)) return 'bad-coordinate';
  if (m.w !== undefined && !size(m.w)) return 'bad-size';
  if (m.h !== undefined && !size(m.h)) return 'bad-size';
  if (size(m.w) && m.x + m.w > 1 + 1e-9) return 'bad-size';
  if (size(m.h) && m.y + m.h > 1 + 1e-9) return 'bad-size';
  if (typeof m.label !== 'string') return 'bad-label';
  const label = m.label.replace(/\s+/g, ' ').trim();
  if (label.length < 1 || label.length > MAX_MARK_LABEL) return 'bad-label';
  if (isUnsafeMarkLabel(label, sprayTerms)) return 'spray-label';
  if (namesDiagnosis(label, diagnosisTerms)) return 'diagnosis-label';
  if (m.kind === 'problem' && namesTreatment(label)) return 'treatment-label';
  const mark: PhotoMark = { kind: m.kind as PhotoMarkKind, x: m.x, y: m.y, label };
  if (m.w !== undefined) mark.w = m.w as number;
  if (m.h !== undefined) mark.h = m.h as number;
  return mark;
}

/** The validated marks, or why the whole set was refused. Coordinates are 0
 *  to 1 of the stored photo; `w` and `h`, when given, keep the box inside it.
 *  Every label goes through `isUnsafeMarkLabel` and `namesDiagnosis` (with
 *  the library's `markDiagnosisTerms`); a `problem` label also through
 *  `namesTreatment`. */
export function parseMarks(
  raw: unknown,
  sprayTerms?: readonly string[],
  diagnosisTerms?: readonly string[]
): ParsedMarks {
  if (!Array.isArray(raw)) return { ok: false, reason: 'not-a-list' };
  if (raw.length > MAX_PHOTO_MARKS) return { ok: false, reason: 'too-many' };
  const marks: PhotoMark[] = [];
  for (const item of raw) {
    const out = oneMark(item, sprayTerms, diagnosisTerms);
    if (typeof out === 'string') return { ok: false, reason: out };
    marks.push(out);
  }
  return { ok: true, marks };
}

export interface MarksAnswer {
  steps: string[];
  marks: unknown;
}

/** Reads Claude's `{ steps, marks }` JSON, tolerating a code fence or prose
 *  around it. Null when there is no object with a list of steps. */
export function readMarksAnswer(text: string): MarksAnswer | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  if (!Array.isArray(o.steps)) return null;
  const steps = o.steps
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.replace(/\s+/g, ' ').trim().slice(0, MAX_MARK_STEP_CHARS))
    .filter(Boolean)
    .slice(0, MAX_MARK_STEPS);
  return { steps, marks: o.marks };
}
