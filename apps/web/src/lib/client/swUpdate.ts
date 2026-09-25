/**
 * Service-worker update prompt plumbing. The Workbox SW is generated with
 * `registerType: 'prompt'`, so a new version installs and then waits; it
 * only takes over when the page posts SKIP_WAITING. We never do that on
 * our own (a form may hold unsaved field data) — only when the operator
 * taps "Reload" on the update toast.
 */

type SwRegistration = Pick<ServiceWorkerRegistration, 'waiting' | 'installing' | 'update'> &
  EventTarget;

type SwContainer = Pick<ServiceWorkerContainer, 'controller'> & EventTarget;

export function watchForWaitingWorker(
  reg: SwRegistration,
  container: SwContainer,
  onWaiting: (worker: ServiceWorker) => void
): () => void {
  if (reg.waiting && container.controller) onWaiting(reg.waiting);

  const trackInstalling = () => {
    const worker = reg.installing;
    if (!worker) return;
    const onState = () => {
      if (worker.state !== 'installed') return;
      worker.removeEventListener('statechange', onState);
      // No controller means this is the first install, not an update.
      if (container.controller) onWaiting(reg.waiting ?? worker);
    };
    worker.addEventListener('statechange', onState);
  };

  reg.addEventListener('updatefound', trackInstalling);
  return () => reg.removeEventListener('updatefound', trackInstalling);
}

export function activateWaitingWorker(
  worker: Pick<ServiceWorker, 'postMessage'>,
  container: EventTarget,
  reload: () => void
): void {
  let reloaded = false;
  container.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    reload();
  });
  worker.postMessage({ type: 'SKIP_WAITING' });
}

/** Layout-mount entry point. Resolves once the SW is ready; re-checks for
 *  a new version whenever the tab becomes visible again. */
export async function watchServiceWorkerUpdates(
  onWaiting: (worker: ServiceWorker) => void
): Promise<() => void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => {};
  const container = navigator.serviceWorker;
  const reg = await container.ready;
  const stop = watchForWaitingWorker(reg, container, onWaiting);
  const onVisible = () => {
    if (document.visibilityState === 'visible') reg.update().catch(() => undefined);
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    stop();
    document.removeEventListener('visibilitychange', onVisible);
  };
}
