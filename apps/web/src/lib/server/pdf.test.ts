// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { renderPdf } from './pdf';
import { PAGE, PAGES } from './render/pdfSpec';

const ctx = { ownerId: 'o-pdf-test' };

describe('renderPdf', () => {
  it('renders a document with standard fonts and a page-numbered footer', async () => {
    const buffer = await renderPdf(
      {
        doc: {
          content: ['plain', { text: 'bold', bold: true }, { text: 'italic', italics: true }],
          defaultStyle: { font: 'Roboto' }
        },
        footer: { text: [PAGE, ' / ', PAGES] }
      },
      ctx
    );
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('refuses to load remote images', async () => {
    await expect(
      renderPdf({ doc: { content: [{ image: 'https://example.com/x.png' }] } }, ctx)
    ).rejects.toThrow(/access policy/i);
  });
});
