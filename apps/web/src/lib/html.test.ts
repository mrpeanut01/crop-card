import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { escapeHtml } from './html';

describe('escapeHtml', () => {
  it('turns markup into literal text', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'
    );
    expect(escapeHtml("Tom's <b>gate</b> & well")).toBe(
      'Tom&#39;s &lt;b&gt;gate&lt;/b&gt; &amp; well'
    );
  });

  it('parses back to the same text and never to an element', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme-ascii' }), (s) => {
        const el = document.createElement('div');
        el.innerHTML = `<span title="${escapeHtml(s)}">${escapeHtml(s)}</span>`;
        const span = el.firstElementChild!;
        expect(span.children).toHaveLength(0);
        expect(span.getAttribute('title')).toBe(s.replace(/\r\n?/g, '\n'));
        expect(span.textContent).toBe(s.replace(/\r\n?/g, '\n'));
      })
    );
  });
});
