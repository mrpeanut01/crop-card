/** 33B (B-44, B-50): the animal treatment log as a PDF. The document is
 *  built by `render/docs/treatmentLog.ts` and rendered by the render queue
 *  (Phase 36). Every page carries the footer line. */

import { renderPdf } from '$lib/server/pdf';
import { identityLabel } from '$lib/identity';
import type { Prefs } from '$lib/prefs';
import type { AuthenticatedUser } from '$lib/server/auth';
import { treatmentLogDoc } from '$lib/server/render/docs/treatmentLog';
import type { TreatmentLogRow } from './animalTreatmentLog';

export { treatmentLogTable } from '$lib/server/render/docs/treatmentLog';
export { exportFooter, PDF_STYLES } from '$lib/server/render/docs/parts';

export async function treatmentLogPdf(
  rows: readonly TreatmentLogRow[],
  opts: {
    farmName: string;
    from: string;
    to: string;
    footer: 'log' | 'pack';
    viewer: Pick<AuthenticatedUser, 'email' | 'phone'>;
    prefs: Prefs;
    now?: Date;
    ownerId: string;
    signal?: AbortSignal;
  }
): Promise<Buffer> {
  const spec = treatmentLogDoc(rows, {
    farmName: opts.farmName,
    from: opts.from,
    to: opts.to,
    footer: opts.footer,
    exporter: identityLabel(opts.viewer),
    prefs: opts.prefs,
    now: opts.now ?? new Date()
  });
  return renderPdf(spec, { ownerId: opts.ownerId, signal: opts.signal });
}
