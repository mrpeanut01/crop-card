<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import Avatar from '$lib/components/ui/Avatar.svelte';

  interface Props {
    name: string;
    avatarUrl: string | null;
  }

  const { name, avatarUrl }: Props = $props();

  const OUTPUT_PX = 256;

  let current = $state<string | null>(null);
  let touched = $state(false);
  let busy = $state(false);
  let status = $state<{ tone: 'ok' | 'error'; text: string } | null>(null);
  let input: HTMLInputElement | undefined = $state();

  const shown = $derived(touched ? current : avatarUrl);

  /** Center-crops to a square and re-encodes, so what reaches the server
   *  is small and carries no camera EXIF (GPS included). */
  async function downsize(file: File): Promise<Blob> {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_PX;
    canvas.height = OUTPUT_PX;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      OUTPUT_PX,
      OUTPUT_PX
    );
    bitmap.close();
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('encode failed'))),
        'image/jpeg',
        0.85
      )
    );
  }

  async function onPick(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    busy = true;
    status = null;
    try {
      let body: Blob;
      try {
        body = await downsize(file);
      } catch {
        status = { tone: 'error', text: "That file couldn't be read as a picture." };
        return;
      }
      const res = await fetch('/api/account/avatar', {
        method: 'POST',
        headers: { 'Content-Type': body.type },
        body
      });
      const out = (await res.json().catch(() => ({}))) as { avatarUrl?: string; error?: string };
      if (!res.ok || !out.avatarUrl) {
        status = { tone: 'error', text: out.error ?? 'Upload failed. Try again.' };
        return;
      }
      touched = true;
      current = out.avatarUrl;
      status = { tone: 'ok', text: 'Picture updated.' };
      await invalidateAll();
    } catch {
      status = { tone: 'error', text: 'Upload failed. Check your connection and try again.' };
    } finally {
      busy = false;
      if (input) input.value = '';
    }
  }

  async function remove() {
    busy = true;
    status = null;
    try {
      const res = await fetch('/api/account/avatar', { method: 'DELETE' });
      if (!res.ok) {
        status = { tone: 'error', text: "Couldn't remove the picture. Try again." };
        return;
      }
      touched = true;
      current = null;
      status = { tone: 'ok', text: 'Picture removed.' };
      await invalidateAll();
    } catch {
      status = { tone: 'error', text: "Couldn't remove the picture. Check your connection." };
    } finally {
      busy = false;
    }
  }
</script>

<div class="avatar-upload">
  <Avatar {name} src={shown} size={64} />
  <div class="actions">
    <input
      bind:this={input}
      id="avatar-file"
      class="visually-hidden"
      type="file"
      accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
      onchange={onPick}
      disabled={busy}
    />
    <label for="avatar-file" class="ghost-sm" class:disabled={busy}>
      {busy ? 'Saving…' : shown ? 'Change photo' : 'Upload photo'}
    </label>
    {#if shown}
      <button type="button" class="ghost-sm" onclick={remove} disabled={busy}>Remove</button>
    {/if}
  </div>
  <p class="status" class:error={status?.tone === 'error'} role="status" aria-live="polite">
    {status?.text ?? ''}
  </p>
</div>

<style>
  .avatar-upload {
    display: grid;
    justify-items: center;
    gap: 8px;
    width: 120px;
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .ghost-sm {
    background: var(--color-paper);
    color: var(--color-ink);
    border: 1px solid var(--color-divider);
    padding: 0 10px;
    min-height: 48px;
    border-radius: var(--radius-input, 6px);
    font-family: inherit;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    display: grid;
    place-items: center;
    text-align: center;
  }
  .ghost-sm:hover,
  .avatar-upload input:focus-visible + .ghost-sm {
    border-color: var(--color-forest-deep);
  }
  .avatar-upload input:focus-visible + .ghost-sm {
    box-shadow: 0 0 0 2px rgba(44, 82, 55, 0.3);
  }
  .ghost-sm.disabled,
  .ghost-sm:disabled {
    opacity: 0.6;
    cursor: progress;
  }
  .status {
    margin: 0;
    min-height: 1em;
    font-size: 11.5px;
    color: var(--color-forest-deep);
    text-align: center;
  }
  .status.error {
    color: var(--color-rust, #a3472a);
  }
  @media (max-width: 700px) {
    .avatar-upload {
      grid-template-columns: auto 1fr;
      justify-items: start;
      align-items: center;
      width: 100%;
    }
    .status {
      grid-column: 1 / -1;
      text-align: left;
    }
  }
</style>
