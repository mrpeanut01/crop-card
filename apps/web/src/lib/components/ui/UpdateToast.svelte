<script lang="ts">
  interface Props {
    visible: boolean;
    onReload: () => void;
    onDismiss: () => void;
  }

  const { visible, onReload, onDismiss }: Props = $props();
</script>

<div class="update-region" role="status" aria-live="polite">
  {#if visible}
    <div class="toast">
      <span class="msg">New version available</span>
      <div class="actions">
        <button type="button" class="later" onclick={onDismiss}>Later</button>
        <button type="button" class="reload" onclick={onReload}>Reload</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .update-region {
    position: fixed;
    left: 16px;
    right: 16px;
    bottom: 16px;
    display: flex;
    justify-content: center;
    pointer-events: none;
    z-index: 60;
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    max-width: 100%;
    padding: 8px 8px 8px 16px;
    background: var(--color-forest-deep);
    color: var(--color-cream);
    border-radius: var(--radius-card);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  }
  .msg {
    font-weight: 600;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-left: auto;
  }
  button {
    min-height: 48px;
    min-width: 48px;
    padding: 0 16px;
    border-radius: var(--radius-input);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .later {
    background: transparent;
    color: var(--color-cream);
    border: 1px solid currentColor;
  }
  .reload {
    background: var(--color-cream);
    color: var(--color-forest-deep);
    border: 1px solid var(--color-cream);
  }
  button:focus-visible {
    outline: 2px solid var(--color-wheat);
    outline-offset: 2px;
  }
  @media (max-width: 768px) {
    .update-region {
      bottom: calc(80px + env(safe-area-inset-bottom, 0px));
    }
  }
</style>
