import { describe, expect, it } from 'vitest';
import { fetchPageContent, renderPageContentForPrompt } from './scanResult';

/**
 * fetchPageContent is normally called against a live URL. To exercise the
 * HTML decomposition in isolation we stub `globalThis.fetch` with a Response
 * that streams a fixed HTML body. This keeps the test fast and offline while
 * still going through the same code path as a real request.
 */
async function extract(html: string, url = 'https://example.test/product/foo') {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' }
    })) as typeof fetch;
  try {
    return await fetchPageContent(url);
  } finally {
    globalThis.fetch = original;
  }
}

const SAMPLE_HTML = `
<!doctype html><html><head>
  <title>Bloody Butcher Dent Corn — Johnny's Selected Seeds</title>
  <meta name="description" content="Heirloom red dent corn, 110 days to maturity.">
  <meta property="og:title" content="Bloody Butcher Dent Corn">
  <meta property="og:type" content="product">
  <meta property="product:price:amount" content="4.95">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"Product","name":"Bloody Butcher Dent Corn","sku":"CORN-BB-001","offers":[{"@type":"Offer","price":"4.95","priceCurrency":"USD"}]}
  </script>
  <script type="application/ld+json">malformed { not json</script>
  <script>var trackingPixel = 1;</script>
  <style>.x { color: red }</style>
</head><body>
  <nav><a href="/">Home</a></nav>
  <h1>Bloody Butcher Dent Corn</h1>
  <h2>Overview</h2>
  <p>An heirloom red dent corn used for cornmeal and as ornamental.</p>
  <select name="size" aria-label="Pack size">
    <option value="">— Select size —</option>
    <option value="packet">Packet (1 oz, ~150 seeds) — $4.95</option>
    <option value="1lb">1 lb (~2,400 seeds) — $24.95</option>
    <option value="5lb">5 lb — $99.00</option>
  </select>
  <select id="treatment">
    <option>Untreated</option>
    <option>Treated</option>
  </select>
  <h2>Specifications</h2>
  <table>
    <tr><th>Spec</th><th>Value</th></tr>
    <tr><td>Days to Maturity</td><td>110 days</td></tr>
    <tr><td>Plant Spacing</td><td>6 inches</td></tr>
    <tr><td>Row Spacing</td><td>30 inches</td></tr>
    <tr><td>Seed Depth</td><td>1 inch</td></tr>
  </table>
  <dl>
    <dt>Sun</dt><dd>Full sun</dd>
    <dt>Mature Height</dt><dd>9 ft</dd>
  </dl>
  <footer>&copy; 2026 Johnny's</footer>
</body></html>
`;

describe('fetchPageContent', () => {
  it('decomposes a product page into title, meta, JSON-LD, selects, tables, dl, headings, body', async () => {
    const c = await extract(SAMPLE_HTML);
    expect(c.title).toMatch(/Bloody Butcher/i);
    expect(c.metaDescription).toMatch(/heirloom/i);
    expect(c.metaTags['og:title']).toBe('Bloody Butcher Dent Corn');
    expect(c.metaTags['og:type']).toBe('product');
    expect(c.metaTags['product:price:amount']).toBe('4.95');

    expect(c.jsonLd).toHaveLength(1);
    expect((c.jsonLd[0] as Record<string, unknown>).name).toBe('Bloody Butcher Dent Corn');

    expect(c.selects).toHaveLength(2);
    const size = c.selects.find((s) => s.name === 'size')!;
    expect(size.label).toBe('Pack size');
    expect(size.options).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Packet \(1 oz/),
        expect.stringMatching(/1 lb \(~2,400 seeds\)/),
        expect.stringMatching(/5 lb/)
      ])
    );
    const treatment = c.selects.find((s) => s.name === 'treatment')!;
    expect(treatment.options).toEqual(['Untreated', 'Treated']);

    expect(c.tables).toHaveLength(1);
    const rows = c.tables[0];
    expect(rows[0]).toEqual(['Spec', 'Value']);
    expect(rows).toEqual(
      expect.arrayContaining([
        ['Days to Maturity', '110 days'],
        ['Plant Spacing', '6 inches'],
        ['Row Spacing', '30 inches']
      ])
    );

    expect(c.defList).toEqual(
      expect.arrayContaining([
        { term: 'Sun', description: 'Full sun' },
        { term: 'Mature Height', description: '9 ft' }
      ])
    );

    expect(c.headings.some((h) => h.startsWith('H1: Bloody Butcher'))).toBe(true);
    expect(c.headings.some((h) => h === 'H2: Specifications')).toBe(true);

    expect(c.bodyText).toMatch(/heirloom red dent corn/i);
    expect(c.bodyText).not.toMatch(/trackingPixel/);
    expect(c.bodyText).not.toMatch(/color: red/);
  });

  it('rejects non-HTML responses', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })) as typeof fetch;
    try {
      await expect(fetchPageContent('https://example.test/x.json')).rejects.toThrow(
        /content-type/i
      );
    } finally {
      globalThis.fetch = original;
    }
  });

  it('throws on upstream HTTP errors', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('not found', {
        status: 404,
        headers: { 'content-type': 'text/html' }
      })) as typeof fetch;
    try {
      await expect(fetchPageContent('https://example.test/missing')).rejects.toThrow(/HTTP 404/);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('renderPageContentForPrompt', () => {
  it('emits labeled sections for each structured signal', async () => {
    const c = await extract(SAMPLE_HTML);
    const prompt = renderPageContentForPrompt(c);
    expect(prompt).toMatch(/URL: https:\/\/example\.test/);
    expect(prompt).toMatch(/TITLE: Bloody Butcher/);
    expect(prompt).toMatch(/JSON-LD \(schema\.org/);
    expect(prompt).toMatch(/DROPDOWNS \/ VARIANTS:/);
    expect(prompt).toMatch(/SELECT #1 name="size"/);
    expect(prompt).toMatch(/Packet \(1 oz/);
    expect(prompt).toMatch(/TABLES:/);
    expect(prompt).toMatch(/Days to Maturity \| 110 days/);
    expect(prompt).toMatch(/DEFINITION LIST:/);
    expect(prompt).toMatch(/Mature Height :: 9 ft/);
    expect(prompt).toMatch(/HEADINGS:/);
    expect(prompt).toMatch(/BODY TEXT:/);
  });
});
