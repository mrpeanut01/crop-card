<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  let {
    onCapture,
    onClose
  }: {
    onCapture: (base64jpeg: string) => void;
    onClose: () => void;
  } = $props();

  let videoEl: HTMLVideoElement | undefined = $state();
  let stream: MediaStream | undefined;
  let error: string | undefined = $state();
  let ready = $state(false);

  async function startCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }
      });
      if (!videoEl) return;
      videoEl.srcObject = stream;
      await videoEl.play();
      ready = true;
    } catch (e) {
      error =
        e instanceof Error && e.name === 'NotAllowedError'
          ? 'Camera permission denied.'
          : 'Could not access camera.';
    }
  }

  function capture() {
    if (!videoEl) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoEl, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
    stopCamera();
    onCapture(base64);
  }

  function stopCamera() {
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

<div class="capture-backdrop" role="dialog" aria-modal="true" aria-label="Photograph product label">
  <div class="capture-modal">
    <div class="capture-header">
      <span class="capture-title">Read label</span>
      <button class="close-btn" onclick={onClose} aria-label="Close">✕</button>
    </div>

    <div class="viewfinder-wrap">
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={videoEl} class="video-feed" playsinline muted></video>
      {#if !ready && !error}
        <div class="overlay-msg">Starting camera…</div>
      {/if}
      {#if error}
        <div class="overlay-msg error">{error}</div>
      {/if}
    </div>

    <p class="hint">Frame the full label so the text is clearly visible, then tap Capture.</p>

    <div class="capture-footer">
      <button class="secondary" onclick={onClose}>Cancel</button>
      <button class="primary" onclick={capture} disabled={!ready}> 📸 Capture </button>
    </div>
  </div>
</div>

<style>
  .capture-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 300;
    padding: 1rem;
  }

  .capture-modal {
    background: #fff;
    border-radius: 12px;
    width: 100%;
    max-width: 480px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .capture-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.875rem 1rem;
    border-bottom: 1px solid #d0d7d0;
  }

  .capture-title {
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

  .overlay-msg {
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
  .overlay-msg.error {
    background: rgba(176, 0, 32, 0.75);
  }

  .hint {
    font-size: 0.8rem;
    color: #555;
    text-align: center;
    padding: 0.5rem 1rem 0;
    margin: 0;
  }

  .capture-footer {
    padding: 0.875rem 1rem;
    display: flex;
    gap: 0.75rem;
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
    min-height: 48px;
  }
  button.secondary:hover {
    background: #f0f5f1;
  }

  button.primary {
    padding: 0.5rem 1.5rem;
    border: none;
    background: #1f5e3a;
    color: #fff;
    border-radius: 6px;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 48px;
  }
  button.primary:disabled {
    background: #999;
    cursor: not-allowed;
  }
  button.primary:not(:disabled):hover {
    background: #174d2f;
  }
</style>
