<script lang="ts">
  import CalibrationWizard from '$lib/components/calibration/CalibrationWizard.svelte';
  import type { SetupCalibrationResult } from '$lib/setup/types';
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';

  interface Props {
    sprayer: {
      id: string;
      label: string;
      calibratedGpa: number | null;
      templateId?: string;
      tankGal?: number;
    };
    /** Owners apply the result; helpers send it to the owner for review. */
    canSave: boolean;
    onDone: (result: SetupCalibrationResult) => void;
  }

  const { sprayer, canSave, onDone }: Props = $props();
  const tr = $derived(createT(page.data?.locale));
</script>

<div class="setup-calibration">
  <p class="lede">
    {tr('setup.calibration.lede', { sprayer: sprayer.label })}
  </p>
  <CalibrationWizard sprayers={[sprayer]} {canSave} lockSprayer onSaved={onDone} />
</div>

<style>
  .lede {
    margin: 0 0 var(--space-4);
    color: var(--color-ink-soft);
  }
</style>
