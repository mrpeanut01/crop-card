<script lang="ts">
  import { Share } from 'lucide-svelte';
  import { dismissInstallNudge } from '$lib/client/offlineStorage';

  interface Props {
    onDismiss?: () => void;
  }

  const { onDismiss }: Props = $props();

  function dismiss() {
    dismissInstallNudge();
    onDismiss?.();
  }
</script>

<aside class="nudge no-print" aria-labelledby="install-nudge-title">
  <div class="text">
    <h2 id="install-nudge-title">Keep your cards on this iPhone</h2>
    <p>
      Safari clears saved pages after about a week without a visit. Tap
      <Share size={15} strokeWidth={2} aria-label="Share" /> then
      <strong>Add to Home Screen</strong>
      and your cards stay put. Printing them works too.
    </p>
  </div>
  <button type="button" class="dismiss" onclick={dismiss}>Got it</button>
</aside>

<style>
  .nudge {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-card);
    background: var(--pill-wheat-bg);
    border: 1px solid var(--pill-wheat-bd);
    color: var(--color-ink);
  }
  .text {
    flex: 1 1 240px;
    min-width: 0;
  }
  h2 {
    margin: 0 0 var(--space-1);
    font-size: var(--font-size-body);
    font-weight: 700;
  }
  p {
    margin: 0;
  }
  .dismiss {
    min-height: 48px;
    min-width: 48px;
    padding: 0 var(--space-4);
    border-radius: var(--radius-input);
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-ink);
    font-weight: 600;
    cursor: pointer;
  }
  .dismiss:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
</style>
