<script lang="ts">
  /**
   * Read-only structured display of a plugin payload. Renders every
   * non-header field as a labeled row with smart formatting:
   *   - primitives → inline text
   *   - booleans → Yes / No
   *   - arrays of primitives → chip row
   *   - arrays of objects → nested rows
   *   - nested objects → inline (e.g. ratePerAcre: 2.4 qt) or recursive
   *
   * Designed for /plugins/[pluginId] so the operator sees the data
   * structured rather than having to read raw JSON.
   */
  import Self from './PluginDataView.svelte';

  let { plugin }: { plugin: Record<string, unknown> } = $props();

  const HEADER_KEYS = new Set([
    'pluginId',
    'type',
    'version',
    'displayName',
    'pluginSchemaVersion'
  ]);

  const entries = $derived(
    Object.entries(plugin).filter(
      ([k, v]) => !HEADER_KEYS.has(k) && v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)
    )
  );

  function formatKey(k: string): string {
    return k
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (c) => c.toUpperCase())
      .replace(/Json$/, '')
      .trim();
  }

  function isPrimitive(v: unknown): v is string | number | boolean {
    return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
  }

  function isFlatObject(v: unknown): v is Record<string, unknown> {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
    return Object.values(v as Record<string, unknown>).every(isPrimitive);
  }

  function formatFlatObject(o: Record<string, unknown>): string {
    return Object.entries(o)
      .map(([k, v]) => `${formatKey(k)}: ${formatPrimitive(v)}`)
      .join(' · ');
  }

  function formatPrimitive(v: unknown): string {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    return String(v);
  }
</script>

<dl class="data">
  {#each entries as [key, value] (key)}
    <div class="row">
      <dt>{formatKey(key)}</dt>
      <dd>
        {#if isPrimitive(value)}
          <span>{formatPrimitive(value)}</span>
        {:else if Array.isArray(value)}
          {#if value.every(isPrimitive)}
            <span class="chips">
              {#each value as v}
                <span class="chip">{formatPrimitive(v)}</span>
              {/each}
            </span>
          {:else}
            <ul class="nested">
              {#each value as v, i (i)}
                <li>
                  {#if isFlatObject(v)}
                    <span class="flat">{formatFlatObject(v)}</span>
                  {:else if v && typeof v === 'object'}
                    <Self plugin={v as Record<string, unknown>} />
                  {:else}
                    <span>{formatPrimitive(v)}</span>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        {:else if isFlatObject(value)}
          <span class="flat">{formatFlatObject(value)}</span>
        {:else if value && typeof value === 'object'}
          <Self plugin={value as Record<string, unknown>} />
        {/if}
      </dd>
    </div>
  {/each}
</dl>

<style>
  .data {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.4rem 1rem;
    margin: 0;
    align-items: baseline;
  }
  .row {
    display: contents;
  }
  dt {
    color: #555;
    font-size: 0.85rem;
    font-weight: 600;
    text-transform: capitalize;
    line-height: 1.4;
  }
  dd {
    margin: 0;
    color: #222;
    font-size: 0.9rem;
    line-height: 1.4;
  }
  .chips {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .chip {
    background: #e7f1ea;
    color: #1f5e3a;
    padding: 0.1rem 0.45rem;
    border-radius: 3px;
    font-size: 0.8rem;
  }
  .flat {
    color: #333;
  }
  .nested {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .nested > li {
    padding: 0.3rem 0;
    border-top: 1px solid #eee;
  }
  .nested > li:first-child {
    border-top: 0;
    padding-top: 0;
  }
</style>
