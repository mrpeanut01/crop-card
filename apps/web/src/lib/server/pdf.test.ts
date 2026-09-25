// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { renderPdf } from './pdf';

describe('renderPdf', () => {
  it('renders a document with standard fonts and page callbacks', async () => {
    const buffer = await renderPdf({
      content: ['plain', { text: 'bold', bold: true }, { text: 'italic', italics: true }],
      footer: (page, count) => ({ text: `${page} / ${count}` }),
      defaultStyle: { font: 'Roboto' }
    });
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('refuses to load remote images', async () => {
    await expect(renderPdf({ content: [{ image: 'https://example.com/x.png' }] })).rejects.toThrow(
      /access policy/i
    );
  });
});
