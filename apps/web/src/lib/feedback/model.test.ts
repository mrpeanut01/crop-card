import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  FEEDBACK_PATH_MAX,
  feedbackSubmitSchema,
  feedbackTriageSchema,
  githubIssueDraft,
  sanitizeFeedbackPath
} from './model';

describe('sanitizeFeedbackPath', () => {
  it('keeps the pathname and drops the query string and fragment', () => {
    expect(sanitizeFeedbackPath('/plan?block=abc&token=secret#x')).toBe('/plan');
    expect(sanitizeFeedbackPath('/records#frag')).toBe('/records');
    expect(sanitizeFeedbackPath('https://app.cropcard.io/spray?sprayer=s1')).toBe('/spray');
  });

  it('hides invite and unsubscribe tokens in the path', () => {
    expect(sanitizeFeedbackPath('/invite/abcDEF123')).toBe('/invite/redacted');
    expect(sanitizeFeedbackPath('/unsubscribe/tok.en/x?y=1')).toBe('/unsubscribe/redacted/x');
    expect(sanitizeFeedbackPath('/plan/areas/a1')).toBe('/plan/areas/a1');
  });

  it('refuses anything that is not a same-site path', () => {
    expect(sanitizeFeedbackPath('')).toBeNull();
    expect(sanitizeFeedbackPath('plan')).toBeNull();
    expect(sanitizeFeedbackPath('//evil.example/x')).toBeNull();
    expect(sanitizeFeedbackPath(42)).toBeNull();
    expect(sanitizeFeedbackPath(null)).toBeNull();
    expect(sanitizeFeedbackPath('javascript:alert(1)')).toBeNull();
  });

  it('caps the length', () => {
    const long = `/${'a'.repeat(1000)}`;
    expect(sanitizeFeedbackPath(long)?.length).toBe(FEEDBACK_PATH_MAX);
  });

  it('never returns a query string or fragment for any input', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const out = sanitizeFeedbackPath(s);
        if (out === null) return true;
        return out.startsWith('/') && !out.includes('?') && !out.includes('#');
      })
    );
  });
});

describe('feedbackSubmitSchema', () => {
  it('accepts a kind and a message', () => {
    const r = feedbackSubmitSchema.safeParse({ kind: 'bug', message: '  The map is blank  ' });
    expect(r.success && r.data.message).toBe('The map is blank');
  });

  it('rejects unknown kinds, empty and huge messages', () => {
    expect(feedbackSubmitSchema.safeParse({ kind: 'spam', message: 'hello' }).success).toBe(false);
    expect(feedbackSubmitSchema.safeParse({ kind: 'idea', message: '  ' }).success).toBe(false);
    expect(
      feedbackSubmitSchema.safeParse({ kind: 'idea', message: 'x'.repeat(4001) }).success
    ).toBe(false);
  });
});

describe('feedbackTriageSchema', () => {
  it('only takes the five statuses', () => {
    for (const s of ['new', 'triaged', 'in-progress', 'done', 'wont-fix']) {
      expect(feedbackTriageSchema.safeParse({ status: s }).success).toBe(true);
    }
    expect(feedbackTriageSchema.safeParse({ status: 'closed' }).success).toBe(false);
  });
});

describe('githubIssueDraft', () => {
  it('titles from the first line and adds context without personal details', () => {
    const d = githubIssueDraft({
      kind: 'bug',
      message: 'Save button does nothing\nOn the spray page',
      pagePath: '/spray',
      appVersion: 'abc123',
      role: 'helper',
      createdAt: Date.UTC(2026, 8, 1)
    });
    expect(d.title).toBe('Bug: Save button does nothing');
    expect(d.body).toContain('On the spray page');
    expect(d.body).toContain('- Page: `/spray`');
    expect(d.body).toContain('- Role: helper');
    expect(d.body).toContain('2026-09-01');
  });

  it('shortens long titles', () => {
    const d = githubIssueDraft({
      kind: 'idea',
      message: 'x'.repeat(200),
      pagePath: null,
      appVersion: null,
      role: null,
      createdAt: 0
    });
    expect(d.title.length).toBeLessThanOrEqual(90);
    expect(d.title.startsWith('Idea: ')).toBe(true);
  });
});
