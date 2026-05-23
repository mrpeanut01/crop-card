<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Tools — CropCard</title></svelte:head>

<header class="head">
  <h1>Tools</h1>
  <p class="subtitle">Calculators and reference utilities for field operations.</p>
</header>

<section class="tools-grid">
  {#if data.showPlanterPlate}
    <a class="tool-card" href="/tools/planter-plate-selector">
      <h2>Planter plate selector</h2>
      <p>
        Look up Lincoln Ag plate numbers (John Deere "B" / IHC "C") by seed type, dimensions, and
        target planting density. Optionally save the chosen plate to a seed inventory record.
      </p>
    </a>
  {/if}
  <a class="tool-card" href="/calibrate">
    <h2>Sprayer calibration (1/128 acre)</h2>
    <p>
      Calibrate boom sprayer GPA from a 1/128-acre stride collection. Records to the sprayer's
      calibration history.
    </p>
  </a>
</section>

<style>
  .head h1 {
    margin: 0 0 0.25rem;
  }
  .subtitle {
    color: #555;
    margin: 0 0 1rem;
  }
  .tools-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 0.75rem;
  }
  .tool-card {
    display: block;
    background: white;
    border-radius: 8px;
    padding: 1rem 1.25rem;
    text-decoration: none;
    color: inherit;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    border-left: 4px solid #1f5e3a;
  }
  .tool-card:hover {
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
  }
  .tool-card h2 {
    margin: 0 0 0.4rem;
    color: #1f5e3a;
    font-size: 1.1rem;
  }
  .tool-card p {
    margin: 0;
    color: #555;
    font-size: 0.9rem;
  }
</style>
