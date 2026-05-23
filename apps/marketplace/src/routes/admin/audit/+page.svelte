<script lang="ts">
  let { data } = $props();

  function fmtDate(ms: number) {
    return new Date(ms).toLocaleString();
  }
</script>

<h1>Audit log <a href="/admin" class="back">← admin</a></h1>

<p class="muted">Latest {data.events.length} of capped {data.limit} events.</p>

<table>
  <thead>
    <tr>
      <th>When</th>
      <th>Actor</th>
      <th>Action</th>
      <th>Target</th>
      <th>Payload</th>
    </tr>
  </thead>
  <tbody>
    {#each data.events as ev (ev.id)}
      <tr>
        <td>{fmtDate(ev.createdAt)}</td>
        <td>{ev.actorType}<br /><code class="id">{ev.actorId ?? '—'}</code></td>
        <td><code>{ev.action}</code></td>
        <td>{ev.targetTable ?? ''}<br /><code class="id">{ev.targetId ?? ''}</code></td>
        <td><pre>{JSON.stringify(ev.payload, null, 2)}</pre></td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .back {
    font-size: 0.85rem;
    color: #555;
    margin-left: 1rem;
  }
  .muted {
    color: #555;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 1rem;
  }
  th,
  td {
    text-align: left;
    padding: 0.5rem;
    border-bottom: 1px solid #eee;
    font-size: 0.85rem;
    vertical-align: top;
  }
  .id {
    font-family: monospace;
    font-size: 0.75rem;
    color: #777;
  }
  pre {
    background: #f8f8f6;
    padding: 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
    overflow-x: auto;
    max-width: 30rem;
    max-height: 12rem;
  }
</style>
