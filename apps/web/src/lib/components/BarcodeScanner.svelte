<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { BrowserMultiFormatReader, type Result } from '@zxing/library';

  let {
    onDetected,
    onClose
  }: {
    onDetected: (rawValue: string, format: string) => void;
    onClose: () => void;
  } = $props();

  let videoEl: HTMLVideoElement | undefined = $state();
  let stream: MediaStream | undefined;
  let zxingReader: BrowserMultiFormatReader | undefined;
  let rafId: number | undefined;
  let error: string | undefined = $state();
  let status: 'starting' | 'scanning' | 'done' = $state('starting');

  // BarcodeDetector is a browser API not yet in all TS libs; access via window.
  type BarcodeDetectorLike = {
    detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string; format: string }>>;
  };
  const nativeSupported = typeof window !== 'undefined' && 'BarcodeDetector' in window;

  function getNativeDetector(): BarcodeDetectorLike {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = (window as any).BarcodeDetector as new (opts: {
      formats: string[];
    }) => BarcodeDetectorLike;
    return new Ctor({
      formats: [
        'ean_13',
        'ean_8',
        'upc_a',
        'upc_e',
        'qr_code',
        'data_matrix',
        'code_128',
        'code_39',
        'itf'
      ]
    });
  }

  async function startCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }
      });
      if (!videoEl) return;
      videoEl.srcObject = stream;
      await videoEl.play();
      status = 'scanning';
      if (nativeSupported) {
        startNativeDetection();
      } else {
        startZxingDetection();
      }
    } catch (e) {
      error =
        e instanceof Error && e.name === 'NotAllowedError'
          ? 'Camera permission denied. Please allow camera access and try again.'
          : 'Could not access camera.';
    }
  }

  function startNativeDetection() {
    const detector = getNativeDetector();
    function loop() {
      if (!videoEl || status === 'done') return;
      detector
        .detect(videoEl)
        .then((results) => {
          if (results.length > 0) {
            finish(results[0].rawValue, String(results[0].format));
          } else {
            rafId = requestAnimationFrame(loop);
          }
        })
        .catch(() => {
          rafId = requestAnimationFrame(loop);
        });
    }
    rafId = requestAnimationFrame(loop);
  }

  function startZxingDetection() {
    if (!videoEl) return;
    zxingReader = new BrowserMultiFormatReader();
    zxingReader.decodeFromVideoElementContinuously(videoEl, (result: Result | undefined) => {
      if (result) {
        finish(result.getText(), result.getBarcodeFormat().toString());
      }
    });
  }

  function finish(rawValue: string, format: string) {
    if (status === 'done') return;
    status = 'done';
    stopCamera();
    onDetected(rawValue, format);
  }

  function stopCamera() {
    if (rafId !== undefined) {
      cancelAnimationFrame(rafId);
      rafId = undefined;
    }
    zxingReader?.reset();
    stream?.getTracks().forEach((t) => t.stop());
    stream = undefined;
  }

  onMount(() => {
    startCamera();
  });
  onDestroy(() => {
    stopCamera();
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<div class="scanner-backdrop" role="dialog" aria-modal="true" aria-label="Scan barcode">
  <div class="scanner-modal">
    <div class="scanner-header">
      <span class="scanner-title">Scan barcode</span>
      <button class="close-btn" onclick={onClose} aria-label="Close scanner">✕</button>
    </div>

    <div class="viewfinder-wrap">
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={videoEl} class="video-feed" playsinline muted></video>
      {#if status === 'scanning'}
        <div class="viewfinder-overlay" aria-hidden="true">
          <div class="crosshair"></div>
        </div>
      {/if}
      {#if status === 'starting'}
        <div class="status-msg">Starting camera…</div>
      {/if}
      {#if error}
        <div class="status-msg error-msg">{error}</div>
      {/if}
    </div>

    {#if status === 'scanning'}
      <p class="hint">Point camera at a UPC, EAN, or QR barcode on the product packaging.</p>
    {/if}

    <div class="scanner-footer">
      <button class="secondary" onclick={onClose}>Cancel</button>
    </div>
  </div>
</div>

<style>
  .scanner-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 300;
    padding: 1rem;
  }

  .scanner-modal {
    background: #fff;
    border-radius: 12px;
    width: 100%;
    max-width: 420px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .scanner-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.875rem 1rem;
    border-bottom: 1px solid #d0d7d0;
  }

  .scanner-title {
    font-weight: 600;
    font-size: 1rem;
    color: #1a2e1a;
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 1.1rem;
    cursor: pointer;
    color: #555;
    min-height: 44px;
    min-width: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
  }

  .close-btn:hover {
    background: #f0f0f0;
  }

  .viewfinder-wrap {
    position: relative;
    width: 100%;
    aspect-ratio: 4/3;
    background: #000;
    overflow: hidden;
  }

  .video-feed {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .viewfinder-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  .crosshair {
    width: 65%;
    height: 45%;
    border: 2px solid rgba(255, 212, 0, 0.85);
    border-radius: 6px;
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.35);
  }

  .status-msg {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: 0.95rem;
    background: rgba(0, 0, 0, 0.5);
    text-align: center;
    padding: 1rem;
  }

  .status-msg.error-msg {
    background: rgba(176, 0, 32, 0.75);
  }

  .hint {
    font-size: 0.8rem;
    color: #555;
    text-align: center;
    padding: 0.5rem 1rem 0;
    margin: 0;
  }

  .scanner-footer {
    padding: 0.875rem 1rem;
    display: flex;
    justify-content: flex-end;
  }

  button.secondary {
    padding: 0.5rem 1.25rem;
    border: 1.5px solid #1f5e3a;
    background: #fff;
    color: #1f5e3a;
    border-radius: 6px;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 44px;
  }

  button.secondary:hover {
    background: #f0f5f1;
  }
</style>
