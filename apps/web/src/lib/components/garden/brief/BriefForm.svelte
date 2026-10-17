<script lang="ts">
  import { page } from '$app/state';
  import { X } from 'lucide-svelte';
  import { createT, type MessageKey } from '$lib/i18n';
  import { cropDisplayName } from '$lib/i18n/cropName';
  import { BRIEF_STORAGE_GOALS, type BriefStorageGoal } from '$lib/garden/preserving';
  import {
    BRIEF_CUISINES,
    BRIEF_SUN,
    BRIEF_TIME,
    BRIEF_WHERE,
    BRIEF_WHY,
    MAX_TARGET_CHARS,
    type BriefAnswers,
    type BriefQuestion
  } from '$lib/garden/brief/schema';

  interface HerbOption {
    pluginId: string;
    displayName: string;
  }

  interface Props {
    answers: BriefAnswers;
    herbs: readonly HerbOption[];
    disabled?: boolean;
  }

  // eslint-disable-next-line prefer-const -- `answers` is $bindable and reassigned; the rest share the one $props() call
  let { answers = $bindable(), herbs, disabled = false }: Props = $props();

  const tr = $derived(createT(page.data?.locale));
  const locale = $derived(page.data?.locale ?? null);

  type ListQuestion = 'why' | 'cuisines' | 'where';
  type SingleQuestion = 'time' | 'sun';
  type HerbQuestion = 'wanted' | 'avoid';

  const LIST_OPTIONS: Record<ListQuestion, readonly string[]> = {
    why: BRIEF_WHY,
    cuisines: BRIEF_CUISINES,
    where: BRIEF_WHERE
  };
  const SINGLE_OPTIONS: Record<SingleQuestion, readonly string[]> = {
    time: BRIEF_TIME,
    sun: BRIEF_SUN
  };

  function notSure(q: BriefQuestion): boolean {
    return answers[q]?.notSure === true;
  }

  function setNotSure(q: BriefQuestion, on: boolean) {
    const empty = q === 'time' || q === 'sun' ? null : [];
    answers = { ...answers, [q]: { value: empty, notSure: on, provenance: 'manual' } };
  }

  function listValue(q: ListQuestion | HerbQuestion): string[] {
    return (answers[q]?.value as string[] | undefined) ?? [];
  }

  function toggleList(q: ListQuestion | HerbQuestion, v: string) {
    const now = listValue(q);
    const next = now.includes(v) ? now.filter((x) => x !== v) : [...now, v];
    answers = { ...answers, [q]: { value: next, notSure: false, provenance: 'manual' } };
  }

  function setSingle(q: SingleQuestion, v: string) {
    answers = { ...answers, [q]: { value: v, notSure: false, provenance: 'manual' } };
  }

  const storage = $derived(answers.storage?.value ?? []);

  function hasGoal(g: BriefStorageGoal): boolean {
    return storage.some((s) => s.goal === g);
  }

  function toggleGoal(g: BriefStorageGoal) {
    const next = hasGoal(g) ? storage.filter((s) => s.goal !== g) : [...storage, { goal: g }];
    answers = { ...answers, storage: { value: next, notSure: false, provenance: 'manual' } };
  }

  function setTarget(g: BriefStorageGoal, target: string) {
    const next = storage.map((s) =>
      s.goal === g ? (target.trim() ? { goal: g, target } : { goal: g }) : s
    );
    answers = { ...answers, storage: { value: next, notSure: false, provenance: 'manual' } };
  }

  const queries = $state<Record<HerbQuestion, string>>({ wanted: '', avoid: '' });

  function nameOf(id: string): string {
    const h = herbs.find((x) => x.pluginId === id);
    return h ? cropDisplayName(h.pluginId, h.displayName, locale) : id;
  }

  function matches(q: HerbQuestion): HerbOption[] {
    const text = queries[q].trim().toLowerCase();
    if (!text) return [];
    const taken = new Set([...listValue('wanted'), ...listValue('avoid')]);
    return herbs
      .filter((h) => !taken.has(h.pluginId))
      .filter(
        (h) =>
          h.displayName.toLowerCase().includes(text) ||
          cropDisplayName(h.pluginId, h.displayName, locale).toLowerCase().includes(text)
      )
      .slice(0, 8);
  }

  function addHerb(q: HerbQuestion, id: string) {
    toggleList(q, id);
    queries[q] = '';
  }
</script>

<div class="brief-form" data-testid="brief-form">
  {#each ['why', 'cuisines'] as const as q (q)}
    <fieldset class="q" id="q-{q}" {disabled}>
      <legend class="serif">{tr(`herbsa.q.${q}.title` as MessageKey)}</legend>
      <div class="chips">
        {#each LIST_OPTIONS[q] as opt (opt)}
          <label class="chip" class:on={listValue(q).includes(opt)}>
            <input
              type="checkbox"
              checked={listValue(q).includes(opt)}
              disabled={disabled || notSure(q)}
              onchange={() => toggleList(q, opt)}
            />
            {tr(`herbsa.q.${q}.opt.${opt}` as MessageKey)}
          </label>
        {/each}
      </div>
      <label class="unsure">
        <input
          type="checkbox"
          checked={notSure(q)}
          onchange={(e) => setNotSure(q, e.currentTarget.checked)}
        />
        {tr('herbsa.q.notSure')}
      </label>
    </fieldset>
  {/each}

  {#each ['wanted', 'avoid'] as const as q (q)}
    <fieldset class="q" id="q-{q}" {disabled}>
      <legend class="serif">{tr(`herbsa.q.${q}.title` as MessageKey)}</legend>
      {#if listValue(q).length > 0}
        <ul class="picked">
          {#each listValue(q) as id (id)}
            <li>
              <span>{nameOf(id)}</span>
              <button
                type="button"
                class="remove"
                {disabled}
                aria-label={tr('herbsa.q.removeHerb', { name: nameOf(id) })}
                onclick={() => toggleList(q, id)}><X size={18} aria-hidden="true" /></button
              >
            </li>
          {/each}
        </ul>
      {/if}
      <label class="search-label" for="herb-{q}">{tr('herbsa.q.searchHerbs')}</label>
      <input
        id="herb-{q}"
        class="search"
        type="search"
        autocomplete="off"
        bind:value={queries[q]}
        disabled={disabled || notSure(q)}
        placeholder={tr('herbsa.q.searchPlaceholder')}
      />
      {#if queries[q].trim()}
        {@const found = matches(q)}
        {#if found.length === 0}
          <p class="empty">{tr('herbsa.q.noHerbMatch')}</p>
        {:else}
          <ul class="matches">
            {#each found as h (h.pluginId)}
              <li>
                <button type="button" class="match" onclick={() => addHerb(q, h.pluginId)}>
                  {tr('herbsa.q.addHerb', { name: nameOf(h.pluginId) })}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
      <label class="unsure">
        <input
          type="checkbox"
          checked={notSure(q)}
          onchange={(e) => setNotSure(q, e.currentTarget.checked)}
        />
        {tr('herbsa.q.notSure')}
      </label>
    </fieldset>
  {/each}

  {#each ['time', 'sun'] as const as q (q)}
    <fieldset class="q" id="q-{q}" {disabled}>
      <legend class="serif">{tr(`herbsa.q.${q}.title` as MessageKey)}</legend>
      <div class="chips">
        {#each SINGLE_OPTIONS[q] as opt (opt)}
          <label class="chip" class:on={answers[q]?.value === opt}>
            <input
              type="radio"
              name="brief-{q}"
              checked={answers[q]?.value === opt}
              disabled={disabled || notSure(q)}
              onchange={() => setSingle(q, opt)}
            />
            {tr(`herbsa.q.${q}.opt.${opt}` as MessageKey)}
          </label>
        {/each}
      </div>
      <label class="unsure">
        <input
          type="checkbox"
          checked={notSure(q)}
          onchange={(e) => setNotSure(q, e.currentTarget.checked)}
        />
        {tr('herbsa.q.notSure')}
      </label>
    </fieldset>
  {/each}

  <fieldset class="q" id="q-where" {disabled}>
    <legend class="serif">{tr('herbsa.q.where.title')}</legend>
    <div class="chips">
      {#each LIST_OPTIONS.where as opt (opt)}
        <label class="chip" class:on={listValue('where').includes(opt)}>
          <input
            type="checkbox"
            checked={listValue('where').includes(opt)}
            disabled={disabled || notSure('where')}
            onchange={() => toggleList('where', opt)}
          />
          {tr(`herbsa.q.where.opt.${opt}` as MessageKey)}
        </label>
      {/each}
    </div>
    <label class="unsure">
      <input
        type="checkbox"
        checked={notSure('where')}
        onchange={(e) => setNotSure('where', e.currentTarget.checked)}
      />
      {tr('herbsa.q.notSure')}
    </label>
  </fieldset>

  <fieldset class="q" id="q-storage" {disabled}>
    <legend class="serif">{tr('herbsa.q.storage.title')}</legend>
    <p class="help">{tr('herbsa.q.storage.help')}</p>
    <ul class="goals">
      {#each BRIEF_STORAGE_GOALS as g (g)}
        <li>
          <label class="chip" class:on={hasGoal(g)}>
            <input
              type="checkbox"
              checked={hasGoal(g)}
              disabled={disabled || notSure('storage')}
              onchange={() => toggleGoal(g)}
            />
            {tr(`herbsa.goal.${g}` as MessageKey)}
          </label>
          {#if hasGoal(g)}
            <label class="target">
              <span>{tr('herbsa.q.storage.target')}</span>
              <input
                type="text"
                maxlength={MAX_TARGET_CHARS}
                value={storage.find((s) => s.goal === g)?.target ?? ''}
                placeholder={tr(`herbsa.goal.${g}.example` as MessageKey)}
                {disabled}
                onchange={(e) => setTarget(g, e.currentTarget.value)}
              />
            </label>
          {/if}
        </li>
      {/each}
    </ul>
    <label class="unsure">
      <input
        type="checkbox"
        checked={notSure('storage')}
        onchange={(e) => setNotSure('storage', e.currentTarget.checked)}
      />
      {tr('herbsa.q.notSure')}
    </label>
  </fieldset>
</div>

<style>
  .brief-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }
  .q {
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-card, 12px);
    padding: var(--space-2) var(--space-3) var(--space-3);
    margin: 0;
    min-width: 0;
  }
  legend {
    font-size: 1.05rem;
    font-weight: 600;
    padding: 0 var(--space-1);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .chip,
  .unsure {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 48px;
    padding: 0 var(--space-3);
    border: 1px solid var(--color-rule);
    border-radius: 24px;
    background: var(--color-paper, #fff);
    cursor: pointer;
  }
  .chip.on {
    border-color: var(--color-forest);
    background: var(--color-forest-tint, #e8f0e9);
    font-weight: 600;
  }
  .unsure {
    margin-top: var(--space-2);
    border-style: dashed;
    color: var(--color-ink-soft);
  }
  .picked,
  .matches,
  .goals {
    list-style: none;
    margin: 0 0 var(--space-2);
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .goals {
    flex-direction: column;
  }
  .picked li {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding-left: var(--space-3);
    border: 1px solid var(--color-forest);
    border-radius: 24px;
  }
  .remove,
  .match {
    min-height: 48px;
    min-width: 48px;
    border: 0;
    background: transparent;
    color: var(--color-forest);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .match {
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-input);
    padding: 0 var(--space-3);
  }
  .search-label,
  .target span {
    display: block;
    font-size: 0.9rem;
    color: var(--color-ink-soft);
    margin-bottom: 4px;
  }
  .search,
  .target input {
    width: 100%;
    max-width: 28rem;
    min-height: 48px;
    box-sizing: border-box;
    padding: 0 var(--space-2);
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-input);
    font: inherit;
  }
  .target {
    display: block;
    margin: var(--space-1) 0 0 var(--space-3);
  }
  .help,
  .empty {
    margin: 0 0 var(--space-2);
    color: var(--color-ink-soft);
    font-size: 0.9rem;
  }
</style>
