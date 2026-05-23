<script lang="ts">
  let { data } = $props();
</script>

<h1>Marketplace admin</h1>

<p class="muted">Signed in as {data.admin?.email}</p>

<section class="grid">
  <div class="stat">
    <div class="label">Approved versions</div>
    <div class="value">{data.counts.approved}</div>
  </div>
  <div class="stat">
    <div class="label">Pending review</div>
    <div class="value">{data.counts.pendingReview}</div>
    {#if data.counts.pendingReview > 0}
      <a href="/admin/review">Review →</a>
    {/if}
  </div>
  <div class="stat">
    <div class="label">Rejected</div>
    <div class="value">{data.counts.rejected}</div>
  </div>
  <div class="stat">
    <div class="label">Active credentials</div>
    <div class="value">{data.counts.activeCredentials}</div>
    <a href="/admin/sources">Manage →</a>
  </div>
</section>

<nav class="nav">
  <a href="/admin/sources">Sources</a>
  <a href="/admin/review">Review queue</a>
  <a href="/admin/audit">Audit log</a>
</nav>

<style>
  .muted {
    color: #555;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: 1rem;
    margin: 1rem 0 2rem;
  }
  .stat {
    background: #f5f7f4;
    padding: 1rem;
    border-radius: 8px;
  }
  .stat .label {
    font-size: 0.85rem;
    color: #555;
  }
  .stat .value {
    font-size: 1.75rem;
    font-weight: 600;
    margin: 0.25rem 0;
  }
  .nav {
    display: flex;
    gap: 1rem;
    margin-top: 2rem;
  }
</style>
