/** Splits a whole-print card (the Spray Card) into numbered cards for small
 *  paper so nothing fades or is left off (#581, rulings SC-1 to SC-9 in
 *  docs/design/SPRAY_CARD_PRINT.md). Pure and deterministic: every height is
 *  estimated from character counts against the fixed print sizes in
 *  CardView's `.whole` styles, with room to spare, and the print-fit e2e
 *  test checks the estimate against real layout. */

import { t } from '$lib/i18n';
import { provenanceText } from '$lib/provenanceLabels';
import type { CardFact, CardModel, CardPrintLayout, CardSection } from './model';

/** Inches. Keep in step with print.css cells and CardView `.whole`. */
export const WHOLE_PRINT = {
  /** Body box inside the print cell, after cell padding, strip and body padding. */
  box: {
    'index-4x6': { w: 5.49, h: 3.55 },
    'index-3x5': { w: 4.49, h: 2.55 },
    'letter-4up': { w: 3.44, h: 4.75 }
  },
  gap: 0.05,
  qr: 0.7,
  qrGap: 0.08,
  colGap: 0.12,
  rowGap: 0.04,
  /** Grid padding and its two rules. */
  gridPad: 0.08,
  ulIndentEm: 1.1,
  lineHeight: 1.25,
  pt: {
    kicker: 8,
    title: 13,
    notice: 8.5,
    dt: 7,
    dd: 10,
    h4: 7.5,
    li: 9,
    next: 9,
    cont: 8,
    foot: 7
  },
  /** Fraction of the box the estimate may fill. */
  fill: 0.97
} as const;

/** Average advance per character, in em, padded above IBM Plex Sans and
 *  Source Serif's real averages so wraps are over-counted, never under. */
const EM = { text: 0.52, bold: 0.56, caps: 0.74, serif: 0.52 } as const;

export type SmallLayout = keyof typeof WHOLE_PRINT.box;

/** Width of the main column; the QR and short URL sit in a rail beside it. */
export function mainWidth(layout: SmallLayout, ctx: WholePrintContext): number {
  const w = WHOLE_PRINT.box[layout].w;
  return ctx.qr ? w - WHOLE_PRINT.qr - WHOLE_PRINT.qrGap : w;
}

export function isSmallLayout(layout: CardPrintLayout): layout is SmallLayout {
  return layout in WHOLE_PRINT.box;
}

const IN_PER_PT = 1 / 72;

/** Greedy word wrap with a fixed character width. */
export function wrapLines(text: string, widthIn: number, pt: number, em: number): number {
  const perLine = Math.max(1, Math.floor(widthIn / (pt * em * IN_PER_PT)));
  let lines = 0;
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines += 1;
      continue;
    }
    let used = 0;
    lines += 1;
    for (const w of words) {
      const len = w.length;
      if (used === 0) {
        if (len > perLine) {
          lines += Math.ceil(len / perLine) - 1;
          used = len % perLine || perLine;
        } else used = len;
      } else if (used + 1 + len <= perLine) used += 1 + len;
      else {
        lines += 1;
        if (len > perLine) {
          lines += Math.ceil(len / perLine) - 1;
          used = len % perLine || perLine;
        } else used = len;
      }
    }
  }
  return lines;
}

function textHeight(text: string, widthIn: number, pt: number, em: number): number {
  return wrapLines(text, widthIn, pt, em) * pt * WHOLE_PRINT.lineHeight * IN_PER_PT;
}

const P = WHOLE_PRINT.pt;

function factWide(f: CardFact, colW: number): boolean {
  return wrapLines(f.value, colW, P.dd, EM.text) > 2 || wrapLines(f.label, colW, P.dt, EM.caps) > 1;
}

function factHeight(f: CardFact, w: number): number {
  return (
    textHeight(f.label, w, P.dt, EM.caps) +
    0.02 +
    textHeight(f.printValue ?? f.value, w, P.dd, EM.text) +
    (f.note ? textHeight(f.note, w, P.dd, EM.text) : 0)
  );
}

type FactRow = CardFact[];

function factRows(facts: CardFact[], boxW: number): FactRow[] {
  const colW = (boxW - WHOLE_PRINT.colGap) / 2;
  const rows: FactRow[] = [];
  let pending: CardFact | null = null;
  for (const f of facts) {
    if (factWide(f, colW)) {
      if (pending) rows.push([pending]);
      pending = null;
      rows.push([f]);
    } else if (pending) {
      rows.push([pending, f]);
      pending = null;
    } else pending = f;
  }
  if (pending) rows.push([pending]);
  return rows;
}

function rowHeight(row: FactRow, boxW: number): number {
  const colW = (boxW - WHOLE_PRINT.colGap) / 2;
  if (row.length === 1 && factWide(row[0], colW)) return factHeight(row[0], boxW);
  return Math.max(...row.map((f) => factHeight(f, colW)));
}

/** The fact grid as CSS lays it out: pairs, with long facts on their own row. */
function gridHeight(facts: CardFact[], boxW: number): number {
  if (!facts.length) return 0;
  return (
    WHOLE_PRINT.gridPad +
    WHOLE_PRINT.gap +
    factRows(facts, boxW).reduce((h, r) => h + rowHeight(r, boxW) + WHOLE_PRINT.rowGap, 0)
  );
}

function sectionHeight(s: CardSection, boxW: number): number {
  const itemW = boxW - WHOLE_PRINT.ulIndentEm * P.li * IN_PER_PT;
  const items = s.items.reduce((h, i) => h + textHeight(i, itemW, P.li, EM.text), 0);
  return textHeight(s.title, boxW, P.h4, EM.caps) + 0.03 + items;
}

function noticesHeight(notices: string[], boxW: number): number {
  return notices.reduce((h, n) => h + textHeight(n, boxW, P.notice, EM.bold) + 0.015, 0);
}

type Block =
  { kind: 'rows'; rows: FactRow[] } | { kind: 'section'; section: CardSection } | { kind: 'next' };

interface Draft {
  notices: string[];
  facts: CardFact[];
  sections: CardSection[];
  next: boolean;
}

export interface WholePrintContext {
  locale?: string | null;
  /** The QR prints (an origin is known). */
  qr: boolean;
  /** The printed short URL, for its width. */
  url?: string | null;
}

function partLabel(n: number, of: number, locale?: string | null): string {
  return t(locale, 'cardsui.part', { n, of });
}

export function continuedLabel(n: number, of: number, locale?: string | null): string {
  return t(locale, 'cardsui.continued', { next: n + 1, of });
}

/** Height of everything on a part that is not packed content. */
function chromeHeight(card: CardModel, boxW: number, ctx: WholePrintContext, ref: string): number {
  const header = `${card.kicker}   ${partLabel(88, 88, ctx.locale)}${ref ? ` · ${ref}` : ''}`;
  const head = textHeight(header, boxW, P.kicker, EM.caps);
  const title = textHeight(card.title, boxW, P.title, EM.serif);
  const footText = [
    t(ctx.locale, 'cardsui.asOf', { date: 'Sep 30, 2026, 12:00 PM' }),
    card.rulesVersion ? t(ctx.locale, 'cardsui.rulesVersion', { version: card.rulesVersion }) : '',
    provenanceText(card.provenance, ctx.locale)
  ]
    .filter(Boolean)
    .join(' · ');
  const foot = textHeight(footText, boxW, P.foot, EM.text);
  const cont = textHeight(continuedLabel(88, 88, ctx.locale), boxW, P.cont, EM.text);
  return head + title + foot + cont + 4 * WHOLE_PRINT.gap;
}

function blockHeight(b: Block, card: CardModel, boxW: number, ctx: WholePrintContext): number {
  if (b.kind === 'rows')
    return b.rows.reduce((h, r) => h + rowHeight(r, boxW) + WHOLE_PRINT.rowGap, 0);
  if (b.kind === 'section') return sectionHeight(b.section, boxW);
  const next = card.next ? `${t(ctx.locale, 'cardsui.next')} ${card.next.label}` : '';
  return textHeight(next, boxW, P.next, EM.bold);
}

/** Splits a section whose items do not fit one card into item runs that do.
 *  A single item taller than a card stays whole and wraps on its own card. */
function splitSection(s: CardSection, budget: number, boxW: number): CardSection[] {
  const out: CardSection[] = [];
  let items: string[] = [];
  for (const item of s.items) {
    const next = { ...s, items: [...items, item] };
    if (items.length && sectionHeight(next, boxW) > budget) {
      out.push({ ...s, items });
      items = [item];
    } else items.push(item);
  }
  if (items.length) out.push({ ...s, items });
  return out;
}

/** Packs blocks onto cards in order. Each card starts with `lead` notices. */
function pack(
  blocks: Block[],
  card: CardModel,
  boxW: number,
  budget: number,
  firstLead: string[],
  restLead: string[],
  ctx: WholePrintContext
): Draft[] {
  const drafts: Draft[] = [];
  let cur: Draft | null = null;
  let used = 0;
  const open = () => {
    const lead = drafts.length === 0 ? firstLead : restLead;
    cur = { notices: lead, facts: [], sections: [], next: false };
    drafts.push(cur);
    used = lead.length ? noticesHeight(lead, boxW) + WHOLE_PRINT.gap : 0;
  };
  const room = () => budget - used;
  const cost = (b: Block, d: Draft) =>
    b.kind === 'rows'
      ? gridHeight([...d.facts, ...b.rows.flat()], boxW) - gridHeight(d.facts, boxW)
      : blockHeight(b, card, boxW, ctx) + WHOLE_PRINT.gap;
  const place = (b: Block) => {
    const d = cur!;
    used += cost(b, d);
    if (b.kind === 'rows') {
      const colW = (boxW - WHOLE_PRINT.colGap) / 2;
      for (const row of b.rows)
        for (const f of row)
          d.facts.push(row.length === 1 && factWide(f, colW) ? { ...f, printWide: true } : f);
    } else if (b.kind === 'section') d.sections.push(b.section);
    else d.next = true;
  };

  /** A new card helps when this one holds content, or only the long
   *  first-card notices that the next card swaps for the short repeat. */
  const canMove = () =>
    !!(cur!.facts.length || cur!.sections.length || cur!.next) || cur!.notices !== restLead;

  open();
  for (const b of blocks) {
    if (b.kind === 'rows') {
      for (const row of b.rows) {
        const one: Block = { kind: 'rows', rows: [row] };
        if (cost(one, cur!) > room() && canMove()) open();
        place(one);
      }
      continue;
    }
    if (b.kind === 'section') {
      if (cost(b, cur!) <= room()) {
        place(b);
        continue;
      }
      if (canMove()) open();
      if (cost(b, cur!) <= room()) {
        place(b);
        continue;
      }
      const runs = splitSection(b.section, room() - WHOLE_PRINT.gap, boxW);
      runs.forEach((section, i) => {
        if (i > 0) open();
        place({ kind: 'section', section });
      });
      continue;
    }
    if (cost(b, cur!) > room() && canMove()) open();
    place(b);
  }
  return drafts.filter((d) => d.facts.length || d.sections.length || d.next || d.notices.length);
}

/** The numbered cards a whole-print card prints as on `layout`. Other cards,
 *  and Letter full pages, come back unchanged. */
export function wholePrintParts(
  card: CardModel,
  layout: CardPrintLayout,
  ctx: WholePrintContext
): CardModel[] {
  if (!card.printWhole || !isSmallLayout(layout)) return [card];
  const box = WHOLE_PRINT.box[layout];
  const ref = card.printRef ?? '';
  const repeat = card.printRepeatNotices ?? [];
  const notices = card.notices ?? [];
  const w = mainWidth(layout, ctx);
  const budget = box.h * WHOLE_PRINT.fill - chromeHeight(card, w, ctx, ref);

  const own = card.sections.filter((s) => s.ownCard);
  const rest = card.sections.filter((s) => !s.ownCard);
  const core = card.facts.filter((f) => f.core);
  const other = card.facts.filter((f) => !f.core);

  const deconDrafts = own.length
    ? pack(
        own.map((section) => ({ kind: 'section', section })),
        card,
        w,
        budget,
        repeat,
        repeat,
        ctx
      )
    : [];

  const blocks: Block[] = [];
  if (core.length) blocks.push({ kind: 'rows', rows: factRows(core, w) });
  for (const section of rest) blocks.push({ kind: 'section', section });
  if (other.length) blocks.push({ kind: 'rows', rows: factRows(other, w) });
  if (card.next) blocks.push({ kind: 'next' });
  const productDrafts = pack(blocks, card, w, budget, notices, repeat, ctx);

  const drafts = [...deconDrafts, ...productDrafts];
  const of = drafts.length;
  const firstProduct = deconDrafts.length;
  return drafts.map((d, i) => {
    const part: CardModel = {
      ...card,
      notices: d.notices,
      facts: d.facts,
      sections: d.sections,
      printPart: {
        n: i + 1,
        of,
        ...(ref && i !== firstProduct ? { ref } : {})
      }
    };
    if (!d.next) delete part.next;
    return part;
  });
}

/** The content height a part may use on `layout` (tests). */
export function wholePrintBudget(
  card: CardModel,
  layout: SmallLayout,
  ctx: WholePrintContext,
  fill: number = WHOLE_PRINT.fill
): number {
  const box = WHOLE_PRINT.box[layout];
  const w = mainWidth(layout, ctx);
  return box.h * fill - chromeHeight(card, w, ctx, card.printRef ?? '');
}

/** The estimated content height of one part (tests). */
export function partContentHeight(
  part: CardModel,
  layout: SmallLayout,
  ctx: WholePrintContext
): number {
  const w = mainWidth(layout, ctx);
  const notices = part.notices ?? [];
  let h = notices.length ? noticesHeight(notices, w) + WHOLE_PRINT.gap : 0;
  h += gridHeight(part.facts, w);
  for (const s of part.sections) h += sectionHeight(s, w) + WHOLE_PRINT.gap;
  if (part.next) h += blockHeight({ kind: 'next' }, part, w, ctx) + WHOLE_PRINT.gap;
  return h;
}
