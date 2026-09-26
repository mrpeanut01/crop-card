<script lang="ts">
  import type { AreaKind } from '$lib/farm/areaKinds';
  import { AREA_DETAIL_FIELDS, fieldShown, type DetailsDraft } from '$lib/farm/areaDetailsForm';

  let {
    kind,
    draft = $bindable(),
    idPrefix = 'area'
  }: { kind: AreaKind; draft: DetailsDraft; idPrefix?: string } = $props();

  const specs = $derived(AREA_DETAIL_FIELDS[kind]);
</script>

{#if specs.length}
  <div class="details-grid" data-testid="area-details-fields">
    {#each specs as f (f.key)}
      {#if fieldShown(f, draft)}
        {#if f.type === 'boolean'}
          <label class="check">
            <input
              type="checkbox"
              checked={draft[f.key] === true}
              onchange={(e) => (draft = { ...draft, [f.key]: e.currentTarget.checked })}
            />
            <span>{f.label}</span>
          </label>
        {:else}
          <label class="field" for="{idPrefix}-{f.key}">
            <span>{f.label}</span>
            {#if f.type === 'select'}
              <select
                id="{idPrefix}-{f.key}"
                value={(draft[f.key] as string) ?? ''}
                onchange={(e) => (draft = { ...draft, [f.key]: e.currentTarget.value })}
              >
                <option value="">Not set</option>
                {#each f.options as o (o.value)}
                  <option value={o.value}>{o.label}</option>
                {/each}
              </select>
            {:else if f.type === 'date'}
              <input
                id="{idPrefix}-{f.key}"
                type="date"
                value={(draft[f.key] as string) ?? ''}
                onchange={(e) => (draft = { ...draft, [f.key]: e.currentTarget.value })}
              />
            {:else}
              <span class="feet">
                <input
                  id="{idPrefix}-{f.key}"
                  type="number"
                  min="1"
                  max="200"
                  step="0.5"
                  inputmode="decimal"
                  value={draft[f.key] ?? ''}
                  oninput={(e) =>
                    (draft = {
                      ...draft,
                      [f.key]: e.currentTarget.value === '' ? null : Number(e.currentTarget.value)
                    })}
                />
                <span class="unit">ft</span>
              </span>
            {/if}
          </label>
        {/if}
      {/if}
    {/each}
  </div>
{/if}

<style>
  .details-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: var(--space-2, 8px) var(--space-3, 12px);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: var(--color-ink-soft);
  }
  .field select,
  .field input {
    min-height: 48px;
    padding: 0 10px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    background: var(--color-paper);
    color: var(--color-ink);
    font: inherit;
    font-size: 15px;
    width: 100%;
  }
  .feet {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .unit {
    color: var(--color-ink-muted);
  }
  .check {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    font-size: 14px;
    color: var(--color-ink);
    cursor: pointer;
  }
  .check input {
    width: 22px;
    height: 22px;
    accent-color: var(--color-forest);
  }
</style>
