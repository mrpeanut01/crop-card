<script lang="ts">
  import { untrack } from 'svelte';
  import { Check, Plus, X } from 'lucide-svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import { templateText } from '$lib/equipment/templateText';
  import {
    IMPLEMENT_GROUPS,
    IMPLEMENT_TYPES,
    implementGroup,
    type ImplementTemplate
  } from '$lib/onboarding/implements';

  let {
    templates,
    owned,
    ownedTemplateIds,
    onCountChange
  }: {
    templates: ImplementTemplate[];
    owned: { id: string; type: string; label: string }[];
    ownedTemplateIds: string[];
    onCountChange?: (n: number) => void;
  } = $props();

  const tr = $derived(createT(page.data?.locale));

  const TYPE_LABELS: Record<string, string> = $derived({
    tractor: tr('onboard.impl.tractor'),
    sprayer: tr('onboard.impl.sprayer'),
    planter: tr('onboard.impl.planter'),
    drill: tr('onboard.impl.drill'),
    mower: tr('onboard.impl.mower'),
    rake: tr('onboard.impl.rake'),
    baler: tr('onboard.impl.baler'),
    irrigation: tr('onboard.impl.irrigation'),
    other: tr('onboard.impl.other')
  });

  let selected = $state<string[]>([]);
  let custom = $state<{ key: number; type: string; label: string }[]>([]);
  let nextKey = 0;
  let openGroups = $state<Record<string, boolean>>(
    untrack(() =>
      Object.fromEntries(
        IMPLEMENT_GROUPS.map((g) => [g.id, g.id === 'tractors' || g.id === 'sprayers'])
      )
    )
  );

  const grouped = $derived(
    IMPLEMENT_GROUPS.map((g) => ({
      ...g,
      items: templates.filter((t) => implementGroup(t) === g.id)
    })).filter((g) => g.items.length > 0)
  );

  const pickedCount = $derived(
    selected.length + custom.filter((c) => c.label.trim().length > 0).length
  );
  $effect(() => {
    onCountChange?.(pickedCount);
  });

  function toggle(id: string) {
    selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
  }

  function addCustom() {
    custom = [...custom, { key: nextKey++, type: 'other', label: '' }];
  }

  function removeCustom(key: number) {
    custom = custom.filter((c) => c.key !== key);
  }

  function selectedIn(ids: string[]) {
    return ids.filter((id) => selected.includes(id)).length;
  }
</script>

{#if owned.length > 0}
  <section class="owned" aria-label={tr('onboard.impl.owned')}>
    <h3>{tr('onboard.impl.owned')}</h3>
    <ul>
      {#each owned as o (o.id)}
        <li><Check size={13} aria-hidden="true" /> {o.label}</li>
      {/each}
    </ul>
  </section>
{/if}

<div class="groups">
  {#each grouped as g (g.id)}
    {@const n = selectedIn(g.items.map((t) => t.templateId))}
    <details class="group" bind:open={openGroups[g.id]}>
      <summary>
        <span class="g-label">{g.label}</span>
        {#if n > 0}<span class="g-count">{tr('onboard.impl.picked', { n })}</span>{/if}
      </summary>
      <div class="items">
        {#each g.items as t (t.templateId)}
          {@const isOwned = ownedTemplateIds.includes(t.templateId)}
          <label class="item" class:on={selected.includes(t.templateId)} class:owned={isOwned}>
            <input
              type="checkbox"
              name="templateId"
              value={t.templateId}
              checked={isOwned || selected.includes(t.templateId)}
              disabled={isOwned}
              onchange={() => toggle(t.templateId)}
            />
            <span class="item-body">
              <span class="item-cat"
                >{templateText(t.templateId, 'category', t.category, page.data?.locale)}{isOwned
                  ? tr('onboard.impl.onFarm')
                  : ''}</span
              >
              <span class="item-label"
                >{templateText(t.templateId, 'label', t.label, page.data?.locale)}</span
              >
              <span class="item-desc"
                >{templateText(t.templateId, 'description', t.description, page.data?.locale)}</span
              >
            </span>
          </label>
        {/each}
      </div>
    </details>
  {/each}
</div>

<section class="custom" aria-label={tr('onboard.impl.notListed')}>
  <h3>{tr('onboard.impl.notListed')}</h3>
  {#each custom as c (c.key)}
    <div class="custom-row">
      <select name="customType" bind:value={c.type} aria-label={tr('onboard.impl.typeAria')}>
        {#each IMPLEMENT_TYPES as t (t)}
          <option value={t}>{TYPE_LABELS[t]}</option>
        {/each}
      </select>
      <input
        type="text"
        name="customLabel"
        bind:value={c.label}
        maxlength="120"
        placeholder={tr('onboard.impl.placeholder')}
        aria-label={tr('onboard.impl.nameAria')}
      />
      <button
        type="button"
        class="icon"
        onclick={() => removeCustom(c.key)}
        aria-label={tr('onboard.impl.remove')}
      >
        <X size={16} />
      </button>
    </div>
  {/each}
  <button type="button" class="add" onclick={addCustom}>
    <Plus size={14} aria-hidden="true" />
    {tr('onboard.impl.addOwn')}
  </button>
</section>

<style>
  h3 {
    margin: 0 0 8px;
    font-size: 13px;
    font-weight: 700;
    color: var(--color-forest-deep);
    letter-spacing: 0.02em;
  }
  .owned {
    background: var(--color-cream);
    border: 1px solid var(--color-divider);
    border-radius: 10px;
    padding: 12px 14px;
    margin-bottom: 14px;
  }
  .owned ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    font-size: 13px;
    color: var(--color-ink-soft);
  }
  .owned li {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .owned li :global(svg) {
    color: var(--color-forest);
  }
  .groups {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .group {
    border: 1px solid var(--color-divider);
    border-radius: 10px;
    background: var(--color-paper);
  }
  summary {
    min-height: 48px;
    padding: 0 16px;
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    font-weight: 600;
    color: var(--color-ink);
  }
  .g-label {
    flex: 1;
  }
  .g-count {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-forest);
    background: var(--color-forest-tint, #e5eedf);
    border-radius: 999px;
    padding: 2px 10px;
  }
  .items {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 8px;
    padding: 4px 12px 12px;
  }
  .item {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    border: 1px solid var(--color-divider);
    border-radius: 8px;
    padding: 12px;
    min-height: 48px;
    cursor: pointer;
    background: var(--color-paper);
  }
  .item.on {
    border-color: var(--color-forest);
    background: var(--color-forest-tint, #e5eedf);
  }
  .item.owned {
    cursor: default;
    opacity: 0.75;
  }
  .item input {
    width: 20px;
    height: 20px;
    margin-top: 2px;
    accent-color: var(--color-forest);
    flex-shrink: 0;
  }
  .item-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .item-cat {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-ink-muted);
    font-weight: 700;
  }
  .item-label {
    font-weight: 600;
    font-size: 14px;
    color: var(--color-ink);
  }
  .item-desc {
    font-size: 12.5px;
    color: var(--color-ink-soft);
    line-height: 1.4;
  }
  .custom {
    margin-top: 16px;
  }
  .custom-row {
    display: grid;
    grid-template-columns: minmax(120px, 180px) 1fr 48px;
    gap: 8px;
    margin-bottom: 8px;
  }
  select,
  .custom-row input {
    font: inherit;
    min-height: 48px;
    padding: 0 10px;
    border: 1px solid var(--color-divider);
    border-radius: 6px;
    background: var(--color-paper);
    min-width: 0;
  }
  .icon,
  .add {
    font: inherit;
    min-height: 48px;
    border: 1px solid var(--color-divider);
    border-radius: 6px;
    background: var(--color-paper);
    color: var(--color-forest-deep);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }
  .add {
    padding: 0 14px;
    font-weight: 600;
  }
  @media (max-width: 600px) {
    .custom-row {
      grid-template-columns: 1fr 48px;
    }
    .custom-row select {
      grid-column: 1 / -1;
    }
  }
</style>
