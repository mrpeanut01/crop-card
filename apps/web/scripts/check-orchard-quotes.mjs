#!/usr/bin/env node
/**
 * Ruling OP-18: checks every quote in orchard-calendar-sources.json against
 * the text of the guide it cites. A local tool, not CI: the guide PDFs are
 * never committed.
 *
 * Usage:
 *   node apps/web/scripts/check-orchard-quotes.mjs <textDir>
 *
 * <textDir> holds one text file per guide, with a line "=====PAGE N====="
 * before each PDF page (N counts from 1), and a map.json:
 *   { "<source url>": { "file": "ENTO-638.txt", "pageOffset": 8 } }
 * pageOffset is added to a printed page number ("59") to reach the PDF page;
 * a page written "PDF page 9" is used as is. A quote may run onto the next
 * page. See plugins/orchard-calendars/README.md for making the text files.
 *
 * Matching ignores case, spaces and punctuation. A table quote (cells joined
 * with " / ", or a note saying a footnote marker was left out) is matched
 * cell by cell with digits ignored too, so footnote markers drop out.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const textDir = process.argv[2];
if (!textDir) {
  console.error('usage: check-orchard-quotes.mjs <textDir>');
  process.exit(2);
}

const sources = JSON.parse(readFileSync(path.join(here, 'orchard-calendar-sources.json'), 'utf8'));
const map = JSON.parse(readFileSync(path.join(textDir, 'map.json'), 'utf8'));

const norm = (s, digits) =>
  s
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(digits ? /[^a-z0-9]/g : /[^a-z]/g, '');

const pageCache = new Map();
function pagesOf(file) {
  if (!pageCache.has(file)) {
    const parts = readFileSync(path.join(textDir, file), 'utf8').split(/=====PAGE (\d+)=====/);
    const pages = new Map();
    for (let i = 1; i < parts.length; i += 2) pages.set(Number(parts[i]), parts[i + 1]);
    pageCache.set(file, pages);
  }
  return pageCache.get(file);
}

let checked = 0;
const problems = [];
for (const [key, entry] of Object.entries(sources.entries)) {
  entry.sources.forEach((s, i) => {
    const at = `${key}.sources.${i}`;
    const target = map[s.url];
    if (!target) {
      problems.push(`${at}: no text file mapped for ${s.url}`);
      return;
    }
    const n = Number(String(s.page).match(/\d+/)?.[0]);
    const pdfPage = /^PDF page/i.test(s.page) ? n : n + (target.pageOffset ?? 0);
    const pages = pagesOf(target.file);
    const body = (pages.get(pdfPage) ?? '') + (pages.get(pdfPage + 1) ?? '');
    const table = s.quote.includes(' / ') || /footnote marker/i.test(s.note ?? '');
    const parts = table ? s.quote.split(' / ') : [s.quote];
    for (const part of parts) {
      if (!norm(body, !table).includes(norm(part, !table))) {
        problems.push(`${at}: not found on PDF page ${pdfPage}: ${part.slice(0, 80)}`);
      }
    }
    checked += 1;
  });
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} problem(s) in ${checked} sources`);
  process.exit(1);
}
console.log(`All ${checked} orchard calendar quotes found on their cited pages.`);
