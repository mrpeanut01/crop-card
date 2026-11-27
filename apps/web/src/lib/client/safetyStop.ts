/** A safety stop on screen outranks every teaching element: first-use
 *  hints and beginner tips both hide while one is showing. */
export const SAFETY_STOP_SELECTOR = '[data-safety-stop], [role="alertdialog"], .stop[role="alert"]';

export function safetyStopOnScreen(root: ParentNode = document): boolean {
  return root.querySelector(SAFETY_STOP_SELECTOR) !== null;
}

/** Calls `onChange` now and whenever the page gains or loses a safety
 *  stop. Returns the function that stops watching. */
export function watchSafetyStop(onChange: (onScreen: boolean) => void): () => void {
  let frame = 0;
  const check = () => onChange(safetyStopOnScreen());
  check();
  const observer = new MutationObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(check);
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['role', 'data-safety-stop', 'class']
  });
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
  };
}
