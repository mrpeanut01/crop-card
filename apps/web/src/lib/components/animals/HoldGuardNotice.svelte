<script lang="ts">
  import { shorteningLine, type HoldShortenBody } from '$lib/animals/holdGuardCopy';

  interface Props {
    refusal: HoldShortenBody | null;
    saving?: boolean;
    timeZone?: string;
    /** Resubmits the same record dated now. */
    onToday?: () => void;
  }

  const { refusal, saving = false, timeZone, onToday }: Props = $props();
  const lines = $derived(
    refusal
      ? refusal.holds
          .slice(0, 3)
          .map((h) => shorteningLine(h, timeZone, { dated: refusal.todayVersionPasses }))
      : []
  );
  const more = $derived(refusal ? Math.max(0, refusal.holds.length - 3) : 0);
</script>

{#if refusal}
  <div class="hold-guard" role="alert" aria-live="assertive">
    <p class="title">Holds never get shorter.</p>
    <ul>
      {#each lines as line, i (i)}<li>{line}</li>{/each}
      {#if more > 0}<li>+{more} more</li>{/if}
      {#if refusal.coverage.length > 0}
        <li>
          {refusal.coverage.length === 1
            ? 'A saved record of eggs, milk, meat or hay would no longer fall inside a hold.'
            : `${refusal.coverage.length} saved records of eggs, milk, meat or hay would no longer fall inside a hold.`}
        </li>
      {/if}
    </ul>
    {#if refusal.todayVersionPasses && onToday}
      <button class="af-primary" type="button" disabled={saving} onclick={onToday}>
        Save with today's date
      </button>
    {/if}
    {#if refusal.askOwner}<p class="note">Or ask the owner to enter it.</p>{/if}
  </div>
{/if}

<style>
  .hold-guard {
    border: 2px solid var(--rust, #9a3b1b);
    border-radius: 12px;
    padding: 12px 14px;
    margin: 8px 0;
    background: var(--paper, #fffaf0);
  }
  .title {
    font-weight: 700;
    margin: 0 0 6px;
  }
  ul {
    margin: 0 0 10px;
    padding-left: 18px;
  }
  li {
    margin: 4px 0;
  }
  .note {
    margin: 8px 0 0;
  }
  button {
    min-height: 48px;
  }
</style>
