<script lang="ts">
  import CalibrationWizard from '$lib/components/calibration/CalibrationWizard.svelte';
  import type { SetupCalibrationResult } from '$lib/setup/types';

  interface Props {
    sprayer: { id: string; label: string; calibratedGpa: number | null };
    /** Owners apply the result; helpers send it to the owner for review. */
    canSave: boolean;
    onDone: (result: SetupCalibrationResult) => void;
  }

  const { sprayer, canSave, onDone }: Props = $props();
</script>

<div class="setup-calibration">
  <p class="lede">
    Walk a short, measured distance with <strong>{sprayer.label}</strong> running and catch what comes
    out in a jug. The ounces you catch are your gallons per acre, and CropCard scales every rate from
    that number.
  </p>
  <CalibrationWizard sprayers={[sprayer]} {canSave} lockSprayer onSaved={onDone} />
</div>

<style>
  .lede {
    margin: 0 0 var(--space-4);
    color: var(--color-ink-soft);
  }
</style>
