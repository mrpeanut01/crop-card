<script lang="ts">
  import Kicker from '$lib/components/ui/Kicker.svelte';
</script>

<svelte:head><title>Community plugins · CropCard</title></svelte:head>

<header class="head">
  <Kicker>Plugins · Community</Kicker>
  <h1>Community plugins</h1>
  <p class="lede">
    Shared browsing and one-click install aren't available in CropCard yet. You can still add any
    crop or input plugin today — here's how.
  </p>
</header>

<section class="card" aria-labelledby="add-now">
  <h2 id="add-now">Add a plugin now</h2>
  <ul class="actions">
    <li>
      <a class="action primary" href="/plugins" data-testid="community-upload">
        Upload plugin JSON →
      </a>
      <span class="hint">
        Owners can paste or upload a plugin file a neighbor or extension agent shared with you.
      </span>
    </li>
    <li>
      <a class="action" href="/plugins/new">Author a plugin →</a>
      <span class="hint">Step-by-step wizard for a crop or product that isn't in the library.</span>
    </li>
    <li>
      <a class="action" href="/inventory?type=crop&mode=catalog" data-testid="community-catalog">
        Browse installed catalog →
      </a>
      <span class="hint">Every crop and input plugin already on this farm.</span>
    </li>
  </ul>
</section>

<section class="card" aria-labelledby="status">
  <h2 id="status">What the marketplace will be</h2>
  <p>
    A curated catalog of reviewed plugin definitions — crops, herbicides, insecticides, fungicides,
    fertilizers and companions — that CropCard can pull in with one click. The catalog service
    exists and is admin-reviewed today, but this app does not connect to it yet, so there is nothing
    to browse from here.
  </p>
  <p>
    The contract won't change when it opens: plugins are data only, every file is re-validated
    against its schema, and the bypass check guarantees a plugin can never loosen a safety rule.
    Uploads you make today go through that same check.
  </p>
</section>

<style>
  .head {
    margin-bottom: 1rem;
  }
  h1 {
    margin: 0.25rem 0 0.5rem;
  }
  .lede {
    margin: 0;
    color: var(--color-ink-soft, #444);
    max-width: 60ch;
  }
  .card {
    background: var(--color-paper, white);
    border: 1px solid var(--color-divider, #e5e0d5);
    padding: 1.25rem;
    border-radius: 8px;
    margin-bottom: 1rem;
  }
  h2 {
    margin: 0 0 0.75rem;
    font-size: 1.1rem;
  }
  .actions {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.9rem;
  }
  .actions li {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .action {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    min-height: 48px;
    padding: 0 1rem;
    border-radius: 6px;
    border: 1px solid var(--color-forest, #2f5a3a);
    color: var(--color-forest, #2f5a3a);
    font-weight: 600;
    text-decoration: none;
  }
  .action.primary {
    background: var(--color-forest, #2f5a3a);
    color: var(--color-cream, #fff);
  }
  .action:focus-visible {
    outline: 3px solid var(--color-sky, #6f8fa8);
    outline-offset: 2px;
  }
  .hint {
    font-size: 0.9rem;
    color: var(--color-ink-muted, #555);
  }
</style>
