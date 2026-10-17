// EPA PPLS label file names, shared by the source drift check
// (scripts/lib/sourceDrift.mjs) and the app (src/lib/plugins/
// earlierRegistration.ts, src/lib/plugins/pesticideLabelSources.ts).
//
// A file is `<company>-<product>[-<distributor>]-<yyyymmdd>.pdf`, numbers
// zero-padded: `066330-00276-20090911.pdf` is registration 66330-276 stamped
// 2009-09-11, and `001381-00146-34704-20200101.pdf` is distributor
// registration 1381-146-34704 of base registration 1381-146.

/**
 * @typedef {object} PplsFile
 * @property {string} registration  Full registration, distributor included ("1381-146-34704").
 * @property {string} base  Company and product only ("1381-146").
 * @property {string | null} distributor  Distributor number, or null ("34704").
 * @property {string} stamped  The stamp date as yyyy-mm-dd.
 */

const PPLS_FILE = /\/ppls\/(\d+)-(\d+)(?:-(\d+))?-(\d{8})\.pdf$/i;

/**
 * The registration and stamp date a PPLS label URL (or URL path) names, or
 * null for anything else. A query string or fragment is ignored.
 * @param {unknown} url
 * @returns {PplsFile | null}
 */
export function parsePplsFile(url) {
  if (typeof url !== 'string') return null;
  const m = PPLS_FILE.exec(url.trim().split(/[?#]/)[0]);
  if (!m) return null;
  const [, company, product, distributor, date] = m;
  const base = `${Number(company)}-${Number(product)}`;
  const dist = distributor === undefined ? null : String(Number(distributor));
  return {
    registration: dist === null ? base : `${base}-${dist}`,
    base,
    distributor: dist,
    stamped: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
  };
}

/**
 * A base registration ("100-1182") as its PPLS file stem ("000100-01182").
 * Anything else, a distributor number included, gives null.
 * @param {string} reg
 * @returns {string | null}
 */
export function pplsBaseStem(reg) {
  const m = /^(\d+)-(\d+)$/.exec(reg);
  return m ? `${m[1].padStart(6, '0')}-${m[2].padStart(5, '0')}` : null;
}
