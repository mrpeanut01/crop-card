import { describe, expect, it } from 'vitest';
import { contentDisposition, extensionFor, slugify, titleFromName } from './documentAccess';

describe('document file names', () => {
  it('slugs titles to a-z0-9- and at most 60 characters', () => {
    expect(slugify('Virginia Tech Soil Report, Spring 2026')).toBe(
      'virginia-tech-soil-report-spring-2026'
    );
    expect(slugify('Évaluation du sol')).toBe('evaluation-du-sol');
    expect(slugify('../../etc/passwd')).toBe('etc-passwd');
    expect(slugify('!!!')).toBe('file');
    expect(slugify('a'.repeat(100)).length).toBe(60);
    expect(slugify(`${'a'.repeat(59)} b`)).toBe('a'.repeat(59));
  });

  it('builds an RFC 6266 disposition from the title and the stored type', () => {
    expect(contentDisposition('Lab "report" / 2026', 'application/pdf')).toBe(
      `attachment; filename="lab-report-2026.pdf"; filename*=UTF-8''Lab%20report%20%202026.pdf`
    );
    expect(contentDisposition('Label', 'image/jpeg').startsWith('inline;')).toBe(true);
    expect(contentDisposition('Sales', 'text/csv; charset=utf-8')).toContain('.csv');
    expect(contentDisposition('x\r\nSet-Cookie: a=b', 'image/png')).not.toMatch(/[\r\n]/);
    expect(extensionFor('application/x-unknown')).toBe('bin');
  });

  it('titles a file from its name without folders or extension', () => {
    expect(titleFromName('C:\\Users\\me\\soil_report_2026.pdf')).toBe('soil report 2026');
    expect(titleFromName('label.final.jpeg')).toBe('label.final');
    expect(titleFromName('')).toBe('Untitled file');
    expect(titleFromName(undefined)).toBe('Untitled file');
    expect(titleFromName('a\u0000b.pdf')).toBe('ab');
  });
});
