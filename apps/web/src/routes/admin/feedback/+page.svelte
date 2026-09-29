<script lang="ts">
  import { enhance } from '$app/forms';
  import { fmt } from '$lib/prefsState.svelte';
  import { browserSummary } from '$lib/feedback/userAgent';
  import {
    FEEDBACK_KIND_LABELS,
    FEEDBACK_STATUSES,
    FEEDBACK_STATUS_LABELS
  } from '$lib/feedback/model';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const total = $derived(Object.values(data.counts).reduce((a, b) => a + b, 0));
  const formFor = (id: string) => (form && 'id' in form && form.id === id ? form : null);
</script>

<svelte:head>
  <title>Admin · Feedback | CropCard</title>
</svelte:head>

<div class="admin">
  <nav class="crumbs" aria-label="Admin pages">
    <a href="/admin/owners">Owners</a>
    <span aria-hidden="true">·</span>
    <a href="/admin/feedback" aria-current="page">Feedback</a>
  </nav>
  <h1>Feedback</h1>
  <p class="hint">
    Bug reports and ideas from every farm. Status changes, notes and GitHub sends are written to the
    superadmin audit log.
  </p>

  <nav class="filters" aria-label="Filter by status">
    <a href="/admin/feedback" class="chip" aria-current={data.status === null ? 'page' : undefined}
      >All <span class="n">{total}</span></a
    >
    {#each FEEDBACK_STATUSES as s (s)}
      <a
        href="/admin/feedback?status={s}"
        class="chip"
        aria-current={data.status === s ? 'page' : undefined}
        >{FEEDBACK_STATUS_LABELS[s]} <span class="n">{data.counts[s]}</span></a
      >
    {/each}
  </nav>

  {#if !data.github}
    <p class="note">
      Sending to GitHub is off. Set <code>GITHUB_FEEDBACK_TOKEN</code> and
      <code>GITHUB_FEEDBACK_REPO</code> to turn it on.
    </p>
  {/if}

  {#if data.items.length === 0}
    <p class="empty">No feedback here yet.</p>
  {:else}
    <ul class="items">
      {#each data.items as f (f.id)}
        {@const result = formFor(f.id)}
        <li class="item" data-testid="feedback-item" data-status={f.status}>
          <header>
            <span class="kind {f.kind}">{FEEDBACK_KIND_LABELS[f.kind]}</span>
            <span class="status-pill">{FEEDBACK_STATUS_LABELS[f.status]}</span>
            <time datetime={new Date(f.createdAt).toISOString()}
              >{fmt.instant(f.createdAt, 'date')}</time
            >
          </header>
          <p class="message">{f.message}</p>
          <dl class="context">
            <div>
              <dt>Page</dt>
              <dd><code>{f.pagePath ?? 'unknown'}</code></dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{f.role ?? 'no farm yet'}</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd><code>{f.appVersion ?? 'unknown'}</code></dd>
            </div>
            <div>
              <dt>Farm</dt>
              <dd>
                {#if f.ownerId}
                  <a href="/admin/owners?q={encodeURIComponent(f.farmSlug ?? f.ownerId)}"
                    >{f.farmName ?? f.ownerId}</a
                  >
                {:else}
                  No farm yet
                {/if}
              </dd>
            </div>
            <div>
              <dt>From</dt>
              <dd>
                {#if f.who}
                  {#if f.who.includes('@')}<a href="mailto:{f.who}">{f.who}</a>{:else}{f.who}{/if}
                {:else}
                  <code>{f.userId ?? 'unknown'}</code>
                {/if}
              </dd>
            </div>
            {#if f.userAgent}
              <div class="ua">
                <dt>Browser</dt>
                <dd title={f.userAgent}>{browserSummary(f.userAgent)}</dd>
              </div>
            {/if}
          </dl>

          <form
            method="POST"
            action="?/triage"
            use:enhance={() =>
              async ({ update }) =>
                update({ reset: false })}
            class="triage"
          >
            <input type="hidden" name="id" value={f.id} />
            <label>
              <span>Status</span>
              <select name="status" value={f.status}>
                {#each FEEDBACK_STATUSES as s (s)}
                  <option value={s}>{FEEDBACK_STATUS_LABELS[s]}</option>
                {/each}
              </select>
            </label>
            <label class="notes">
              <span>Notes (only superadmins see these)</span>
              <textarea name="adminNotes" rows="2" maxlength="4000" value={f.adminNotes ?? ''}
              ></textarea>
            </label>
            <button type="submit">Save</button>
            {#if result && 'saved' in result && result.saved}
              <span class="ok" role="status">Saved.</span>
            {/if}
          </form>

          {#if f.githubIssueUrl}
            <p class="gh-sent">
              On GitHub: <a href={f.githubIssueUrl} target="_blank" rel="noopener noreferrer"
                >{f.githubIssueUrl.replace('https://github.com/', '')}</a
              >
            </p>
          {:else if data.github}
            <details class="gh">
              <summary>Send to GitHub ({data.github.repo})</summary>
              <p class="hint">
                Read this before sending. The issue may be public, so remove anything personal.
              </p>
              <form method="POST" action="?/github" use:enhance>
                <input type="hidden" name="id" value={f.id} />
                <label>
                  <span>Title</span>
                  <input name="title" value={f.draft.title} maxlength="200" required />
                </label>
                <label>
                  <span>Text</span>
                  <textarea name="body" rows="6" required value={f.draft.body}></textarea>
                </label>
                <button type="submit">Send to GitHub</button>
              </form>
            </details>
          {/if}
          {#if result && 'githubUrl' in result && result.githubUrl}
            <p class="ok" role="status">Sent to GitHub.</p>
          {/if}
          {#if result && 'error' in result && result.error}
            <p class="error" role="alert">{result.error}</p>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .admin {
    max-width: 960px;
    margin: 0 auto;
  }
  .crumbs {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: var(--font-size-caption);
  }
  .crumbs a {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
  }
  .crumbs a[aria-current='page'] {
    font-weight: 700;
    color: var(--color-forest-deep);
  }
  h1 {
    margin: 0 0 4px;
  }
  .hint,
  .note {
    color: var(--color-ink-muted);
  }
  .note {
    border-left: 3px solid var(--color-wheat);
    padding: 6px 10px;
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 12px 0;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 48px;
    padding: 0 14px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-pill);
    color: var(--color-ink);
    text-decoration: none;
  }
  .chip[aria-current='page'] {
    background: var(--pill-forest-bg);
    color: var(--pill-forest-fg);
    border-color: transparent;
    font-weight: 600;
  }
  .n {
    font-variant-numeric: tabular-nums;
    color: var(--color-ink-muted);
  }
  .items {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 12px;
  }
  .item {
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    background: var(--color-paper);
    padding: 12px 14px;
    min-width: 0;
  }
  .item header {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .kind,
  .status-pill {
    font-size: var(--font-size-caption);
    font-weight: 600;
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    background: var(--color-divider-soft);
  }
  .kind.bug {
    background: var(--pill-rust-bg, #f6e1d8);
    color: var(--pill-rust-fg, #7a2e12);
  }
  time {
    margin-left: auto;
    color: var(--color-ink-muted);
    font-size: var(--font-size-caption);
  }
  .message {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    margin: 10px 0;
  }
  .context {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    margin: 0 0 10px;
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
  }
  .context div {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .context dt {
    font-weight: 600;
    flex-shrink: 0;
    white-space: nowrap;
  }
  .context a {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
  }
  .context dd {
    margin: 0;
  }

  form {
    display: grid;
    gap: 8px;
  }
  .triage {
    grid-template-columns: minmax(0, 180px) minmax(0, 1fr) auto;
    align-items: end;
  }
  label {
    display: grid;
    gap: 4px;
    font-size: var(--font-size-caption);
    font-weight: 600;
    min-width: 0;
  }
  select,
  input,
  textarea {
    min-height: 48px;
    box-sizing: border-box;
    width: 100%;
    font: inherit;
    font-weight: 400;
    padding: 8px 10px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    background: var(--color-paper);
    color: var(--color-ink);
  }
  button {
    min-height: 48px;
    padding: 0 18px;
    border-radius: var(--radius-input);
    border: 1px solid var(--color-forest);
    background: var(--color-forest);
    color: var(--color-cream);
    font-weight: 600;
    cursor: pointer;
  }
  .gh {
    margin-top: 10px;
  }
  .gh summary {
    min-height: 48px;
    display: flex;
    align-items: center;
    cursor: pointer;
    font-weight: 600;
    color: var(--color-forest);
  }
  .gh-sent {
    margin: 10px 0 0;
    overflow-wrap: anywhere;
  }
  .ok {
    color: var(--color-forest);
    font-weight: 600;
  }
  .error {
    color: var(--color-rust);
    font-weight: 600;
  }
  .empty {
    color: var(--color-ink-muted);
  }
  @media (max-width: 640px) {
    .triage {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
