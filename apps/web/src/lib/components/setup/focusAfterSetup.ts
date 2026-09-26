import { tick } from 'svelte';

const FIELD =
  'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])';
const FOCUSABLE = `${FIELD}, button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])`;

/**
 * After a setup sheet's result reloads the page, the button that opened the
 * sheet is often gone (its callout disappears once the thing exists). Moves
 * focus to the new target instead: the element itself when focusable, else
 * its first form field, else its first focusable, else the main landmark.
 */
export async function focusAfterSetup(selector: string): Promise<void> {
  await tick();
  if (typeof document === 'undefined') return;
  const root = document.querySelector<HTMLElement>(selector);
  const target =
    (root?.matches(FOCUSABLE) ? root : null) ??
    root?.querySelector<HTMLElement>(FIELD) ??
    root?.querySelector<HTMLElement>(FOCUSABLE) ??
    document.getElementById('main-content');
  target?.focus({ preventScroll: true });
}
