/**
 * Storage durability for offline Cards. iOS Safari clears script storage
 * after seven days without a visit unless the site is installed to the Home
 * Screen, so pinning asks for persistent storage and iOS Safari gets a
 * one-time Add to Home Screen nudge.
 */

const NUDGE_DISMISSED_KEY = 'cropcard.iosInstallNudgeDismissed';

/** iPhone, iPod or iPad Safari; not Chrome, Firefox or Edge for iOS, and
 *  not an in-app browser. iPadOS reports a Mac UA with touch. */
export function isIosSafari(userAgent: string, maxTouchPoints = 0): boolean {
  const ios =
    /iP(hone|od|ad)/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  if (!ios) return false;
  if (/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|FBAN|FBAV|Instagram|Line\//.test(userAgent)) return false;
  return /Safari\//.test(userAgent) && /Version\//.test(userAgent);
}

export function shouldNudgeInstall(input: {
  userAgent: string;
  maxTouchPoints?: number;
  standalone: boolean;
  dismissed: boolean;
}): boolean {
  return (
    !input.standalone && !input.dismissed && isIosSafari(input.userAgent, input.maxTouchPoints)
  );
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  try {
    return window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  } catch {
    return false;
  }
}

function nudgeDismissed(): boolean {
  try {
    return localStorage.getItem(NUDGE_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function installNudgeWanted(): boolean {
  if (typeof navigator === 'undefined') return false;
  return shouldNudgeInstall({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone: isStandalone(),
    dismissed: nudgeDismissed()
  });
}

export function dismissInstallNudge(): void {
  try {
    localStorage.setItem(NUDGE_DISMISSED_KEY, '1');
  } catch {
    /* private mode: the nudge comes back next visit */
  }
}

/** Asks the browser to keep this site's storage. True when it is (or
 *  already was) persistent. */
export async function requestPersistentStorage(): Promise<boolean> {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (!storage?.persist) return false;
  try {
    if (await storage.persisted?.()) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}
