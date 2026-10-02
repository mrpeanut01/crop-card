<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import SettingsShell from '$lib/components/settings/SettingsShell.svelte';
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte';
  import type { DocumentMeta } from '$lib/documents/apiSchemas';
  import {
    BACKUP_COPY_NOTE,
    DOCUMENT_ACCEPT,
    VAULT_OFF_COPY,
    formatBytes,
    formatLocalDay,
    isPhotoKind,
    type DocumentKind
  } from '$lib/documents/kinds';
  import { fileHref, refusalCopy, uploadDocument } from '$lib/documents/client';
  import { createT } from '$lib/i18n';
  import {
    DOCUMENT_KIND_KEYS,
    DOCUMENT_SUBJECT_KEYS,
    localizeDocCopy
  } from '$lib/components/documents/labels';

  const { data } = $props();

  const tr = $derived(createT(data.locale));

  type Filter = DocumentKind | 'all';
  let filter = $state<Filter>('all');
  let uploadKind = $state<DocumentKind>('lab-report');
  let uploadTitle = $state('');
  let busy = $state(false);
  let message = $state<string | null>(null);
  let error = $state<string | null>(null);
  let confirming = $state<string | null>(null);
  type Cursor = { before: number; beforeId: string | null } | null;
  /** Pages fetched with Load more, and the cursor after the last of them.
   *  Without them the cursor comes from the page data, so it follows
   *  every reload. */
  let more = $state<{ docs: DocumentMeta[]; cursor: Cursor } | null>(null);
  const pageCursor = $derived<Cursor>(
    data.isOwner && data.nextBefore !== null
      ? { before: data.nextBefore, beforeId: data.nextBeforeId ?? null }
      : null
  );
  const cursor = $derived(more ? more.cursor : pageCursor);

  const uploadKinds = $derived(
    data.isOwner ? data.kindTotals.map((t) => t.kind).filter((k) => !isPhotoKind(k)) : []
  );
  const fileTotals = $derived(
    data.isOwner ? data.kindTotals.filter((t) => !isPhotoKind(t.kind) && t.count > 0) : []
  );
  const photoTotals = $derived(
    data.isOwner ? data.kindTotals.filter((t) => isPhotoKind(t.kind) && t.count > 0) : []
  );
  const allDocs = $derived.by(() => {
    if (!data.isOwner) return [];
    const seen = new Set(data.documents.map((d) => d.id));
    return [...data.documents, ...(more?.docs ?? []).filter((d) => !seen.has(d.id))];
  });
  const shown = $derived(filter === 'all' ? allDocs : allDocs.filter((d) => d.kind === filter));
  const pct = $derived(
    data.isOwner && data.capBytes > 0 ? Math.min(100, (data.usedBytes / data.capBytes) * 100) : 0
  );
  const overCap = $derived(data.isOwner && data.usedBytes >= data.capBytes);

  function attachedTo(d: DocumentMeta): string {
    const live = d.links.filter((l) => l.subjectExists);
    if (live.length === 0) return tr('docs.page.notAttached');
    const names = [...new Set(live.map((l) => tr(DOCUMENT_SUBJECT_KEYS[l.subjectType])))].join(
      ', '
    );
    return live.length === 1
      ? tr('docs.page.attachedOne', { names })
      : tr('docs.page.attachedMany', { count: live.length, names });
  }

  async function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    busy = true;
    error = null;
    message = null;
    const out = await uploadDocument(file, { kind: uploadKind, title: uploadTitle });
    busy = false;
    if (!out.ok) {
      error = localizeDocCopy(tr, out.message);
      return;
    }
    uploadTitle = '';
    message = tr('docs.page.saved', { title: out.document.title });
    more = null;
    await invalidateAll();
  }

  async function remove(d: DocumentMeta) {
    busy = true;
    error = null;
    message = null;
    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(d.id)}`, { method: 'DELETE' });
      const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
      if (!res.ok) {
        error = localizeDocCopy(tr, refusalCopy(res.status, body));
        return;
      }
      confirming = null;
      message = tr('docs.page.deleted', { title: d.title });
      if (more) more = { ...more, docs: more.docs.filter((m) => m.id !== d.id) };
      await invalidateAll();
    } catch {
      error = tr('docs.attach.deleteNeedsConnection');
    } finally {
      busy = false;
    }
  }

  async function loadMore() {
    const from = cursor;
    if (from === null) return;
    const q = new URLSearchParams({ before: String(from.before) });
    if (from.beforeId) q.set('beforeId', from.beforeId);
    const res = await fetch(`/api/documents?${q}`);
    if (!res.ok) return;
    const body = (await res.json()) as {
      documents: DocumentMeta[];
      nextBefore: number | null;
      nextBeforeId?: string | null;
    };
    more = {
      docs: [...(more?.docs ?? []), ...body.documents],
      cursor:
        body.nextBefore === null
          ? null
          : { before: body.nextBefore, beforeId: body.nextBeforeId ?? null }
    };
  }
</script>

<svelte:head><title>{tr('docs.page.pageTitle')}</title></svelte:head>

<SettingsShell title={tr('docs.page.title')} kicker={tr('docs.page.kicker')} hideFooter>
  {#if !data.isOwner}
    <p class="note" role="note">{tr('docs.page.ownerOnly')}</p>
  {:else}
    <SettingsSection title={tr('docs.page.storageTitle')} sub={tr('docs.page.storageSub')}>
      <div class="meter" data-testid="documents-usage">
        <div
          class="bar"
          role="meter"
          aria-label={tr('docs.page.storageAria')}
          aria-valuemin={0}
          aria-valuemax={data.capBytes}
          aria-valuenow={Math.min(data.usedBytes, data.capBytes)}
          aria-valuetext={tr('docs.page.usedOf', {
            used: formatBytes(data.usedBytes),
            cap: formatBytes(data.capBytes)
          })}
        >
          <span class="fill" class:full={overCap} style="width: {pct}%"></span>
        </div>
        <p class="meter-text">
          {tr('docs.page.usedOf', {
            used: formatBytes(data.usedBytes),
            cap: formatBytes(data.capBytes)
          })}
        </p>
      </div>
      {#if overCap}
        <p class="warn" role="status" data-testid="documents-over-cap">
          {tr('docs.page.overCap')}
          <a href="/settings/billing">{tr('docs.page.seePlans')}</a>
        </p>
      {/if}
      {#if photoTotals.length}
        <ul class="photos" data-testid="documents-photos">
          {#each photoTotals as t (t.kind)}
            <li>
              <span>{tr(DOCUMENT_KIND_KEYS[t.kind])}</span>
              <span>{tr('docs.page.photos', { count: t.count, size: formatBytes(t.bytes) })}</span>
            </li>
          {/each}
        </ul>
        <p class="note">{tr('docs.page.photosNote')}</p>
      {/if}
      <p class="note">{localizeDocCopy(tr, BACKUP_COPY_NOTE)}</p>
      {#if data.canDelete}
        <a class="btn zip" href="/api/account/export.zip" download data-testid="documents-zip"
          >{tr('docs.page.zip')}</a
        >
      {/if}
    </SettingsSection>

    <SettingsSection title={tr('docs.page.uploadTitle')} sub={tr('docs.page.uploadSub')}>
      {#if !data.vaultEnabled}
        <p class="note" role="note" data-testid="documents-vault-off">
          {localizeDocCopy(tr, VAULT_OFF_COPY)}
        </p>
      {:else}
        <div class="upload">
          <label>
            <span>{tr('docs.page.whatIsIt')}</span>
            <select bind:value={uploadKind}>
              {#each uploadKinds as k (k)}
                <option value={k}>{tr(DOCUMENT_KIND_KEYS[k])}</option>
              {/each}
            </select>
          </label>
          <label>
            <span
              >{tr('docs.page.titleLabel')}
              <span class="optional">{tr('docs.page.optional')}</span></span
            >
            <input type="text" maxlength="120" autocomplete="off" bind:value={uploadTitle} />
          </label>
          <label class="btn primary" class:disabled={busy}>
            <input
              type="file"
              accept={DOCUMENT_ACCEPT}
              disabled={busy}
              onchange={onFile}
              data-testid="documents-upload-input"
            />
            <span>{busy ? tr('docs.page.uploading') : tr('docs.page.chooseFile')}</span>
          </label>
        </div>
      {/if}
      {#if message}<p class="ok" role="status">{message}</p>{/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
    </SettingsSection>

    <SettingsSection title={tr('docs.page.filesTitle')}>
      {#if fileTotals.length > 1}
        <div class="chips" role="group" aria-label={tr('docs.page.showKindAria')}>
          <button
            type="button"
            class="chip"
            aria-pressed={filter === 'all'}
            onclick={() => (filter = 'all')}>{tr('docs.page.all')}</button
          >
          {#each fileTotals as t (t.kind)}
            <button
              type="button"
              class="chip"
              aria-pressed={filter === t.kind}
              onclick={() => (filter = t.kind)}>{tr(DOCUMENT_KIND_KEYS[t.kind])} ({t.count})</button
            >
          {/each}
        </div>
      {/if}
      {#if shown.length === 0}
        <p class="note">{tr('docs.page.none')}</p>
      {:else}
        <ul class="files" data-testid="documents-list">
          {#each shown as d (d.id)}
            <li class="file" data-testid="document-row">
              <div class="file-text">
                <span class="title">{d.title}</span>
                <span class="sub"
                  >{tr(DOCUMENT_KIND_KEYS[d.kind])} · {formatBytes(d.byteSize)} · {formatLocalDay(
                    d.createdAt,
                    data.locale
                  )}</span
                >
                <span class="sub">{attachedTo(d)}</span>
              </div>
              <div class="row-actions">
                <a class="btn" href={fileHref(d.id)} target="_blank" rel="noopener"
                  >{tr('docs.page.open')}</a
                >
                {#if data.canDelete}
                  <button
                    type="button"
                    class="btn danger"
                    disabled={busy}
                    onclick={() => (confirming = d.id)}>{tr('docs.page.delete')}</button
                  >
                {/if}
              </div>
              {#if confirming === d.id}
                <div
                  class="confirm"
                  role="alertdialog"
                  aria-label={tr('docs.page.deleteAria', { title: d.title })}
                >
                  <p>
                    {tr('docs.page.confirmLead', { title: d.title })}
                    {#if d.links.some((l) => l.subjectExists)}
                      {tr('docs.page.thoseRecords', { attached: attachedTo(d) })}
                    {/if}
                  </p>
                  <div class="row-actions">
                    <button
                      type="button"
                      class="btn danger"
                      disabled={busy}
                      onclick={() => remove(d)}>{tr('docs.page.deleteFile')}</button
                    >
                    <button type="button" class="btn" onclick={() => (confirming = null)}
                      >{tr('docs.page.keep')}</button
                    >
                  </div>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
        {#if cursor !== null}
          <button type="button" class="btn" onclick={loadMore}>{tr('docs.page.loadMore')}</button>
        {/if}
      {/if}
    </SettingsSection>
  {/if}
</SettingsShell>

<style>
  .meter {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .bar {
    height: 12px;
    border-radius: 6px;
    background: var(--color-divider);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--color-forest);
  }
  .fill.full {
    background: var(--color-rust);
  }
  .meter-text {
    margin: 0;
    font-weight: 600;
  }
  .warn {
    margin: var(--space-2) 0 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-card);
    background: var(--pill-wheat-bg);
  }
  .photos {
    list-style: none;
    margin: var(--space-3) 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .photos li {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .note {
    margin: var(--space-2) 0 0;
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
  }
  .upload {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-2);
  }
  .upload label:not(.btn) {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1 1 200px;
    min-width: 0;
    font-weight: 600;
  }
  .optional {
    font-weight: 400;
    color: var(--color-ink-muted);
  }
  input[type='text'],
  select {
    min-height: 48px;
    padding: 0 var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    background: var(--color-paper);
    font: inherit;
    font-size: 16px;
    width: 100%;
    box-sizing: border-box;
  }
  .btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    min-width: 48px;
    padding: 0 var(--space-3);
    border: 1px solid var(--color-forest);
    border-radius: var(--radius-input);
    background: var(--color-paper);
    color: var(--color-forest);
    font: inherit;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
    box-sizing: border-box;
  }
  .btn.primary {
    background: var(--color-forest);
    color: var(--color-cream);
  }
  .btn.danger {
    border-color: var(--color-rust);
    color: var(--color-rust);
  }
  .btn:disabled,
  .btn.disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .btn:focus-within,
  .btn:focus-visible {
    box-shadow: var(--focus-ring);
  }
  .btn input[type='file'] {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
  }
  .zip {
    margin-top: var(--space-3);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
  .chip {
    min-height: 48px;
    padding: 0 var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: 999px;
    background: var(--color-paper);
    font: inherit;
    cursor: pointer;
  }
  .chip[aria-pressed='true'] {
    border-color: var(--color-forest);
    background: var(--pill-forest-bg);
    font-weight: 600;
  }
  .files {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .file {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    background: var(--color-paper);
    min-width: 0;
  }
  .file-text {
    display: flex;
    flex-direction: column;
    flex: 1 1 180px;
    min-width: 0;
  }
  .title {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .sub {
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
  }
  .row-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .confirm {
    flex-basis: 100%;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-card);
    background: var(--pill-wheat-bg);
  }
  .confirm p {
    margin: 0 0 var(--space-2);
  }
  .ok {
    margin: var(--space-2) 0 0;
    color: var(--color-forest);
  }
  .error {
    margin: var(--space-2) 0 0;
    color: var(--color-rust);
  }
</style>
