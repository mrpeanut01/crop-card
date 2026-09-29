<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    /** Where "Sign in" points; the landing page's own form. */
    signInHref?: string;
  }

  const { signInHref = '#signin-title' }: Props = $props();

  const KEY = 'cropcard.alpha-banner.dismissed';
  let show = $state(false);

  onMount(() => {
    try {
      show = localStorage.getItem(KEY) !== '1';
    } catch {
      show = true;
    }
  });

  function dismiss() {
    show = false;
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* storage blocked: it shows again next visit */
    }
  }
</script>

{#if show}
  <aside class="alpha" aria-label="Alpha review" data-testid="alpha-banner">
    <div class="text">
      <p class="title">Welcome. CropCard is in alpha review.</p>
      <p>
        We are changing things quickly, so expect new pieces most weeks and the odd rough edge. Once
        you <a href={signInHref}>sign in</a>, you can send us bug reports and ideas from
        <strong>Send feedback</strong> in the <strong>More</strong> menu.
      </p>
    </div>
    <button type="button" class="dismiss" onclick={dismiss} aria-label="Dismiss alpha notice"
      >×</button
    >
  </aside>
{/if}

<style>
  .alpha {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    background: #fbf3dc;
    color: #3d3218;
    border: 1px solid #e6d29a;
    border-radius: 12px;
    padding: 10px 6px 10px 14px;
    margin: 0 0 16px;
    box-sizing: border-box;
    max-width: 100%;
  }
  .text {
    flex: 1;
    min-width: 0;
  }
  p {
    margin: 0;
    line-height: 1.45;
    font-size: 14.5px;
  }
  .title {
    font-weight: 700;
    margin-bottom: 2px;
  }
  a {
    color: #1f5e3a;
    font-weight: 700;
    text-decoration: underline;
  }
  .dismiss {
    flex: none;
    width: 48px;
    height: 48px;
    border: none;
    background: transparent;
    font-size: 24px;
    line-height: 1;
    color: inherit;
    cursor: pointer;
    border-radius: 999px;
  }
  .dismiss:hover {
    background: rgba(0, 0, 0, 0.06);
  }
</style>
