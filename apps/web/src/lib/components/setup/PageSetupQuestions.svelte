<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import type { SetupAsk, SetupNudge } from '$lib/onboarding/pageSetup';
  import type { SeasonSetup } from '$lib/season/setup';
  import SeasonSetupStep from '$lib/components/SeasonSetupStep.svelte';
  import SetupNudges from './SetupNudges.svelte';
  import SetupSheet from './SetupSheet.svelte';
  import SetupFarmClimate from './SetupFarmClimate.svelte';

  interface Props {
    nudges: SetupNudge[];
    scope: string;
    /** Page name for the sheet kicker, e.g. "Plan". */
    kicker: string;
    latLon?: { lat: number; lon: number } | null;
    year?: number;
    lastYearSetup?: SeasonSetup | null;
  }

  const { nudges, scope, kicker, latLon = null, year, lastYearSetup = null }: Props = $props();

  const tr = $derived(createT(page.data?.locale));

  let asking = $state<SetupAsk | null>(null);

  async function answered() {
    asking = null;
    await invalidateAll();
  }
</script>

<SetupNudges {nudges} {scope} onAsk={(ask) => (asking = ask)} />

<SetupSheet
  open={asking === 'climate'}
  {kicker}
  title={tr('setup.climate.title')}
  onClose={() => (asking = null)}
  onDone={answered}
>
  {#snippet children(done)}
    <SetupFarmClimate {latLon} onDone={done} />
  {/snippet}
</SetupSheet>

{#if year != null}
  <SetupSheet
    open={asking === 'season'}
    {kicker}
    title={tr('setup.season.title', { year })}
    onClose={() => (asking = null)}
    onDone={answered}
  >
    {#snippet children(done)}
      <SeasonSetupStep
        existing={null}
        {lastYearSetup}
        currentYear={year}
        onSave={(setup: SeasonSetup) => done(setup)}
      />
    {/snippet}
  </SetupSheet>
{/if}
