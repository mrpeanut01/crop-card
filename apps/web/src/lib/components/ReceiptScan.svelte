<script lang="ts">
  /**
   * Receipt / manifest scan modal. Operator picks an image or PDF; the
   * server streams progress as it (a) extracts line items via Claude
   * vision, (b) looks each up via web_search. Each line renders as a
   * row with an accept / skip toggle; "Save N accepted" bulk-commits
   * to /api/plugins/upload.
   */
  import { invalidateAll } from '$app/navigation';

  type Issue = { path: string; message: string };
  type Validation = { ok: boolean; schemaIssues: Issue[]; bypassIssues: Issue[] };
  type Candidate = {
    source: 'claude-vision' | 'web-search' | 'local';
    candidate: Record<string, unknown> | null;
    validation: Validation;
    confidence?: 'high' | 'medium' | 'low';
    guessed?: string[];
    citations?: { url: string; title?: string }[];
    score?: number;
  };
  type ReceiptLineItem = {
    rawText: string;
    productName?: string;
    sku?: string;
    qty?: number;
    unit?: string;
    vendor?: string;
  };
  type Proposal = {
    lineIndex: number;
    line: ReceiptLineItem;
    candidate: Candidate | null;
    accepted: boolean;
  };

  let { onClose }: { onClose: () => void } = $props();

  let file = $state<File | null>(null);
  let fileName = $state('');
  let fileMediaType = $state<'image/jpeg' | 'image/png' | 'application/pdf' | ''>('');
  let scanBusy = $state(false);
  let scanStatus = $state<string | null>(null);
  let scanError = $state<string | null>(null);
  let proposals = $state<Proposal[]>([]);
  let vendor = $state<string | null>(null);
  let commitBusy = $state(false);
  let commitSummary = $state<string | null>(null);
  let commitErrors = $state<Array<{ lineIndex: number; message: string }>>([]);

  const acceptedCount = $derived(proposals.filter((p) => p.accepted && p.candidate?.candidate).length);

  function handleFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    if (
      f.type !== 'image/jpeg' &&
      f.type !== 'image/png' &&
      f.type !== 'application/pdf'
    ) {
      scanError = `Unsupported file type "${f.type}". Use JPEG, PNG, or PDF.`;
      return;
    }
    file = f;
    fileName = f.name;
    fileMediaType = f.type as typeof fileMediaType;
    scanError = null;
  }

  async function fileToBase64(f: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result ?? '');
        // Strip the "data:image/jpeg;base64," prefix.
        const idx = result.indexOf('base64,');
        resolve(idx >= 0 ? result.slice(idx + 7) : result);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(f);
    });
  }

  async function startScan() {
    if (!file || !fileMediaType) return;
    scanBusy = true;
    scanError = null;
    proposals = [];
    vendor = null;
    commitSummary = null;
    commitErrors = [];
    try {
      const base64 = await fileToBase64(file);
      const res = await fetch('/api/plugins/scan-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document: base64, mediaType: fileMediaType })
      });
      if (!res.ok || !res.body) {
        scanError = `HTTP ${res.status}`;
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const line = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const json = line.slice(6).trim();
          if (!json) continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(json);
          } catch {
            continue;
          }
          handleEvent(event);
        }
      }
    } catch (e) {
      scanError = e instanceof Error ? e.message : String(e);
    } finally {
      scanBusy = false;
      scanStatus = null;
    }
  }

  function handleEvent(event: Record<string, unknown>) {
    const phase = event.phase as string;
    if (phase === 'extracted') {
      const lines = (event.lines as ReceiptLineItem[]) ?? [];
      proposals = lines.map((line, i) => ({
        lineIndex: i,
        line,
        candidate: null,
        accepted: false
      }));
    } else if (phase === 'enriched') {
      const i = event.lineIndex as number;
      const candidate = (event.candidate as Candidate | null) ?? null;
      // Mark accepted by default when the candidate validates cleanly.
      const acceptedByDefault = !!(candidate?.candidate && candidate.validation.ok);
      proposals = proposals.map((p) =>
        p.lineIndex === i
          ? { ...p, candidate, accepted: acceptedByDefault }
          : p
      );
    } else if (phase === 'complete') {
      scanStatus = (event.message as string) ?? null;
    } else if (phase === 'error') {
      scanError = (event.message as string) ?? 'unknown error';
    } else if (typeof event.message === 'string') {
      scanStatus = event.message;
    }
  }

  function toggleAccept(i: number) {
    proposals = proposals.map((p) =>
      p.lineIndex === i ? { ...p, accepted: !p.accepted } : p
    );
  }

  async function commitAccepted() {
    const toCommit = proposals.filter((p) => p.accepted && p.candidate?.candidate);
    if (toCommit.length === 0) return;
    commitBusy = true;
    commitSummary = null;
    commitErrors = [];
    let savedCount = 0;
    for (const p of toCommit) {
      try {
        const res = await fetch('/api/plugins/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(p.candidate!.candidate)
        });
        const out = await res.json();
        if (!res.ok) {
          commitErrors = [
            ...commitErrors,
            { lineIndex: p.lineIndex, message: out.error ?? `HTTP ${res.status}` }
          ];
        } else {
          savedCount++;
        }
      } catch (e) {
        commitErrors = [
          ...commitErrors,
          { lineIndex: p.lineIndex, message: e instanceof Error ? e.message : String(e) }
        ];
      }
    }
    commitBusy = false;
    commitSummary = `Saved ${savedCount} of ${toCommit.length} accepted candidate${toCommit.length === 1 ? '' : 's'}.`;
    if (savedCount > 0) {
      await invalidateAll();
    }
  }

  function reset() {
    file = null;
    fileName = '';
    fileMediaType = '';
    proposals = [];
    scanError = null;
    scanStatus = null;
    commitSummary = null;
    commitErrors = [];
  }
</script>

<div
  class="receipt-backdrop"
  role="dialog"
  aria-modal="true"
  aria-labelledby="receipt-scan-title"
  onclick={(e) => {
    if (e.target === e.currentTarget && !scanBusy && !commitBusy) onClose();
  }}
  onkeydown={(e) => {
    if (e.key === 'Escape' && !scanBusy && !commitBusy) onClose();
  }}
  tabindex="-1"
>
  <div class="receipt-modal">
    <header>
      <h2 id="receipt-scan-title">Receipt / manifest scan</h2>
      <button class="close" onclick={onClose} aria-label="Close" disabled={scanBusy || commitBusy}>✕</button>
    </header>

    {#if proposals.length === 0 && !scanBusy}
      <div class="upload-area">
        <p class="lede">
          Upload a vendor receipt, invoice, packing list, or order confirmation. Claude extracts the
          line items and looks each one up online; you review and accept the ones you want to install
          as plugins.
        </p>
        <input
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          onchange={handleFile}
          aria-label="Receipt file"
        />
        {#if fileName}
          <p class="file-info">Selected: <strong>{fileName}</strong></p>
        {/if}
        {#if scanError}<p class="error">{scanError}</p>{/if}
        <div class="actions">
          <button class="primary" disabled={!file} onclick={startScan}>
            ✦ Scan with AI
          </button>
          <button class="link" onclick={onClose}>Cancel</button>
        </div>
      </div>
    {/if}

    {#if scanBusy}
      <div class="progress">
        <span class="spinner" aria-hidden="true"></span>
        <span>{scanStatus ?? 'Working…'}</span>
      </div>
      {#if proposals.length > 0}
        <ul class="proposals">
          {#each proposals as p (p.lineIndex)}
            <li>
              <div class="line-text">{p.line.productName ?? p.line.rawText}</div>
              <div class="line-status">
                {#if p.candidate?.candidate}
                  ✓ {p.candidate.candidate.displayName as string}
                {:else if p.candidate === null}
                  <span class="spinner small" aria-hidden="true"></span>
                {:else}
                  — no match
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}

    {#if !scanBusy && proposals.length > 0}
      <div class="review">
        {#if vendor}<p class="vendor">Vendor: <strong>{vendor}</strong></p>{/if}
        {#if scanError}<p class="error">{scanError}</p>{/if}
        <p class="muted">
          {acceptedCount} of {proposals.length} selected · uncheck rows you don't want to install.
        </p>
        <ul class="proposals review-list">
          {#each proposals as p (p.lineIndex)}
            {@const c = p.candidate}
            {@const cand = c?.candidate}
            {@const hasIssues = c && !c.validation.ok}
            <li class:has-candidate={!!cand} class:no-candidate={!cand}>
              <label class="row">
                <input
                  type="checkbox"
                  checked={p.accepted}
                  disabled={!cand || !!hasIssues}
                  onchange={() => toggleAccept(p.lineIndex)}
                />
                <div class="row-main">
                  <div class="row-name">
                    {#if cand}
                      <strong>{cand.displayName as string}</strong>
                      <span class="type-pill type-{cand.type as string}">{cand.type as string}</span>
                      {#if c?.confidence}<span class="conf conf-{c.confidence}">{c.confidence}</span>{/if}
                    {:else}
                      <em class="muted">No match for: {p.line.rawText}</em>
                    {/if}
                  </div>
                  <div class="row-raw">
                    <code>{p.line.rawText}</code>
                    {#if p.line.qty != null}<span class="qty">× {p.line.qty}{p.line.unit ? ' ' + p.line.unit : ''}</span>{/if}
                  </div>
                  {#if hasIssues}
                    <div class="issues">
                      {#each c.validation.bypassIssues as issue}
                        <span class="issue bypass">{issue.message}</span>
                      {/each}
                      {#each c.validation.schemaIssues as issue}
                        <span class="issue schema">{issue.path}: {issue.message}</span>
                      {/each}
                    </div>
                  {/if}
                </div>
              </label>
            </li>
          {/each}
        </ul>

        {#if commitSummary}
          <p class="success">{commitSummary}</p>
        {/if}
        {#if commitErrors.length > 0}
          <details class="error-details">
            <summary>{commitErrors.length} failed</summary>
            <ul>
              {#each commitErrors as e}
                <li>Line {e.lineIndex + 1}: {e.message}</li>
              {/each}
            </ul>
          </details>
        {/if}

        <div class="actions">
          <button class="primary" disabled={commitBusy || acceptedCount === 0} onclick={commitAccepted}>
            {commitBusy ? 'Saving…' : `Save ${acceptedCount} plugin${acceptedCount === 1 ? '' : 's'}`}
          </button>
          <button class="secondary" disabled={commitBusy} onclick={reset}>Start over</button>
          <button class="link" disabled={commitBusy} onclick={onClose}>Done</button>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .receipt-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    z-index: 300;
    padding: 2rem 1rem;
    overflow-y: auto;
  }
  .receipt-modal {
    background: white;
    border-radius: 8px;
    width: 100%;
    max-width: 760px;
    padding: 1.25rem;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }
  h2 {
    margin: 0;
    font-size: 1.05rem;
    color: #1f5e3a;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .close {
    background: none;
    border: 0;
    font-size: 1.1rem;
    cursor: pointer;
    color: #555;
    width: 36px;
    height: 36px;
    border-radius: 50%;
  }
  .close:hover:not(:disabled) {
    background: #f0f0f0;
  }
  .lede {
    color: #555;
    margin: 0 0 1rem;
    font-size: 0.9rem;
    line-height: 1.5;
  }
  .upload-area input[type='file'] {
    display: block;
    padding: 0.5rem;
    border: 2px dashed #d0d7d0;
    border-radius: 6px;
    background: #fafdfb;
    width: 100%;
    box-sizing: border-box;
    font: inherit;
    font-size: 0.9rem;
    margin-bottom: 0.75rem;
  }
  .file-info {
    color: #555;
    font-size: 0.85rem;
    margin: 0.4rem 0;
  }
  .actions {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    margin-top: 1rem;
  }
  .primary {
    background: linear-gradient(135deg, #6d28d9 0%, #2563eb 100%);
    color: white;
    border: 0;
    padding: 0.55rem 1.1rem;
    border-radius: 4px;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    min-height: 40px;
  }
  .primary:disabled {
    background: #aaa;
    cursor: not-allowed;
  }
  .secondary {
    background: white;
    border: 2px solid #d0d7d0;
    padding: 0.45rem 0.9rem;
    border-radius: 4px;
    font: inherit;
    cursor: pointer;
    color: #444;
    min-height: 40px;
  }
  .link {
    background: none;
    border: 0;
    color: #1f5e3a;
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
  }
  .progress {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 0;
    color: #1f5e3a;
    font-style: italic;
  }
  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(31, 94, 58, 0.25);
    border-top-color: #1f5e3a;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex: 0 0 auto;
  }
  .spinner.small {
    width: 11px;
    height: 11px;
    border-width: 2px;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .proposals {
    list-style: none;
    padding: 0;
    margin: 0;
    max-height: 50vh;
    overflow-y: auto;
    border-top: 1px solid #eef0ee;
  }
  .proposals li {
    padding: 0.45rem 0;
    border-bottom: 1px solid #eef0ee;
    font-size: 0.88rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
  }
  .line-text {
    flex: 1;
    color: #333;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .line-status {
    color: #1f5e3a;
    font-size: 0.85rem;
    flex: 0 0 auto;
  }
  .review-list li {
    display: block;
  }
  .review-list .row {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    padding: 0.55rem 0;
    cursor: pointer;
  }
  .review-list input[type='checkbox'] {
    width: 18px;
    height: 18px;
    margin-top: 0.15rem;
    cursor: pointer;
    flex: 0 0 auto;
  }
  .row-main {
    flex: 1;
    min-width: 0;
  }
  .row-name {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
    font-size: 0.95rem;
  }
  .type-pill {
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    color: white;
    letter-spacing: 0.5px;
  }
  .type-crop { background: #1f5e3a; }
  .type-herbicide { background: #b00020; }
  .type-insecticide { background: #b35900; }
  .type-fungicide { background: #4a2c83; }
  .type-fertilizer { background: #1c5fa6; }
  .type-companion { background: #6b3fa0; }
  .conf {
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .conf-high { background: #d8f0d8; color: #1f5e3a; }
  .conf-medium { background: #fff4d8; color: #8a5a00; }
  .conf-low { background: #fce8e8; color: #b00020; }
  .row-raw {
    color: #777;
    font-size: 0.78rem;
    margin-top: 0.15rem;
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .row-raw code {
    background: #f5f5f5;
    padding: 0.05rem 0.35rem;
    border-radius: 3px;
  }
  .qty {
    color: #555;
    font-weight: 600;
  }
  .issues {
    margin-top: 0.3rem;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .issue {
    font-size: 0.78rem;
    padding: 0.15rem 0.4rem;
    border-radius: 3px;
  }
  .issue.bypass { background: #fce8e8; color: #b00020; }
  .issue.schema { background: #fff4d8; color: #8a5a00; }
  .no-candidate {
    opacity: 0.6;
  }
  .review .muted {
    color: #777;
    font-size: 0.85rem;
    margin: 0.5rem 0;
  }
  .vendor {
    color: #555;
    font-size: 0.85rem;
    margin: 0 0 0.5rem;
  }
  .error {
    color: #b00020;
    background: #fce8e8;
    padding: 0.4rem 0.6rem;
    border-radius: 3px;
    font-size: 0.85rem;
    margin: 0.5rem 0;
  }
  .success {
    color: #1f5e3a;
    background: #e8f5e8;
    padding: 0.4rem 0.6rem;
    border-radius: 3px;
    font-size: 0.85rem;
    margin: 0.5rem 0;
  }
  .error-details {
    margin: 0.5rem 0;
    font-size: 0.85rem;
  }
  .error-details summary {
    cursor: pointer;
    color: #b00020;
  }
</style>
