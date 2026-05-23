<script lang="ts">
  /**
   * B-21 (issue #30) — HRAC / IRAC / FRAC group-code chip.
   *
   * Pure render component. Caller decides what to show by passing the
   * `kind` and `group` strings. For herbicides, resolve `group` via
   * `hracGroupOf(chemistryClass)` from $lib/safety/cropFamilyLethality.
   * For insecticides + fungicides, the group comes off the active
   * ingredient (`iracGroup`, `fracCode`).
   *
   * Rotation rule: when the operator sees back-to-back chips of the same
   * (kind, group) across products, the spray flow surfaces a soft warning
   * already via `agronomy/resistance.ts` — the badge just makes the
   * grouping visible at a glance.
   */
  let {
    kind,
    group,
    label
  }: {
    kind: 'HRAC' | 'IRAC' | 'FRAC';
    group: string | number | undefined;
    /** Optional pre-formatted label (overrides `${kind} ${group}`). */
    label?: string;
  } = $props();
</script>

{#if group !== undefined && group !== null && String(group).length > 0}
  <span class="badge {kind.toLowerCase()}" title="Mode-of-action group — rotate across groups to slow resistance">
    {label ?? `${kind} ${group}`}
  </span>
{/if}

<style>
  .badge {
    display: inline-block;
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    line-height: 1.2;
    border: 1px solid transparent;
    vertical-align: baseline;
  }
  .hrac {
    background: #fff4d8;
    color: #8a5a00;
    border-color: #e6c97a;
  }
  .irac {
    background: #e7f1ea;
    color: #1f5e3a;
    border-color: #b3d4bf;
  }
  .frac {
    background: #e6e1f5;
    color: #4a2c83;
    border-color: #b9add9;
  }
</style>
