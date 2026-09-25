import { describe, it, expect, vi } from 'vitest';
import { watchForWaitingWorker, activateWaitingWorker } from './swUpdate';

class FakeWorker extends EventTarget {
  state: ServiceWorkerState = 'installing';
  postMessage = vi.fn();
  setState(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

class FakeRegistration extends EventTarget {
  waiting: ServiceWorker | null = null;
  installing: ServiceWorker | null = null;
  update = vi.fn(async () => undefined as unknown as ServiceWorkerRegistration);
}

class FakeContainer extends EventTarget {
  controller: ServiceWorker | null = null;
}

const asWorker = (w: FakeWorker) => w as unknown as ServiceWorker;

describe('watchForWaitingWorker', () => {
  it('reports a worker already waiting when the page is controlled', () => {
    const reg = new FakeRegistration();
    const container = new FakeContainer();
    container.controller = asWorker(new FakeWorker());
    const waiting = asWorker(new FakeWorker());
    reg.waiting = waiting;
    const onWaiting = vi.fn();
    watchForWaitingWorker(reg, container, onWaiting);
    expect(onWaiting).toHaveBeenCalledWith(waiting);
  });

  it('ignores the first install (no controller yet)', () => {
    const reg = new FakeRegistration();
    const container = new FakeContainer();
    const onWaiting = vi.fn();
    watchForWaitingWorker(reg, container, onWaiting);
    const worker = new FakeWorker();
    reg.installing = asWorker(worker);
    reg.dispatchEvent(new Event('updatefound'));
    worker.setState('installed');
    expect(onWaiting).not.toHaveBeenCalled();
  });

  it('reports an update once the new worker finishes installing', () => {
    const reg = new FakeRegistration();
    const container = new FakeContainer();
    container.controller = asWorker(new FakeWorker());
    const onWaiting = vi.fn();
    watchForWaitingWorker(reg, container, onWaiting);
    const worker = new FakeWorker();
    reg.installing = asWorker(worker);
    reg.dispatchEvent(new Event('updatefound'));
    expect(onWaiting).not.toHaveBeenCalled();
    reg.waiting = asWorker(worker);
    worker.setState('installed');
    expect(onWaiting).toHaveBeenCalledTimes(1);
    expect(onWaiting).toHaveBeenCalledWith(asWorker(worker));
  });

  it('stops listening after cleanup', () => {
    const reg = new FakeRegistration();
    const container = new FakeContainer();
    container.controller = asWorker(new FakeWorker());
    const onWaiting = vi.fn();
    const stop = watchForWaitingWorker(reg, container, onWaiting);
    stop();
    const worker = new FakeWorker();
    reg.installing = asWorker(worker);
    reg.dispatchEvent(new Event('updatefound'));
    worker.setState('installed');
    expect(onWaiting).not.toHaveBeenCalled();
  });
});

describe('activateWaitingWorker', () => {
  it('posts SKIP_WAITING and reloads exactly once on controllerchange', () => {
    const worker = new FakeWorker();
    const container = new FakeContainer();
    const reload = vi.fn();
    activateWaitingWorker(worker, container, reload);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reload).not.toHaveBeenCalled();
    container.dispatchEvent(new Event('controllerchange'));
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
