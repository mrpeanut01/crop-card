<script lang="ts">
  import type { Snippet } from 'svelte';
  import Pill from '$lib/components/ui/Pill.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import BedMapThumb from './BedMapThumb.svelte';
  import {
    CARD_KIND_LABEL,
    STALE_NOTICE,
    isCardStale,
    type CardModel,
    type CardVariant
  } from '$lib/cards/model';
  import type { QrPath } from '$lib/cards/qr';
  import { DEFAULT_PREFS, formatInstant, type Prefs } from '$lib/prefs';
  import { provenanceText } from '$lib/provenanceLabels';

  interface Props {
    card: CardModel;
    variant?: CardVariant;
    prefs?: Prefs;
    /** Print only: the live-card link and its QR, built by CardPrintSheet so
     *  the encoder stays out of screen-only bundles. */
    printLink?: { url: string; qr: QrPath } | null;
    /** Epoch ms the stale check compares `asOf` against. */
    now?: number;
    /** Marks the card the page has selected (a rail of Area cards). */
    selected?: boolean;
    /** How many facts the compact variant shows. */
    factLimit?: number;
    /** Section titles the compact variant still shows (a task's Notes). */
    compactSections?: readonly string[];
    /** False drops the as-of time, for live pages rather than saved cards. */
    showAsOf?: boolean;
    /** Screen and compact only: controls under the links (task actions, companion chips). */
    actions?: Snippet;
    /** Screen and compact only: badges beside the kicker. */
    badges?: Snippet;
  }

  const COMPACT_FACTS = 2;

  const {
    card,
    variant = 'screen',
    prefs = DEFAULT_PREFS,
    printLink = null,
    now = Date.now(),
    selected = false,
    factLimit = COMPACT_FACTS,
    compactSections = [],
    showAsOf = true,
    actions,
    badges
  }: Props = $props();

  const stale = $derived(isCardStale(card, now));

  const titleId = $derived(`card-title-${variant}-${card.key}`);
  const facts = $derived(variant === 'compact' ? card.facts.slice(0, factLimit) : card.facts);
  const asOf = $derived(formatInstant(card.asOf, prefs, 'datetime'));
  const kickerNamesKind = $derived(
    card.kicker.toLowerCase().startsWith(CARD_KIND_LABEL[card.kind].toLowerCase())
  );
  const link = $derived(variant === 'print' ? printLink : null);
  const safetyFirst = $derived(variant === 'print' ? card.sections.filter((s) => s.safety) : []);
  const bodySections = $derived(
    variant === 'print' ? card.sections.filter((s) => !s.safety) : card.sections
  );
  const shownSections = $derived(
    variant === 'compact'
      ? bodySections.filter((s) => compactSections.includes(s.title))
      : bodySections
  );
  const provText = $derived(provenanceText(card.provenance));
  const nextText = $derived(
    card.next ? `${card.next.label}${card.next.due ? ` (${card.next.due})` : ''}` : ''
  );
</script>

<article
  class="cardview kind-{card.kind} v-{variant}"
  class:selected
  style:--strip={card.accent}
  data-card-kind={card.kind}
  data-card-key={card.key}
  data-variant={variant}
  aria-labelledby={titleId}
>
  <div class="strip" aria-hidden="true"></div>
  <div class="body">
    {#if variant === 'print' && !kickerNamesKind}
      <div class="kind-label">{CARD_KIND_LABEL[card.kind]}</div>
    {/if}
    {#if badges && variant !== 'print'}
      <div class="kicker-row">
        <div class="kicker">{card.kicker}</div>
        {@render badges()}
      </div>
    {:else}
      <div class="kicker">{card.kicker}</div>
    {/if}
    <div class="title-row">
      {#if variant === 'print'}
        <h3 class="title serif" id={titleId}>{card.title}</h3>
      {:else}
        <h3 class="title serif" id={titleId}>
          <a href={card.href} aria-current={selected ? 'true' : undefined}>{card.title}</a>
        </h3>
      {/if}
      {#if card.status}
        {#if variant === 'print'}
          <span class="status-text" data-card-status={card.status.id}>{card.status.label}</span>
        {:else}
          <span class="status" data-card-status={card.status.id ?? card.status.label}>
            <Pill tone={card.status.tone}>{card.status.label}</Pill>
          </span>
        {/if}
      {/if}
    </div>

    {#if stale}
      <p class="stale" role="status">{STALE_NOTICE}</p>
    {/if}
    {#if card.notices?.length}
      <ul class="notices">
        {#each card.notices as n, i (i)}
          <li>{n}</li>
        {/each}
      </ul>
    {/if}

    {#snippet itemText(item: string, nowrapAfter: string | undefined)}
      {@const at = nowrapAfter ? item.lastIndexOf(nowrapAfter) : -1}
      {#if at >= 0 && nowrapAfter}{item.slice(0, at + nowrapAfter.length)}<span class="nowrap"
          >{item.slice(at + nowrapAfter.length)}</span
        >{:else}{item}{/if}
    {/snippet}

    {#each safetyFirst as s (s.title)}
      <section class="section safety" data-safety-section>
        <h4>{s.title}</h4>
        <ul>
          {#each s.items as item, i (i)}
            <li>{@render itemText(item, s.nowrapAfter)}</li>
          {/each}
        </ul>
      </section>
    {/each}

    <div class="content">
      {#if facts.length}
        <dl class="facts">
          {#each facts as f, i (`${i}-${f.label}`)}
            <div class="fact">
              <dt>{f.label}</dt>
              <dd>
                <span class="value">{f.value}</span>
                {#if f.provenance && variant === 'screen'}
                  <Provenance source={f.provenance} compact />
                {/if}
              </dd>
            </div>
          {/each}
        </dl>
      {/if}

      {#if card.next}
        {#if variant === 'print'}
          <p class="next"><span class="next-label">Next:</span> {nextText}</p>
        {:else}
          <a class="next" href={card.next.href}>
            <span class="next-label">Next:</span>
            {nextText}
          </a>
        {/if}
      {/if}

      {#if card.bedMap && variant !== 'compact'}
        <section class="section" data-testid="card-bed-map">
          <h4>Garden bed map</h4>
          <BedMapThumb map={card.bedMap} print={variant === 'print'} />
        </section>
      {/if}

      {#if card.links?.length && variant === 'screen'}
        <div class="links">
          {#each card.links as l (l.href)}
            <a class="next" href={l.href}>{l.label}</a>
          {/each}
        </div>
      {/if}

      {#if actions && variant !== 'print'}
        <div class="actions">{@render actions()}</div>
      {/if}

      {#each shownSections as s (s.title)}
        <section class="section" class:safety={s.safety}>
          <h4>
            {s.title}
            {#if s.provenance && variant === 'screen'}
              <Provenance source={s.provenance} compact />
            {/if}
          </h4>
          <ul>
            {#each s.items as item, i (i)}
              <li>{@render itemText(item, s.nowrapAfter)}</li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
    {#if variant === 'print' && bodySections.length}
      <p class="more">
        {card.kind === 'spray'
          ? 'Cut short? The label and the live card have the full directions.'
          : 'Cut short? The live card has the full list.'}
      </p>
    {/if}

    {#if showAsOf || card.rulesVersion || variant !== 'compact'}
      <footer class="foot">
        {#if showAsOf || variant === 'print'}
          <span class="asof">As of {asOf}</span>
        {/if}
        {#if card.rulesVersion}
          <span class="rules mono">Rules {card.rulesVersion}</span>
        {/if}
        {#if variant === 'print'}
          <span class="prov-text">{provText}</span>
        {:else if variant === 'screen'}
          <span class="prov-list">
            {#each card.provenance as p, i (i)}
              <Provenance source={p.source} detail={p.detail} />
            {/each}
          </span>
        {/if}
      </footer>
    {/if}

    {#if link}
      <div class="qr-row">
        <svg
          class="qr"
          viewBox="0 0 {link.qr.size} {link.qr.size}"
          shape-rendering="crispEdges"
          role="img"
          aria-label="QR code linking to {link.url}"
        >
          <rect width={link.qr.size} height={link.qr.size} fill="#fff" />
          <path d={link.qr.d} fill="#000" />
        </svg>
        <span class="short-url mono">{link.url}</span>
      </div>
    {/if}
  </div>
</article>

<style>
  .cardview {
    --strip: var(--color-forest);
    display: flex;
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    overflow: hidden;
    color: var(--color-ink);
    min-width: 0;
  }
  .cardview.selected {
    border-color: var(--color-forest);
    box-shadow: inset 0 0 0 1px var(--color-forest);
  }
  .title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-width: 0;
  }
  .title-row .title {
    flex: 1;
    min-width: 0;
  }
  .status {
    flex: 0 0 auto;
  }
  .status-text {
    font-size: 9pt;
    font-weight: 700;
    text-transform: uppercase;
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .kind-planting,
  .kind-careGuide {
    --strip: var(--color-forest);
  }
  .kind-area,
  .kind-stock {
    --strip: var(--color-wheat);
  }
  .kind-farmMap {
    --strip: var(--color-forest-deep);
  }
  .kind-spray {
    --strip: var(--color-rust);
  }
  .kind-equipment {
    --strip: var(--color-sky);
  }
  .kind-day {
    --strip: var(--color-ink-soft);
  }
  .kind-task {
    --strip: var(--color-forest-deep);
  }
  .kind-scout {
    --strip: var(--color-ink-muted);
  }
  .kicker-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
  }
  .strip {
    flex: 0 0 6px;
    background: var(--strip);
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
  .body {
    flex: 1;
    min-width: 0;
    padding: var(--card-padding);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .kind-label {
    font-size: var(--font-size-meta);
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-ink);
  }
  .kicker {
    font-size: var(--font-size-kicker);
    font-weight: 600;
    color: var(--color-ink-soft);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    overflow-wrap: anywhere;
  }
  .title {
    margin: 0;
    font-size: var(--font-size-card-title);
    font-weight: 600;
    color: var(--color-forest-deep);
    letter-spacing: var(--letter-tight);
    overflow-wrap: anywhere;
  }
  .title a {
    color: inherit;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    min-height: 48px;
  }
  .title a:hover {
    text-decoration: underline;
  }
  .title a:focus-visible,
  a.next:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
    border-radius: var(--radius-input);
  }
  .content {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-height: 0;
  }
  .facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: var(--space-2) var(--space-4);
    margin: 0;
    padding: var(--space-2) 0;
    border-top: 1px solid var(--color-divider-soft);
    border-bottom: 1px solid var(--color-divider-soft);
  }
  .fact {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  dt {
    font-size: var(--font-size-meta);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-ink-soft);
  }
  dd {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--font-size-body);
    color: var(--color-ink);
    overflow-wrap: anywhere;
  }
  a.next {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-height: 48px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-input);
    background: var(--pill-forest-bg);
    border: 1px solid var(--pill-forest-bd);
    color: var(--pill-forest-fg);
    font-weight: 600;
    text-decoration: none;
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  p.next {
    margin: 0;
    font-weight: 600;
  }
  .next-label {
    font-weight: 700;
  }
  .stale {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-input);
    background: var(--pill-rust-bg);
    border: 1px solid var(--pill-rust-bd);
    color: var(--pill-rust-fg);
    font-weight: 600;
  }
  .notices {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-weight: 700;
    color: var(--color-ink);
  }
  .section h4 {
    margin: 0 0 var(--space-1);
    font-size: var(--font-size-meta);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-ink-soft);
  }
  .section ul {
    margin: 0;
    padding-left: 1.1em;
    font-size: var(--font-size-body);
    color: var(--color-ink-soft);
  }
  .nowrap {
    white-space: nowrap;
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
    padding-top: var(--space-2);
    border-top: 1px solid var(--color-divider-soft);
  }
  .prov-list {
    display: inline-flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .qr-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .qr {
    width: 0.85in;
    height: 0.85in;
    flex: 0 0 auto;
  }
  .short-url {
    font-size: 9pt;
    overflow-wrap: anywhere;
  }

  .v-compact .body {
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
  }
  .v-compact .facts {
    border: 0;
    padding: 0;
  }

  .v-print {
    height: 100%;
    border-radius: 0;
    background: #fff;
    color: #000;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .v-print .content {
    flex: 1 1 auto;
    overflow: hidden;
    padding-bottom: 0.2in;
    -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 0.22in), transparent 100%);
    mask-image: linear-gradient(to bottom, #000 calc(100% - 0.22in), transparent 100%);
  }
  .v-print .body {
    min-height: 0;
    overflow: hidden;
    padding: 0.12in 0.14in;
    gap: 0.06in;
  }
  .v-print .kicker,
  .v-print dt,
  .v-print .section h4,
  .v-print .foot {
    color: #333;
  }
  .v-print .title {
    color: #000;
    font-size: 14pt;
  }
  .v-print dd,
  .v-print .section ul {
    font-size: 10pt;
    color: #000;
  }
  .v-print .facts {
    grid-template-columns: 1fr 1fr;
  }
  .v-print .notices,
  .v-print .stale {
    font-size: 9pt;
    color: #000;
    background: none;
    border: 0;
    padding: 0;
  }
  .v-print .foot {
    font-size: 8pt;
    flex: 0 0 auto;
  }
  .v-print > .body > .section.safety {
    flex: 0 0 auto;
  }
  .v-print .section.safety ul {
    font-size: 8.5pt;
    line-height: 1.25;
  }
  .v-print .section.safety h4 {
    color: #000;
    font-weight: 700;
  }
  .more {
    margin: 0;
    flex: 0 0 auto;
    font-size: 8pt;
    font-style: italic;
    color: #333;
  }
  .v-print .qr-row {
    flex: 0 0 auto;
  }
</style>
