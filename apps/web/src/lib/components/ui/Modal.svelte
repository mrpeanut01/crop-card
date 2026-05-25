<script lang="ts">
  import { onMount, type Snippet } from 'svelte';

  interface Props {
    open: boolean;
    onClose: () => void;
    /** Accessible title; renders in the header. */
    title: string;
    children: Snippet;
    /** Optional footer slot (sticky bottom for primary action). */
    footer?: Snippet;
    /** When false, clicking the backdrop won't close. Esc still works. */
    closeOnBackdrop?: boolean;
  }

  let { open, onClose, title, children, footer, closeOnBackdrop = true }: Props = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  let previouslyFocused: HTMLElement | null = null;

  // The native <dialog> handles focus trap + backdrop layer for free.
  // We just bridge our `open` prop to showModal() / close() and wire Esc.
  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      previouslyFocused = document.activeElement as HTMLElement | null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
      previouslyFocused?.focus();
    }
  });

  function onCancel(e: Event) {
    // Esc fires 'cancel' — let it close, then re-emit to consumer.
    e.preventDefault();
    onClose();
  }

  function onBackdropClick(e: MouseEvent) {
    if (!closeOnBackdrop) return;
    // <dialog> click event fires on backdrop; the rect check distinguishes
    // backdrop clicks from content clicks (content is fully inside the rect).
    if (e.target === dialog) onClose();
  }

  onMount(() => () => {
    if (dialog?.open) dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  oncancel={onCancel}
  onclick={onBackdropClick}
  aria-labelledby="modal-title"
>
  <div class="shell" role="document">
    <header>
      <h2 id="modal-title" class="serif">{title}</h2>
      <button type="button" class="close" aria-label="Close" onclick={onClose}>×</button>
    </header>
    <div class="body">{@render children()}</div>
    {#if footer}<footer>{@render footer()}</footer>{/if}
  </div>
</dialog>

<style>
  dialog {
    background: var(--color-paper);
    color: var(--color-ink);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    padding: 0;
    max-width: 640px;
    width: calc(100vw - 32px);
    max-height: calc(100vh - 64px);
  }
  dialog::backdrop {
    background: rgba(24, 20, 16, 0.45);
    backdrop-filter: blur(4px);
  }
  .shell {
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - 64px);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--color-divider-soft);
  }
  h2 {
    font-size: var(--font-size-card-title);
    margin: 0;
  }
  .close {
    background: transparent;
    border: none;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-pill);
    font-size: 22px;
    line-height: 1;
    color: var(--color-ink-soft);
    display: grid;
    place-items: center;
  }
  .close:hover {
    background: var(--color-divider-soft);
  }
  .body {
    padding: 18px;
    overflow: auto;
  }
  footer {
    padding: 12px 18px;
    border-top: 1px solid var(--color-divider-soft);
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
