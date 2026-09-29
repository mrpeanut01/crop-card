<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import SetupSheet from '$lib/components/setup/SetupSheet.svelte';
  import FeedbackSheet from './FeedbackSheet.svelte';
  import { claimHint, hintState, initHints, markHintSeen, releaseHint } from '$lib/client/hints';

  interface Props {
    /** Parent-side reasons to hold off (e.g. a sprayer needs decon). */
    suppressed?: boolean;
  }

  const { suppressed = false }: Props = $props();

  const KEY = 'alpha_welcome';
  /** Device copy of "seen", so a second account on the same phone is not
   *  greeted again. The per-user hint key is the source of truth. */
  const DEVICE_KEY = 'cropcard.alpha-welcome.seen';
  /** Anything that must never sit under a modal: safety stops, urgent
   *  banners (decon, offline, lock), other dialogs. */
  const BLOCKERS = '[data-safety-stop], [role="alertdialog"], [role="alert"], dialog[open]';

  let mounted = $state(false);
  let blocked = $state(true);
  let claimed = $state(false);
  let dismissed = $state(false);
  let feedbackOpen = $state(false);

  const eligible = $derived(
    mounted && $hintState.ready && !$hintState.seen.has(KEY) && !suppressed && !blocked
  );

  $effect(() => {
    if (eligible && !claimed && !dismissed) claimed = claimHint(KEY);
  });

  const open = $derived(claimed && !dismissed && $hintState.active === KEY);

  onMount(() => {
    try {
      if (localStorage.getItem(DEVICE_KEY) === '1') return;
    } catch {
      /* storage blocked: fall back to the per-user hint */
    }
    mounted = true;
    void initHints(page.data?.user?.id ?? null);
    void tick().then(() => {
      blocked = document.querySelector(BLOCKERS) !== null;
    });
  });

  onDestroy(() => {
    if (claimed) releaseHint(KEY);
  });

  function close() {
    dismissed = true;
    try {
      localStorage.setItem(DEVICE_KEY, '1');
    } catch {
      /* the per-user hint still records it */
    }
    void markHintSeen(KEY);
  }

  function sendFeedback() {
    close();
    feedbackOpen = true;
  }
</script>

<SetupSheet {open} title="Welcome to CropCard" kicker="Alpha review" onClose={close}>
  <div class="welcome" data-testid="alpha-welcome">
    <p>
      CropCard is in alpha review. We are changing things quickly, so you will see new pieces most
      weeks, and now and then something that does not work yet.
    </p>
    <p>
      If something looks wrong or you have an idea, please tell us.
      <strong>Send feedback</strong> is always in the <strong>More</strong> menu.
    </p>
    <div class="actions">
      <button type="button" class="primary" onclick={close} data-autofocus>Got it</button>
      <button type="button" class="secondary" onclick={sendFeedback}>Send feedback now</button>
    </div>
  </div>
</SetupSheet>

<FeedbackSheet
  open={feedbackOpen}
  pathname={page.url.pathname}
  onClose={() => (feedbackOpen = false)}
/>

<style>
  .welcome {
    display: grid;
    gap: var(--space-3);
  }
  .welcome p {
    margin: 0;
    line-height: 1.5;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .primary,
  .secondary {
    min-height: 48px;
    padding: 0 20px;
    border-radius: var(--radius-input);
    font-weight: 700;
    font-size: 15px;
    cursor: pointer;
  }
  .primary {
    border: 1px solid var(--color-forest);
    background: var(--color-forest);
    color: var(--color-cream);
  }
  .secondary {
    border: 1px solid var(--color-forest);
    background: transparent;
    color: var(--color-forest);
  }
</style>
