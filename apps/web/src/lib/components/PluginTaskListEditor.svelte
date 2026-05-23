<script lang="ts">
  /**
   * Phase 21b follow-up — task-list editor for the Plugin Authoring
   * Wizard. Drives one of the three crop-task arrays in plugin JSON:
   * `preTasks`, `postTasks`, `seasonalTasks`. The shape of each row
   * differs slightly (pre/post share the offset-anchored shape;
   * seasonal carries `dayOfYear` + `daysAfterPlanting`), so the
   * component takes a `variant` prop that toggles which timing
   * inputs render.
   *
   * Category is a dropdown (not free text) per the user spec
   * ("manual editing uses appropriated drop down boxes"). The
   * Zod schemas at registration enforce the same enum, so the
   * dropdown's options stay in lockstep with what the kernel
   * actually accepts.
   */
  import HelpIcon from '$lib/components/HelpIcon.svelte';
  import {
    TASK_CATEGORY_VALUES,
    glyphForTaskCategory,
    labelForTaskCategory,
    type TaskCategory
  } from '$lib/plan/taskCategory';

  function slugify(s: string): string {
    return s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
  }

  /** Auto-derive a unique kebab-case key from a row's title, ensuring it
   *  doesn't collide with sibling rows. */
  function resolveKey(row: PluginTaskRow, index: number, rows: ReadonlyArray<PluginTaskRow>): string {
    if (row.key && row.key.trim()) return row.key.trim();
    const base = slugify(row.title);
    if (!base) return '';
    const siblings = rows
      .filter((_, i) => i !== index)
      .map((r) => (r.key && r.key.trim()) || slugify(r.title))
      .filter(Boolean);
    if (!siblings.includes(base)) return base;
    for (let n = 2; n < 999; n++) {
      const candidate = `${base}-${n}`.slice(0, 64);
      if (!siblings.includes(candidate)) return candidate;
    }
    return base;
  }

  /** Shape covers all three variants. Empty fields are omitted at payload-build time. */
  export interface PluginTaskRow {
    key: string;
    title: string;
    body: string;
    category: TaskCategory | '';
    /** preTasks / postTasks anchors. */
    daysBeforePlant?: number;
    daysBeforeFirstHarvest?: number;
    daysAfterPlant?: number;
    daysAfterHarvest?: number;
    phaseKey?: string;
    daysBeforePhase?: number;
    daysAfterPhase?: number;
    /** seasonalTasks anchors. */
    kind?: 'spray' | 'cultural' | 'pruning' | 'thinning' | 'fertilize' | 'irrigate' | 'scout' | 'harvest';
    dayOfYear?: number;
    daysAfterPlanting?: number;
    windowDays?: number;
  }

  interface Props {
    /** Section label (rendered as `<h3>` above the rows). */
    label: string;
    /** One-line operator-facing description below the label. */
    helpText: string;
    /** Which timing inputs to render. */
    variant: 'preTasks' | 'postTasks' | 'seasonalTasks';
    /** Two-way bound array of rows. */
    rows: PluginTaskRow[];
  }

  const props: Props = $props();

  const SEASONAL_KINDS = [
    'spray',
    'cultural',
    'pruning',
    'thinning',
    'fertilize',
    'irrigate',
    'scout',
    'harvest'
  ] as const;

  function emptyRow(): PluginTaskRow {
    return {
      key: '',
      title: '',
      body: '',
      category: '',
      ...(props.variant === 'seasonalTasks' ? { kind: 'cultural', windowDays: 7 } : {})
    };
  }

  function addRow() {
    props.rows.push(emptyRow());
  }

  function removeRow(i: number) {
    props.rows.splice(i, 1);
  }
</script>

<section class="plugin-tasks-editor">
  <header class="head">
    <h3>{props.label}</h3>
    <p class="help">{props.helpText}</p>
  </header>

  {#if props.rows.length === 0}
    <p class="empty">No {props.variant} defined yet.</p>
  {:else}
    {#each props.rows as row, i (i)}
      <div class="row card-tight">
        <div class="row-top">
          <label class="field flex-grow">
            <span class="label-text">Title</span>
            <input
              type="text"
              bind:value={row.title}
              oninput={() => { row.key = resolveKey(row, i, props.rows); }}
              placeholder="e.g. Test germination"
            />
          </label>
          <button
            type="button"
            class="remove-btn"
            onclick={() => removeRow(i)}
            aria-label="Remove task"
          >×</button>
        </div>

        <div class="row-mid">
          <label class="field">
            <span class="label-text-row">
              <span class="label-text">Category (pip glyph)</span>
              <HelpIcon
                label="What is task category?"
                text="Glyph displayed on the Plan swim-lane: ◆ till, ✚ fertilize, ✦ spray, ◉ scout, ⚑ companion-check. Drives the visual lane on /plan."
              />
            </span>
            <select bind:value={row.category}>
              <option value="">— Select —</option>
              {#each TASK_CATEGORY_VALUES as v (v)}
                <option value={v}>{glyphForTaskCategory(v)} {labelForTaskCategory(v)}</option>
              {/each}
            </select>
          </label>

          {#if props.variant === 'preTasks'}
            <label class="field">
              <span class="label-text">Days before plant</span>
              <input type="number" min="0" bind:value={row.daysBeforePlant} />
            </label>
            <label class="field">
              <span class="label-text">Days before first harvest</span>
              <input type="number" min="0" bind:value={row.daysBeforeFirstHarvest} />
            </label>
          {:else if props.variant === 'postTasks'}
            <label class="field">
              <span class="label-text">Days after plant</span>
              <input type="number" min="0" bind:value={row.daysAfterPlant} />
            </label>
            <label class="field">
              <span class="label-text">Days after harvest</span>
              <input type="number" min="0" bind:value={row.daysAfterHarvest} />
            </label>
          {:else}
            <label class="field">
              <span class="label-text">Kind (engine routing)</span>
              <select bind:value={row.kind}>
                {#each SEASONAL_KINDS as k (k)}
                  <option value={k}>{k}</option>
                {/each}
              </select>
            </label>
            <label class="field">
              <span class="label-text">Day of year (1–366)</span>
              <input type="number" min="1" max="366" bind:value={row.dayOfYear} />
            </label>
            <label class="field">
              <span class="label-text">Days after planting</span>
              <input type="number" min="0" max="3650" bind:value={row.daysAfterPlanting} />
            </label>
            <label class="field">
              <span class="label-text">Window (days)</span>
              <input type="number" min="1" max="120" bind:value={row.windowDays} />
            </label>
          {/if}
        </div>

        <label class="field full">
          <span class="label-text">Body (optional operator note)</span>
          <textarea rows="2" bind:value={row.body}></textarea>
        </label>
      </div>
    {/each}
  {/if}

  <button type="button" class="add-btn" onclick={addRow}>+ Add task</button>
</section>

<style>
  .plugin-tasks-editor {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 0.5rem;
    padding: 0.85rem 1rem;
    margin-top: 1rem;
  }
  .head { margin-bottom: 0.5rem; }
  h3 {
    margin: 0;
    font-size: 0.95rem;
    color: #1f5e3a;
    font-weight: 700;
  }
  .help {
    margin: 0.15rem 0 0;
    font-size: 0.8rem;
    color: #475569;
  }
  .empty {
    margin: 0.4rem 0;
    font-size: 0.85rem;
    color: #64748b;
    font-style: italic;
  }
  .card-tight {
    background: #fff;
    border: 1px solid #cbd5e1;
    border-radius: 0.4rem;
    padding: 0.65rem;
    margin: 0.55rem 0;
    display: grid;
    gap: 0.5rem;
  }
  .row-top { display: flex; align-items: end; gap: 0.5rem; }
  .row-mid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 0.5rem;
  }
  .field { display: grid; gap: 0.2rem; }
  .field.flex-grow { flex: 1; }
  .field.full { display: grid; gap: 0.2rem; }
  .label-text {
    font-size: 0.74rem;
    color: #475569;
    font-weight: 500;
  }
  .label-text-row {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  input[type='text'],
  input[type='number'],
  select,
  textarea {
    padding: 0.4rem 0.5rem;
    border: 1px solid #cbd5e1;
    border-radius: 0.3rem;
    font-size: 0.88rem;
    min-height: 36px;
    background: #fff;
    font-family: inherit;
  }
  textarea { font-family: monospace; resize: vertical; min-height: auto; }
  .remove-btn {
    width: 36px;
    height: 36px;
    border: 1px solid #fecaca;
    background: #fff;
    color: #b91c1c;
    border-radius: 0.3rem;
    cursor: pointer;
    font-size: 1.1rem;
    line-height: 1;
  }
  .remove-btn:hover { background: #fef2f2; }
  .add-btn {
    padding: 0.5rem 0.85rem;
    border: 1px dashed #94a3b8;
    background: #fff;
    color: #1f5e3a;
    border-radius: 0.3rem;
    cursor: pointer;
    font-weight: 600;
    font-size: 0.85rem;
    min-height: 36px;
  }
  .add-btn:hover { background: #f0f9ff; border-color: #1f5e3a; }
</style>
