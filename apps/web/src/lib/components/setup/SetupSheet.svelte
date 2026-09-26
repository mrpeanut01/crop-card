<script lang="ts" generics="T">
  import { onMount, tick, type Snippet } from 'svelte';

  interface Props {
    open: boolean;
    title: string;
    kicker?: string;
    onClose: () => void;
    /** Receives the value the content hands back. */
    onDone?: (value: T) => void;
    children: Snippet<[(value: T) => void]>;
  }

  const { open, title, kicker, onClose, onDone, children }: Props = $props();
  const uid = $props.id();
  const titleId = `setup-sheet-title-${uid}`;

  let dialog: HTMLDialogElement | undefined = $state();
  let previouslyFocused: HTMLElement | null = null;

  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function focusables(): HTMLElement[] {
    if (!dialog) return [];
    return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => !el.closest('[hidden]') && el.getAttribute('aria-hidden') !== 'true'
    );
  }

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      previouslyFocused = document.activeElement as HTMLElement | null;
      dialog.showModal();
      void tick().then(() => {
        const first =
          dialog?.querySelector<HTMLElement>('[data-autofocus]') ??
          focusables()[1] ??
          focusables()[0];
        first?.focus();
      });
    } else if (!open && dialog.open) {
      dialog.close();
      previouslyFocused?.focus?.();
    }
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const items = focusables();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !dialog?.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !dialog?.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  function onCancel(e: Event) {
    e.preventDefault();
    onClose();
  }

  function onBackdropClick(e: MouseEvent) {
    if (e.target === dialog) onClose();
  }

  function done(value: T) {
    onDone?.(value);
  }

  onMount(() => () => {
    if (dialog?.open) dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  class="setup-sheet"
  aria-labelledby={titleId}
  oncancel={onCancel}
  onclick={onBackdropClick}
  onkeydown={onKeydown}
>
  <div class="shell">
    <header>
      <div>
        {#if kicker}<p class="kicker">{kicker}</p>{/if}
        <h2 id={titleId} class="serif">{title}</h2>
      </div>
      <button type="button" class="close" aria-label="Close" onclick={onClose}>×</button>
    </header>
    <div class="body">
      {#if open}{@render children(done)}{/if}
    </div>
  </div>
</dialog>

<style>
  dialog.setup-sheet {
    background: var(--color-paper);
    color: var(--color-ink);
    border: 1px solid var(--color-divider);
    padding: 0;
    margin: 0;
    position: fixed;
    inset: auto 0 0 0;
    width: 100%;
    max-width: 100%;
    max-height: 92vh;
    border-radius: var(--radius-hero) var(--radius-hero) 0 0;
    box-shadow: 0 -8px 28px rgba(24, 20, 16, 0.18);
  }
  dialog.setup-sheet::backdrop {
    background: rgba(24, 20, 16, 0.45);
  }
  .shell {
    display: flex;
    flex-direction: column;
    max-height: 92vh;
  }
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-4) var(--space-3);
    border-bottom: 1px solid var(--color-divider-soft);
  }
  .kicker {
    margin: 0 0 2px;
    font-size: var(--font-size-kicker);
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-ink-muted);
  }
  h2 {
    margin: 0;
    font-size: var(--font-size-screen-title);
    color: var(--color-forest-deep);
  }
  .close {
    flex: none;
    width: 48px;
    height: 48px;
    border: none;
    background: transparent;
    border-radius: var(--radius-pill);
    font-size: 26px;
    line-height: 1;
    color: var(--color-ink-soft);
    cursor: pointer;
  }
  .close:hover {
    background: var(--color-divider-soft);
  }
  .body {
    padding: var(--space-4);
    overflow: auto;
    overscroll-behavior: contain;
  }
  @media (min-width: 760px) {
    dialog.setup-sheet {
      inset: 0 0 0 auto;
      width: 460px;
      height: 100vh;
      max-height: 100vh;
      border-radius: var(--radius-hero) 0 0 var(--radius-hero);
      box-shadow: -8px 0 28px rgba(24, 20, 16, 0.18);
    }
    .shell {
      height: 100%;
      max-height: 100vh;
    }
  }
</style>
