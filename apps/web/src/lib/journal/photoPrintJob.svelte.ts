/** The marked photo waiting to print (#869, FU869-2). The journal sets it
 *  and the Card page draws the sheet outside its `no-print` wrapper, in
 *  place of the Card's own print sheet, until the print dialog closes. */

import type { PhotoMark } from './model';

export type PhotoPrintLayout = 'letter' | 'index-4x6';

export const PHOTO_PRINT_LAYOUTS: readonly PhotoPrintLayout[] = ['letter', 'index-4x6'];

export interface PhotoPrintJob {
  /** The photo: the journal URL online, the saved data URL offline. */
  src: string;
  marks: PhotoMark[];
  steps: string[];
  /** The planting, as the journal names it. */
  title: string;
  takenAt: number;
  provenance: 'ai' | 'manual' | 'fallback';
  /** When the sheet's content was current: now online, the copy's save
   *  time offline. */
  asOf: number;
  /** Set when the sheet prints from the copy saved on this phone. */
  savedCopyAt: number | null;
  /** Care Guide "Common problems" tips for the crop, shown beside a
   *  problem mark (FU869-1 d). */
  problemTips: string[];
  layout: PhotoPrintLayout;
}

export const photoPrint = $state<{ job: PhotoPrintJob | null }>({ job: null });
