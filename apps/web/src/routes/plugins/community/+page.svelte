<script lang="ts">
  // Static stub — no data prop. Phase 10 placeholder for §11 Out-of-Scope
  // "community plugin marketplace". Future iterations would fetch from a
  // signed registry, surface ratings, allow one-click install with
  // re-validation through the bypass-detection path. For now the stub
  // explains the architecture so operators know how to share plugins
  // by hand.
</script>

<h1>Community plugins</h1>

<section class="card">
  <h2>Not yet open</h2>
  <p>
    A signed community marketplace is on the roadmap. CropCard already supports plugin sharing today
    — drop any well-formed plugin JSON file into <code>plugins/crops/</code>,
    <code>plugins/herbicides/</code>, <code>plugins/insecticides/</code>, or
    <code>plugins/companions/</code> and it loads on next start.
  </p>
  <p>
    Each plugin gets re-validated against its Zod schema at boot, runs the bypass-detection check (a
    plugin can never widen safety), and is hashed so audit records can prove which plugin version
    drove which spray decision. The future marketplace will preserve that contract — no plugin can
    ship code, only data.
  </p>
</section>

<section class="card">
  <h2>Until the marketplace exists</h2>
  <ul>
    <li>
      Authoring lives at <a href="/plugins">/plugins</a> — paste or upload a JSON file. The validator
      runs the same bypass check the marketplace will.
    </li>
    <li>
      Schemas are published in <code>schemas/</code> and tracked alongside the app version, so external
      authors can validate against the same rules CropCard does.
    </li>
    <li>
      Sharing today: zip your <code>plugins/</code> folder and email it to a neighbor; they drop it
      into their own <code>plugins/</code> directory.
    </li>
  </ul>
</section>

<section class="card">
  <h2>Want to help build it?</h2>
  <p>
    The marketplace needs (1) a signed plugin registry, (2) a discoverability surface (ratings, crop
    / region tags), and (3) a one-click install path that runs the bypass-detection check
    server-side. If you'd contribute, the code lives in
    <code>apps/web/src/lib/plugins/registry.ts</code> — start there.
  </p>
</section>

<style>
  .card {
    background: white;
    padding: 1.25rem;
    border-radius: 8px;
    margin-bottom: 1rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  ul {
    line-height: 1.6;
  }
  code {
    background: #f5f7f4;
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
    font-size: 0.9rem;
  }
</style>
