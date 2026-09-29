import { describe, expect, it } from 'vitest';
import { browserSummary } from './userAgent';

describe('browserSummary', () => {
  it('names the browser and system in a few words', () => {
    expect(
      browserSummary(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
      )
    ).toBe('Chrome 140 on Linux');
    expect(
      browserSummary(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
      )
    ).toBe('Safari 18 on iOS');
    expect(
      browserSummary(
        'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0 Mobile Safari/537.36 EdgA/139.0'
      )
    ).toBe('Edge 139 on Android');
    expect(browserSummary(null)).toBe('Unknown');
  });
});
