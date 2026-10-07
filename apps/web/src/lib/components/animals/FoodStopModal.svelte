<script lang="ts">
  import Modal from '$lib/components/ui/Modal.svelte';
  import '$lib/components/animals/animalForms.css';
  import { grazingTimeHref, type FoodStop } from '$lib/animals/holdCopy';

  interface Props {
    stop: FoodStop | null;
    isOwner: boolean;
    saving?: boolean;
    onDiscard: () => void;
    onClose: () => void;
  }

  const { stop, isOwner, saving = false, onDiscard, onClose }: Props = $props();

  const TITLE: Record<string, string> = {
    WITHDRAWAL_ACTIVE: 'Still in its withdrawal time',
    WITHDRAWAL_UNKNOWN: 'Withdrawal time not known',
    PROHIBITED_DRUG: 'Never for food',
    GRAZING_INTERVAL: 'Grazed where it was sprayed',
    GRAZING_UNKNOWN: 'Grazing time not known',
    GRAZING_PROHIBITED: 'Grazed where the label forbids it',
    HOLD_ACTIVE: 'Inside a hold on file',
    OUT_OF_ORDER: 'A treatment on file comes after this date'
  };
  const grazingArea = $derived(stop?.grazingFieldIds?.[0] ?? null);
</script>

<Modal
  open={stop !== null}
  {onClose}
  title={stop ? (TITLE[stop.code] ?? 'Stop') : 'Stop'}
  safetyTitle
>
  {#if stop}
    <div class="stop" role="alert" data-testid="food-stop" lang="en" data-english-only="safety">
      <p class="lead">{stop.error}</p>
      {#if stop.clearsOn}
        <p class="date">Clear from <strong>{stop.clearsOn}</strong>.</p>
      {:else if stop.holdEndsOn}
        <p class="date">On hold until <strong>{stop.holdEndsOn}</strong>.</p>
      {/if}
      <dl class="facts">
        <dt>Reason</dt>
        <dd><code>{stop.code}</code></dd>
        {#if stop.products?.length}
          <dt>Treatment</dt>
          <dd>{stop.products.join(', ')}</dd>
        {/if}
      </dl>
      <p class="af-help">
        This is a food safety rule and cannot be overridden. The count still saves as discarded.
      </p>
      {#if stop.nextStep === 'last-dose'}
        <p class="af-note">
          {isOwner
            ? 'Record when the last dose was given on the treatment.'
            : 'Ask the owner to record when the last dose was given.'}
        </p>
      {:else if stop.nextStep === 'contact-support'}
        <p class="af-note">Ask your vet for the withdrawal time and contact support.</p>
      {:else if stop.nextStep === 'add-withdrawal' && !isOwner}
        <p class="af-note">Ask the owner to add the withdrawal time from the label or the vet.</p>
      {:else if stop.nextStep === 'add-grazing-time' && !isOwner}
        <p class="af-note">Ask the owner to add the grazing time from the label.</p>
      {:else if stop.nextStep === 'add-grazing-time' && grazingArea}
        <p class="af-note">
          <a class="stop-link" href={grazingTimeHref(grazingArea)}
            >Add the grazing time from the label</a
          >
        </p>
      {/if}
    </div>
  {/if}
  {#snippet footer()}
    <div class="actions" lang="en" data-english-only="safety">
      <button type="button" class="af-primary" disabled={saving} onclick={onDiscard}>
        {saving ? 'Saving…' : 'Save as discarded'}
      </button>
      <button type="button" class="af-ghost" onclick={onClose}>Go back</button>
    </div>
  {/snippet}
</Modal>

<style>
  .stop {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  .stop-link {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
  }
  .lead {
    margin: 0;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .date {
    margin: 0;
  }
  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px var(--space-2);
    margin: 0;
    font-size: var(--font-size-caption);
  }
  .facts dt {
    font-weight: 600;
  }
  .facts dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
