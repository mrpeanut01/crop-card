<script lang="ts">
  // Public landing page — no data load, no auth.
</script>

<svelte:head>
  <title>CropCard Marketplace</title>
</svelte:head>

<main>
  <h1>CropCard Marketplace</h1>
  <p class="lede">
    Catalog API + admin surface for distributing validated plugin definitions
    (crops, herbicides, insecticides, fungicides, fertilizers, companions)
    to CropCard installations.
  </p>

  <section>
    <h2>For integrators</h2>
    <p>
      Authenticated read API under <code>/api/v1/*</code>. Bearer credential
      (<code>ccm_…</code>) required on every endpoint except
      <a href="/api/v1/health"><code>GET /api/v1/health</code></a>, which
      is always public.
    </p>
    <ul>
      <li><a href="/api/v1/plugins"><code>GET /api/v1/plugins</code></a> — list approved plugins (paginated)</li>
      <li><code>GET /api/v1/plugins/{'{pluginId}'}</code> — latest approved version</li>
      <li><code>GET /api/v1/plugins/{'{pluginId}'}/versions</code> — version history</li>
      <li><code>GET /api/v1/plugins/{'{pluginId}'}/by-hash/{'{hash}'}</code> — immutable by content hash</li>
      <li><code>GET /api/v1/feed?since=…</code> — changelog feed</li>
      <li><code>POST /api/v1/plugins</code> — upload a new version (scan pipeline)</li>
    </ul>
  </section>

  <section>
    <h2>For operators</h2>
    <p>
      <a href="/admin">Admin sign-in →</a> (magic-link email)
    </p>
    <p class="muted">
      Manage app credentials, review pending uploads, inspect the audit log.
    </p>
  </section>

  <footer>
    <p class="muted">
      Part of the CropCard project. Source code, plugin schemas, and
      contribution guidance live in the
      <a href="https://github.com/mrpeanut01/crop-card">main repository</a>.
    </p>
  </footer>
</main>

<style>
  main {
    max-width: 760px;
    margin: 0 auto;
    padding: 2rem 1.25rem;
    font-family: system-ui, sans-serif;
    color: #222;
  }
  h1 {
    margin: 0 0 0.5rem;
  }
  .lede {
    color: #555;
    font-size: 1.05rem;
    margin: 0 0 2rem;
  }
  section {
    margin-bottom: 2rem;
  }
  h2 {
    margin: 0 0 0.5rem;
    font-size: 1.15rem;
  }
  ul {
    margin: 0.5rem 0;
    padding-left: 1.25rem;
  }
  li {
    margin-bottom: 0.35rem;
  }
  code {
    background: #f5f7f4;
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
    font-size: 0.92em;
  }
  .muted {
    color: #777;
    font-size: 0.9rem;
  }
  a {
    color: #1f5e3a;
  }
  footer {
    margin-top: 3rem;
    padding-top: 1.25rem;
    border-top: 1px solid #e4e9e4;
  }
</style>
