<script lang="ts">
  /**
   * Linked reference chip for a pluginId. Resolves the slug to its
   * display name via the page's `pluginLookup` map and renders as a
   * compact link. Falls back to the raw slug when unknown so deleted /
   * pre-registry-load references stay visible.
   */
  type LookupEntry = { displayName: string; type: string };

  let {
    pluginId,
    lookup
  }: {
    pluginId: string;
    lookup: Record<string, LookupEntry>;
  } = $props();

  const meta = $derived(lookup[pluginId]);
</script>

{#if meta}
  <a class="ref-chip" href="/plugins/{encodeURIComponent(pluginId)}" title={pluginId}>
    {meta.displayName}
  </a>
{:else}
  <span class="ref-chip missing" title="pluginId not found in registry">{pluginId}</span>
{/if}

<style>
  .ref-chip {
    display: inline-flex;
    align-items: center;
    background: #e7f1ea;
    color: #1f5e3a;
    border: 1px solid #b3d4bf;
    border-radius: 10px;
    padding: 0.05rem 0.5rem;
    font-size: 0.78rem;
    line-height: 1.5;
    text-decoration: none;
    white-space: nowrap;
    transition: background-color 0.1s ease;
  }
  .ref-chip:hover {
    background: #d4e5db;
    text-decoration: none;
  }
  .ref-chip.missing {
    background: #fce8e8;
    color: #b00020;
    border-color: #e8b3b9;
    font-style: italic;
  }
</style>
