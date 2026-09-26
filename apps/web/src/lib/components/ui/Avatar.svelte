<script lang="ts">
  import { User } from 'lucide-svelte';

  interface Props {
    name: string;
    src?: string | null;
    size?: number;
    class?: string;
  }

  const { name, src = null, size = 32, class: className = '' }: Props = $props();

  let failedSrc = $state<string | null>(null);
  const showImage = $derived(!!src && failedSrc !== src);
  const initial = $derived(name.match(/\p{L}/u)?.[0]?.toUpperCase() ?? null);
</script>

<span
  class="avatar {className}"
  style:width="{size}px"
  style:height="{size}px"
  style:font-size="{Math.round(size * 0.4)}px"
  aria-hidden="true"
>
  {#if showImage}
    <img {src} alt="" width={size} height={size} onerror={() => (failedSrc = src)} />
  {:else if initial}
    {initial}
  {:else}
    <User size={Math.round(size * 0.55)} strokeWidth={2} data-testid="avatar-person" />
  {/if}
</span>

<style>
  .avatar {
    border-radius: 999px;
    background: var(--color-wheat, #d4a75c);
    color: var(--color-cream, #f8f3e8);
    display: inline-grid;
    place-items: center;
    font-weight: 700;
    font-family: var(--font-serif, serif);
    flex-shrink: 0;
    overflow: hidden;
    line-height: 1;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
</style>
