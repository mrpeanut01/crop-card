/** A short "Chrome 140 on Android" for a feedback card; the full string
 *  stays on the row for anyone who needs it. */
export function browserSummary(ua: string | null | undefined): string {
  if (!ua) return 'Unknown';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Mac OS X|Macintosh/.test(ua)
        ? 'Mac'
        : /Windows/.test(ua)
          ? 'Windows'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : null;
  const pick = (re: RegExp, name: string) => {
    const m = ua.match(re);
    return m ? `${name} ${m[1]}` : null;
  };
  const browser =
    pick(/Edg(?:A|iOS)?\/(\d+)/, 'Edge') ??
    pick(/(?:OPR|Opera)\/(\d+)/, 'Opera') ??
    pick(/SamsungBrowser\/(\d+)/, 'Samsung Internet') ??
    pick(/FxiOS\/(\d+)/, 'Firefox') ??
    pick(/Firefox\/(\d+)/, 'Firefox') ??
    pick(/CriOS\/(\d+)/, 'Chrome') ??
    pick(/Chrome\/(\d+)/, 'Chrome') ??
    pick(/Version\/(\d+)[\d.]* (?:Mobile\/\S+ )?Safari/, 'Safari');
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? ua.slice(0, 40);
}
