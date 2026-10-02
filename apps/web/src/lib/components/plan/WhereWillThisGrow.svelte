<script lang="ts">
  import { Map as MapIcon, Ruler, PencilLine, Sprout, Sparkle } from 'lucide-svelte';
  import type { SetupArea } from '$lib/setup/types';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  interface Props {
    /** Helpers and inspectors get a read-only note: no choices, no wizard. */
    variant?: 'owner' | 'helper';
    onName?: () => void;
    /** Opens the planning wizard (owner only). */
    onStartWizard?: () => void;
    /** Areas already on the farm with nothing inside yet. */
    emptyAreas?: SetupArea[];
    /** The Area the person came from, when it has nothing inside yet. */
    focusArea?: SetupArea | null;
    onWhole?: (area: SetupArea) => void;
    busy?: boolean;
    error?: string | null;
  }

  const {
    variant = 'owner',
    onName,
    onStartWizard,
    emptyAreas = [],
    focusArea = null,
    onWhole,
    busy = false,
    error = null
  }: Props = $props();
  const tr = $derived(createT(page.data?.locale));

  const wholeChoices = $derived(focusArea ? [focusArea] : emptyAreas);

  function listNames(names: string[]): string {
    if (names.length <= 1) return names[0] ?? '';
    return tr('planui.where.listAnd', {
      head: names.slice(0, -1).join(', '),
      last: names[names.length - 1]
    });
  }
</script>

{#if variant === 'helper'}
  <section
    class="where"
    aria-labelledby="where-title"
    data-testid="plan-where"
    data-variant="helper"
    role="status"
  >
    <p class="kicker">{tr('planui.where.kicker')}</p>
    <h2 id="where-title" class="serif">{tr('plan.page.gate.title')}</h2>
    <p class="lede helper">{tr('plan.page.gate.body')}</p>
  </section>
{:else}
  <section
    class="where"
    aria-labelledby="where-title"
    data-testid="plan-where"
    data-variant="owner"
  >
    <p class="kicker">{tr('planui.where.kicker')}</p>
    {#if focusArea}
      <h2 id="where-title" class="serif">{tr('planui.where.titleIn', { name: focusArea.name })}</h2>
      <p class="lede">
        {tr('planui.where.ledeIn', { name: focusArea.name })}
      </p>
    {:else}
      <h2 id="where-title" class="serif">{tr('planui.where.title')}</h2>
      {#if emptyAreas.length > 0}
        <p class="lede">
          {tr('planui.where.ledeHave', { names: listNames(emptyAreas.map((a) => a.name)) })}
        </p>
      {:else}
        <p class="lede">
          {tr('planui.where.ledeNone')}
        </p>
      {/if}
    {/if}
    {#if onWhole && wholeChoices.length > 0}
      <ul class="choices whole">
        {#each wholeChoices as a (a.id)}
          <li>
            <button type="button" class="choice primary" disabled={busy} onclick={() => onWhole(a)}>
              <Sprout size={22} strokeWidth={1.75} aria-hidden="true" />
              <span class="choice-title">{tr('planui.where.wholeTitle', { name: a.name })}</span>
              <span class="choice-hint">{tr('planui.where.wholeHint')}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <ul class="choices">
      <li>
        <a class="choice" href="/plan/farm">
          <MapIcon size={22} strokeWidth={1.75} aria-hidden="true" />
          <span class="choice-title">{tr('planui.where.drawTitle')}</span>
          <span class="choice-hint">{tr('planui.where.drawHint')}</span>
        </a>
      </li>
      <li>
        <a class="choice" href="/plan/farm?mode=sketch">
          <Ruler size={22} strokeWidth={1.75} aria-hidden="true" />
          <span class="choice-title">{tr('planui.where.sketchTitle')}</span>
          <span class="choice-hint">{tr('planui.where.sketchHint')}</span>
        </a>
      </li>
      <li>
        <button type="button" class="choice" onclick={() => onName?.()}>
          <PencilLine size={22} strokeWidth={1.75} aria-hidden="true" />
          <span class="choice-title"
            >{focusArea
              ? tr('planui.where.nameBedIn', { name: focusArea.name })
              : tr('planui.where.justName')}</span
          >
          <span class="choice-hint">{tr('planui.where.nameHint')}</span>
        </button>
      </li>
    </ul>
    {#if onStartWizard}
      <div class="wizard-row">
        <button type="button" class="wizard" onclick={onStartWizard}>
          <Sparkle size={16} strokeWidth={1.75} aria-hidden="true" />
          {tr('planui.where.startWizard')}
        </button>
      </div>
    {/if}
  </section>
{/if}

<style>
  .where {
    margin: var(--space-4) 0;
    padding: var(--card-padding-loose);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    background: var(--color-paper);
  }
  .kicker {
    margin: 0 0 2px;
    font-size: var(--font-size-kicker);
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-ink-muted);
  }
  h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-screen-title);
    color: var(--color-forest-deep);
  }
  .lede {
    margin: 0 0 var(--space-4);
    color: var(--color-ink-soft);
    max-width: 60ch;
  }
  .choices {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: var(--space-3);
  }
  .choice {
    width: 100%;
    height: 100%;
    min-height: 96px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
    padding: var(--space-4);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    background: var(--color-cream);
    color: var(--color-forest-deep);
    font: inherit;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
  }
  .whole {
    margin-bottom: var(--space-3);
  }
  .choice.primary {
    border-color: var(--color-forest);
    background: var(--pill-forest-bg);
  }
  .choice:disabled {
    opacity: 0.6;
    cursor: wait;
  }
  .error {
    color: var(--color-rust);
    margin: 0 0 var(--space-3);
  }
  .choice:hover {
    border-color: var(--color-forest);
    background: var(--pill-forest-bg);
  }
  .choice-title {
    font-weight: 600;
    font-size: var(--font-size-body-lg);
  }
  .lede.helper {
    margin-bottom: 0;
  }
  .wizard-row {
    margin-top: var(--space-4);
  }
  .wizard {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    min-height: 48px;
    max-width: 100%;
    box-sizing: border-box;
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-forest);
    border-radius: var(--radius-card);
    background: transparent;
    color: var(--color-forest-deep);
    font: inherit;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }
  .wizard:hover {
    background: var(--pill-forest-bg);
  }
  .choice-hint {
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
  }
</style>
