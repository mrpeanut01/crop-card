/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import LabelCapture from './LabelCapture.svelte';
import BarcodeScanner from './BarcodeScanner.svelte';

const page = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock('$app/state', () => ({ page }));

const original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

afterEach(() => {
  if (original) Object.defineProperty(navigator, 'mediaDevices', original);
  else delete (navigator as unknown as Record<string, unknown>).mediaDevices;
});

function pendingCamera() {
  const stop = vi.fn();
  let grant!: () => void;
  const getUserMedia = vi.fn(
    () =>
      new Promise((resolve) => {
        grant = () => resolve({ getTracks: () => [{ stop }] });
      })
  );
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia }
  });
  return { stop, grant: () => grant(), getUserMedia };
}

describe.each([
  ['LabelCapture', LabelCapture],
  ['BarcodeScanner', BarcodeScanner]
] as const)('%s', (_name, Component) => {
  it('stops the camera when closed before the camera finished starting', async () => {
    const cam = pendingCamera();
    const props = { onCapture: vi.fn(), onDetected: vi.fn(), onClose: vi.fn() };
    const { unmount } = render(Component as typeof LabelCapture, { props });
    await vi.waitFor(() => expect(cam.getUserMedia).toHaveBeenCalled());
    unmount();
    cam.grant();
    await vi.waitFor(() => expect(cam.stop).toHaveBeenCalled());
  });
});
