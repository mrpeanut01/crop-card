<script lang="ts">
  import './animalForms.css';
  import { Camera } from 'lucide-svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import { errorText } from './labels';

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
  const tr = $derived(createT(page.data?.locale));

  let busy = $state(false);
  let error = $state<string | null>(null);

  async function picked(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    error = null;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      error = tr('animals.photo.needSignal');
      return;
    }
    busy = true;
    try {
      const { PhotoTooLargeError, resizePhoto } = await import('$lib/client/photoResize');
      let photo: string;
      try {
        photo = await resizePhoto(file);
      } catch (err) {
        error =
          err instanceof PhotoTooLargeError
            ? tr('cardsui.photo.tooLarge')
            : tr('cardsui.photo.unreadable');
        return;
      }
      const res = await fetch(`/api/animals/${animalId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ photo })
      });
      if (!res.ok) {
        error = await errorText(res, tr);
        return;
      }
      await onDone();
    } catch (err) {
      error = err instanceof TypeError ? tr('animals.offline') : tr('cardsui.photo.unreadable');
    } finally {
      busy = false;
    }
  }
</script>

<div class="photo">
  {#if hasPhoto}
    <img src="/api/animals/{animalId}/photo?v={version}" alt={tr('animals.photo.alt', { name })} />
  {:else}
    <div class="empty" aria-hidden="true"><Camera size={28} strokeWidth={1.5} /></div>
  {/if}
  {#if canEdit}
    <label class="af-ghost pick" for="{uid}-file">
      {busy
        ? tr('animals.saving')
        : hasPhoto
          ? tr('animals.photo.change')
          : tr('animals.photo.add')}
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
