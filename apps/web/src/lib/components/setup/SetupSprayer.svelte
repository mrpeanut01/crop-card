<script lang="ts">
  import SetupCalibration from './SetupCalibration.svelte';
  import { saveSprayerFromTile } from '$lib/setup/sprayer';
  import type {
    SetupCalibrationResult,
    SetupSprayerResult,
    SprayerTemplateTile
  } from '$lib/setup/types';

  interface Props {
    templates: SprayerTemplateTile[];
    canEdit: boolean;
    onDone: (result: SetupSprayerResult) => void;
  }

  const { templates, canEdit, onDone }: Props = $props();
  const uid = $props.id();

  let name = $state('');
  let savingId = $state<string | null>(null);
  let error = $state<string | null>(null);
  let created = $state<SetupSprayerResult | null>(null);

  async function pick(tile: SprayerTemplateTile) {
    if (savingId) return;
    error = null;
    savingId = tile.templateId;
    try {
      const out = await saveSprayerFromTile(tile, name);
      if (!out.ok) {
        error = out.error;
        return;
      }
      created = out.result;
    } catch {
      error = "We couldn't reach CropCard. Check your signal and try again.";
    } finally {
      savingId = null;
    }
  }

  function calibrated(r: SetupCalibrationResult) {
    if (!created) return;
    onDone({
      ...created,
      calibratedGpa: r.status === 'applied' ? r.calibratedGpa : null
    });
  }
</script>

{#if !canEdit}
  <p class="ask-owner" role="note">
    Ask the owner to add a sprayer. Once it's on the farm it shows up here.
  </p>
{:else if created}
  <div class="added" role="status">
    <strong>{created.label}</strong> is on the farm. It needs calibrating before CropCard can work out
    a rate for it.
  </div>
  <SetupCalibration
    sprayer={{ id: created.sprayerId, label: created.label, calibratedGpa: null }}
    canSave
    onDone={calibrated}
  />
  <button type="button" class="ghost" onclick={() => created && onDone(created)}>
    Calibrate later
  </button>
{:else}
  <p class="lede">Tap the one closest to yours. You can rename it or change the details later.</p>
  <label for="{uid}-name">Name it <span class="optional">(optional)</span></label>
  <input
    id="{uid}-name"
    type="text"
    maxlength="120"
    autocomplete="off"
    placeholder="Old blue rig"
    bind:value={name}
  />
  <ul class="tiles" aria-label="Sprayer types">
    {#each templates as t (t.templateId)}
      <li>
        <button
          type="button"
          class="tile"
          onclick={() => pick(t)}
          disabled={savingId !== null}
          aria-busy={savingId === t.templateId || undefined}
          data-template={t.templateId}
          data-autofocus={t === templates[0] ? true : undefined}
        >
          <span class="tile-kicker">{t.category}</span>
          <span class="tile-title serif">{t.tankGal != null ? `${t.tankGal} gal` : t.label}</span>
          <span class="tile-desc">{savingId === t.templateId ? 'Adding…' : t.label}</span>
        </button>
      </li>
    {/each}
  </ul>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <p class="help">
    Something else? <a href="/inventory/sprayer/add">Describe it in full on the Inventory page</a>.
  </p>
{/if}

<style>
  .lede {
    margin: 0 0 var(--space-3);
    color: var(--color-ink-soft);
  }
  label {
    display: block;
    font-weight: 600;
    margin-bottom: var(--space-1);
  }
  .optional {
    font-weight: 400;
    color: var(--color-ink-muted);
  }
  input[type='text'] {
    width: 100%;
    box-sizing: border-box;
    min-height: 48px;
    padding: 0 var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    background: var(--color-paper);
    font: inherit;
    font-size: 16px;
    margin-bottom: var(--space-3);
  }
  .tiles {
    list-style: none;
    margin: 0 0 var(--space-3);
    padding: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
  }
  .tile {
    width: 100%;
    min-height: 96px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    background: var(--color-paper);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .tile:hover:not(:disabled) {
    border-color: var(--color-forest);
    background: var(--pill-forest-bg);
  }
  .tile:disabled {
    opacity: 0.6;
    cursor: progress;
  }
  .tile-kicker {
    font-size: var(--font-size-kicker);
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-ink-muted);
  }
  .tile-title {
    font-size: var(--font-size-card-title);
    color: var(--color-forest-deep);
  }
  .tile-desc {
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
  }
  .added {
    margin: 0 0 var(--space-4);
    padding: var(--space-3);
    border-radius: var(--radius-card);
    background: var(--pill-forest-bg);
    color: var(--pill-forest-fg);
  }
  .ghost {
    width: 100%;
    min-height: 48px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    background: transparent;
    color: var(--color-forest-deep);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .help {
    margin: 0;
    font-size: var(--font-size-caption);
    color: var(--color-ink-muted);
  }
  .help a {
    color: var(--color-forest);
  }
  .error {
    color: var(--color-rust);
  }
  .ask-owner {
    margin: 0;
    padding: var(--space-3);
    border-radius: var(--radius-card);
    background: var(--pill-wheat-bg);
    color: var(--pill-wheat-fg);
  }
</style>
