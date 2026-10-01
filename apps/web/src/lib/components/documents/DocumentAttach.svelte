<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { DocumentMeta } from '$lib/documents/apiSchemas';
  import {
    DOCUMENT_ACCEPT,
    DOCUMENT_SUBJECT_LABEL,
    VAULT_OFF_COPY,
    formatBytes,
    formatLocalDay,
    type DocumentKind
  } from '$lib/documents/kinds';
  import { fileHref, refusalCopy, uploadDocument } from '$lib/documents/client';

  /**
   * Phase 33A (A-37). Attach a file to a record: upload one, pick one the
   * farm already has, open, replace, remove from this record, or (for the
   * signed-in owner) delete the file. The parent saves `documentId` with
   * its own record; this control only stores the file. When the parent
   * saves straight away, `onchange` returns false on a failed save and the
   * control goes back to what was attached before.
   */
  interface Props {
    documentId: string | null;
    kind: DocumentKind;
    canEdit: boolean;
    onchange: (documentId: string | null) => void | boolean | Promise<void | boolean>;
    ondelete?: (documentId: string) => void;
  }

  const { documentId, kind, canEdit, onchange, ondelete }: Props = $props();
  const uid = $props.id();

  let meta = $state<DocumentMeta | null>(null);
  let metaMissing = $state(false);
  let online = $state(true);
  let vaultEnabled = $state(true);
  let canDelete = $state(false);
  let busy = $state<'' | 'upload' | 'delete' | 'save'>('');
  let error = $state<string | null>(null);
  let picking = $state(false);
  let choices = $state<DocumentMeta[]>([]);
  let confirmingDelete = $state(false);

  const deletedLine = $derived(
    meta?.deletedAt
      ? `Deleted on ${formatLocalDay(meta.deletedAt)}${
          meta.deletedBy ? ` by ${meta.deletedBy.label}` : ''
        }`
      : null
  );
  const otherLinks = $derived((meta?.links ?? []).filter((l) => l.subjectExists));

  onMount(() => {
    online = navigator.onLine;
    const on = () => (online = true);
    const off = () => (online = false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    if (canEdit) void loadChoices();
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  });

  $effect(() => {
    const id = documentId;
    if (!id) {
      meta = null;
      metaMissing = false;
      return;
    }
    if (untrack(() => meta?.id) === id) return;
    void loadMeta(id);
  });

  async function loadMeta(id: string) {
    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(id)}`);
      if (res.ok) {
        meta = ((await res.json()) as { document: DocumentMeta }).document;
        metaMissing = false;
      } else {
        meta = null;
        metaMissing = true;
      }
    } catch {
      meta = null;
    }
  }

  async function loadChoices() {
    try {
      const res = await fetch(`/api/documents?kind=${encodeURIComponent(kind)}`);
      if (!res.ok) return;
      const body = (await res.json()) as {
        documents: DocumentMeta[];
        vault?: { enabled: boolean };
        canDelete?: boolean;
      };
      choices = body.documents;
      vaultEnabled = body.vault?.enabled ?? true;
      canDelete = body.canDelete ?? false;
    } catch {
      /* offline: the control already says uploads need a connection */
    }
  }

  async function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    error = null;
    busy = 'upload';
    const out = await uploadDocument(file, { kind });
    busy = '';
    if (!out.ok) {
      if (out.code === 'VAULT_OFF') vaultEnabled = false;
      error = out.message;
      return;
    }
    choices = [out.document, ...choices.filter((c) => c.id !== out.document.id)];
    picking = false;
    await commit(out.document);
  }

  async function commit(next: DocumentMeta | null) {
    const prev = meta;
    meta = next;
    busy = 'save';
    try {
      if ((await onchange(next?.id ?? null)) === false) meta = prev;
    } finally {
      busy = '';
    }
  }

  function pick(doc: DocumentMeta) {
    picking = false;
    error = null;
    void commit(doc);
  }

  function remove() {
    confirmingDelete = false;
    error = null;
    void commit(null);
  }

  async function deleteFile() {
    if (!meta) return;
    error = null;
    busy = 'delete';
    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(meta.id)}`, {
        method: 'DELETE'
      });
      const body = (await res.json().catch(() => ({}))) as {
        document?: DocumentMeta;
        code?: string;
        error?: string;
      };
      if (!res.ok || !body.document) {
        error = refusalCopy(res.status, body);
        return;
      }
      meta = body.document;
      choices = choices.filter((c) => c.id !== body.document!.id);
      confirmingDelete = false;
      ondelete?.(body.document.id);
    } catch {
      error = 'Deleting a file needs a connection.';
    } finally {
      busy = '';
    }
  }
</script>

<div class="attach" data-testid="document-attach">
  {#if meta}
    <div class="file" class:deleted={!!meta.deletedAt}>
      <div class="file-text">
        <span class="title">{meta.title}</span>
        {#if deletedLine}
          <span class="sub" data-testid="document-deleted-line">{deletedLine}</span>
        {:else}
          <span class="sub">{formatBytes(meta.byteSize)}</span>
        {/if}
      </div>
      {#if !meta.deletedAt}
        <a class="btn" href={fileHref(meta.id)} target="_blank" rel="noopener">Open</a>
      {/if}
    </div>
  {:else if documentId && metaMissing}
    <p class="sub">The attached file can't be shown to you.</p>
  {/if}

  {#if canEdit}
    {#if !online}
      <p class="note" role="note">Uploads need a connection.</p>
    {:else if !vaultEnabled}
      <p class="note" role="note">{VAULT_OFF_COPY}</p>
    {/if}
    <div class="actions">
      <label class="btn" class:disabled={!online || !vaultEnabled || busy !== ''}>
        <input
          id="{uid}-file"
          type="file"
          accept={DOCUMENT_ACCEPT}
          disabled={!online || !vaultEnabled || busy !== ''}
          onchange={onFile}
          data-testid="document-attach-input"
        />
        <span>{busy === 'upload' ? 'Uploading...' : meta ? 'Replace' : 'Attach a file'}</span>
      </label>
      {#if choices.some((c) => c.id !== meta?.id)}
        <button
          type="button"
          class="btn"
          disabled={!online || busy !== ''}
          aria-expanded={picking}
          onclick={() => (picking = !picking)}>Pick from your files</button
        >
      {/if}
      {#if meta}
        <button type="button" class="btn" disabled={!online || busy !== ''} onclick={remove}
          >Remove from this record</button
        >
        {#if canDelete && !meta.deletedAt}
          <button
            type="button"
            class="btn danger"
            disabled={!online || busy !== ''}
            onclick={() => (confirmingDelete = true)}>Delete file</button
          >
        {/if}
      {/if}
    </div>

    {#if picking}
      <ul class="choices" aria-label="Your files">
        {#each choices.filter((c) => c.id !== meta?.id) as c (c.id)}
          <li>
            <button type="button" class="choice" onclick={() => pick(c)}>
              <span class="title">{c.title}</span>
              <span class="sub">{formatLocalDay(c.createdAt)}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    {#if confirmingDelete && meta}
      <div class="confirm" role="alertdialog" aria-labelledby="{uid}-confirm">
        <p id="{uid}-confirm">
          Delete "{meta.title}" for good?
          {#if otherLinks.length > 1}
            It is also attached to {otherLinks.length - 1} other
            {otherLinks.length - 1 === 1 ? 'record' : 'records'}:
            {otherLinks
              .slice(0, 5)
              .map((l) => DOCUMENT_SUBJECT_LABEL[l.subjectType])
              .join(', ')}.
          {/if}
          Records that point at it will say it was deleted.
        </p>
        <div class="actions">
          <button
            type="button"
            class="btn danger"
            disabled={busy !== ''}
            onclick={deleteFile}
            data-testid="document-delete-confirm"
            >{busy === 'delete' ? 'Deleting...' : 'Delete file'}</button
          >
          <button type="button" class="btn" onclick={() => (confirmingDelete = false)}
            >Keep it</button
          >
        </div>
      </div>
    {/if}
  {/if}

  {#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
  .attach {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  .file {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    background: var(--color-paper);
    min-width: 0;
  }
  .file.deleted {
    background: var(--pill-wheat-bg);
  }
  .file-text {
    display: flex;
    flex-direction: column;
    flex: 1;
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
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
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
  .btn:focus-within,
  .btn:focus-visible {
    box-shadow: var(--focus-ring);
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
  .btn input[type='file'] {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
  }
  .btn input[type='file']:disabled {
    cursor: not-allowed;
  }
  .choices {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .choice {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 100%;
    min-height: 48px;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    background: var(--color-paper);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .note {
    margin: 0;
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
  }
  .confirm {
    padding: var(--space-3);
    border-radius: var(--radius-card);
    background: var(--pill-rust-bg, var(--pill-wheat-bg));
  }
  .confirm p {
    margin: 0 0 var(--space-2);
  }
  .error {
    margin: 0;
    color: var(--color-rust);
  }
</style>
