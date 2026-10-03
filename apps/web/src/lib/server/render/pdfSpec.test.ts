import { describe, expect, it } from 'vitest';
import { CC_TABLE, materializeDocDef, PAGE, PAGES, type PdfJobDoc } from './pdfSpec';

type Fn = (page: number, count: number) => unknown;

describe('materializeDocDef (R-02)', () => {
  const spec: PdfJobDoc = {
    doc: {
      content: [{ table: { body: [['a']] }, layout: CC_TABLE }, { text: 'body' }],
      info: { creationDate: new Date(5) }
    },
    header: {
      first: { text: 'Cover', style: 'farmSub' },
      rest: { text: ['Farm · page ', PAGE], style: 'farmSub' }
    },
    footer: { columns: [{ text: 'sig' }, { text: ['page ', PAGE, ' / ', PAGES] }] }
  };

  it('uses the first-page header on page 1 and the numbered one after', () => {
    const def = materializeDocDef(spec);
    expect((def.header as Fn)(1, 3)).toEqual({ text: 'Cover', style: 'farmSub' });
    expect((def.header as Fn)(2, 3)).toEqual({ text: 'Farm · page 2', style: 'farmSub' });
  });

  it('uses the rest header on every page when no first is given', () => {
    const def = materializeDocDef({
      doc: { content: [] },
      header: { rest: { text: ['p', PAGE] } }
    });
    expect((def.header as Fn)(1, 1)).toEqual({ text: 'p1' });
  });

  it('fills page and page count in the footer, joined into one string', () => {
    const def = materializeDocDef(spec);
    expect((def.footer as Fn)(2, 5)).toEqual({
      columns: [{ text: 'sig' }, { text: 'page 2 / 5' }]
    });
  });

  it('keeps a text array as an array when it holds more than strings', () => {
    const def = materializeDocDef({
      doc: { content: [] },
      footer: { text: [{ text: 'bold', bold: true }, ' ', PAGE] }
    });
    expect((def.footer as Fn)(4, 4)).toEqual({ text: [{ text: 'bold', bold: true }, ' ', '4'] });
  });

  it('gives each page its own copy, so pdfmake can annotate one freely', () => {
    const def = materializeDocDef(spec);
    const a = (def.footer as Fn)(1, 2) as Record<string, unknown>;
    a.x = 1;
    expect((def.footer as Fn)(1, 2)).not.toHaveProperty('x');
    expect(spec.footer).not.toHaveProperty('x');
  });

  it('swaps the named table layout for the green header and grey lines', () => {
    const def = materializeDocDef(spec);
    const layout = (def.content[0] as { layout: Record<string, (i: number) => unknown> }).layout;
    expect(layout.fillColor(0)).toBe('#1f5e3a');
    expect(layout.fillColor(1)).toBeNull();
    expect(layout.hLineColor(0)).toBe('#cccccc');
    expect(layout.vLineColor(0)).toBe('#cccccc');
  });

  it('never treats a plain string or a look-alike object as a page token', () => {
    const def = materializeDocDef({
      doc: { content: [] },
      footer: {
        stack: [
          { text: '{"$cc":"page"} $cc page' },
          { text: [{ $cc: 'page', extra: 1 }, 'x'] },
          { text: [{ $cc: 'other' }] }
        ]
      }
    });
    expect((def.footer as Fn)(7, 9)).toEqual({
      stack: [
        { text: '{"$cc":"page"} $cc page' },
        { text: [{ $cc: 'page', extra: 1 }, 'x'] },
        { text: [{ $cc: 'other' }] }
      ]
    });
  });

  it('leaves a layout named ccTable alone outside a table node', () => {
    const def = materializeDocDef({ doc: { content: [{ text: 'x', layout: CC_TABLE }] } });
    expect(def.content[0]).toEqual({ text: 'x', layout: CC_TABLE });
  });

  it('refuses page tokens in the body, where pdfmake has no page number', () => {
    expect(() => materializeDocDef({ doc: { content: [{ text: ['p', PAGE] }] } })).toThrow(
      /header or footer/
    );
  });

  it('copies dates instead of sharing them', () => {
    const def = materializeDocDef(spec);
    expect(def.info?.creationDate).toEqual(new Date(5));
    expect(def.info?.creationDate).not.toBe(spec.doc.info?.creationDate);
  });

  it('survives structuredClone, as postMessage copies it', () => {
    const def = materializeDocDef(structuredClone(spec));
    expect((def.header as Fn)(3, 3)).toEqual({ text: 'Farm · page 3', style: 'farmSub' });
  });
});
