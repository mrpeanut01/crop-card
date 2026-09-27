<script lang="ts">
  import './animalForms.css';
  import { Camera } from 'lucide-svelte';
  import { OFFLINE_MESSAGE, errorFromResponse } from '$lib/animals/display';

  interface Props {
    animalId: string;
    name: string;
    hasPhoto: boolean;
    /** Changes whenever the photo does, so the browser fetches the new one. */
    version: number;
    canEdit: boolean;
    onDone: () => void | Promise<void>;
  }

  const { animalId, name, hasPhoto, version, canEdit, onDone }: Props = $props();
  const uid = $props.id();

  let busy = $state(false);
  let error = $state<string | null>(null);

  async function picked(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    error = null;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      error = 'Photos need a signal. Try again when you are online.';
      return;
    }
    busy = true;
    try {
      const { resizePhoto } = await import('$lib/client/photoResize');
      const photo = await resizePhoto(file);
      const res = await fetch(`/api/animals/${animalId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ photo })
      });
      if (!res.ok) {
        error = await errorFromResponse(res);
        return;
      }
      await onDone();
    } catch (err) {
      error =
        err instanceof TypeError
          ? OFFLINE_MESSAGE
          : err instanceof Error
            ? err.message
            : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="photo">
  {#if hasPhoto}
    <img src="/api/animals/{animalId}/photo?v={version}" alt="Photo of {name}" />
  {:else}
    <div class="empty" aria-hidden="true"><Camera size={28} strokeWidth={1.5} /></div>
  {/if}
  {#if canEdit}
    <label class="af-ghost pick" for="{uid}-file">
      {busy ? 'Saving…' : hasPhoto ? 'Change photo' : 'Add a photo'}
    </label>
    <input
      id="{uid}-file"
      class="file"
      type="file"
      accept="image/*"
      disabled={busy}
      onchange={picked}
    />
  {/if}
  {#if error}<p class="af-error" role="alert">{error}</p>{/if}
</div>

<style>
  .photo {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
  }
  img,
  .empty {
    width: 120px;
    height: 120px;
    border-radius: var(--radius-card);
    object-fit: cover;
    border: 1px solid var(--color-divider);
  }
  .empty {
    display: grid;
    place-items: center;
    color: var(--color-ink-muted);
    background: var(--color-divider-soft);
  }
  .pick {
    display: inline-flex;
    align-items: center;
  }
  .file {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    overflow: hidden;
  }
  .pick:has(+ .file:focus-visible) {
    box-shadow: var(--focus-ring);
  }
</style>
