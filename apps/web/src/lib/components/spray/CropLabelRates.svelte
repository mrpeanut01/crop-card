<script lang="ts">
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
  import { cropDisplayName } from '$lib/i18n/cropName';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { cropRateText, type CropRateRow } from '$lib/plugins/cropRate';

  interface Props {
    rows: CropRateRow[];
    /** Say that the mix uses the low end of the range (the /spray card). */
    mixNote?: boolean;
  }
  const { rows, mixNote = false }: Props = $props();
  const locale = $derived(page.data?.locale);
  const tr = $derived(createT(locale));
  const ranged = $derived(rows.some((r) => r.rate?.maxAmount !== undefined));
</script>

{#if rows.length > 0}
  <div class="crop-rates" data-testid="crop-label-rates">
    <table>
      <caption>{tr('sprayui.cropRate.title')}</caption>
      <thead>
        <tr>
          <th>{tr('sprayui.cropRate.crop')}</th>
          <th>{tr('sprayui.cropRate.rate')}</th>
          <th>{tr('sprayui.cropRate.limits')}</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.cropPluginId)}
          <tr>
            <td>{cropDisplayName(r.cropPluginId, r.crop, locale)}</td>
            <td>
              {#if r.rate}
                <span class="rate"
                  ><Provenance source="plugin" compact /><strong
                    lang="en"
                    data-english-only="safety">{cropRateText(r.rate)}</strong
                  ></span
                >
              {:else}
                <span>{tr('sprayui.cropRate.noRate')}</span>
              {/if}
            </td>
            <td>
              {#if r.stageLimits.length > 0}
                <ul lang="en" data-english-only="safety">
                  {#each r.stageLimits as limit, i (i)}
                    <li>{limit}</li>
                  {/each}
                </ul>
              {:else}
                <span>—</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if mixNote && ranged}
      <p class="note">{tr('sprayui.cropRate.mixedAtLow')}</p>
    {/if}
  </div>
{/if}

<style>
  .crop-rates {
    margin: 0.75rem 0;
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.95rem;
  }
  caption {
    text-align: left;
    font-weight: 600;
    padding-bottom: 0.25rem;
  }
  th,
  td {
    text-align: left;
    vertical-align: top;
    padding: 0.35rem 0.5rem;
    border-bottom: 1px solid var(--color-rule, #ddd);
  }
  ul {
    margin: 0;
    padding-left: 1rem;
  }
  .rate {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .note {
    font-size: 0.9rem;
    margin: 0.4rem 0 0;
  }
</style>
