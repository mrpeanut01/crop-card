<script lang="ts">
  import type { Snippet } from 'svelte';
  import Pill from '$lib/components/ui/Pill.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import BedMapThumb from './BedMapThumb.svelte';
  import CardCalendarView from './CardCalendarView.svelte';
  import {
    CARD_KIND_LABEL,
    isCardStale,
    type CardModel,
    type CardSection,
    type CardVariant
  } from '$lib/cards/model';
  import type { QrPath } from '$lib/cards/qr';
  import { DEFAULT_PREFS, formatInstant, type Prefs } from '$lib/prefs';
  import { provenanceText } from '$lib/provenanceLabels';
  import { CARD_KIND_LABEL_KEYS } from './kindLabels';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

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
    /** Print only: every item is on the card and the page flows onto more
     *  sheets, so there is no "Cut short?" line. */
    complete?: boolean;
  }

  const tr = $derived(createT(page.data?.locale));
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
    badges,
    complete = false
  }: Props = $props();

  const stale = $derived(isCardStale(card, now));

  const titleId = $derived(`card-title-${variant}-${card.key}`);
  const facts = $derived(variant === 'compact' ? card.facts.slice(0, factLimit) : card.facts);
  const asOf = $derived(formatInstant(card.asOf, prefs, 'datetime'));
  const kickerNamesKind = $derived(
    [CARD_KIND_LABEL[card.kind], tr(CARD_KIND_LABEL_KEYS[card.kind])].some((label) =>
      card.kicker.toLowerCase().startsWith(label.toLowerCase())
    )
  );
  const link = $derived(variant === 'print' ? printLink : null);
  /** Whole-print cards (#581) keep the packer's order and never fade. */
  const whole = $derived(variant === 'print' && !!card.printWhole);
  const part = $derived(whole ? card.printPart : undefined);
  const safetyFirst = $derived(
    variant === 'print' && !whole ? card.sections.filter((s) => s.safety) : []
  );
  const bodySections = $derived(
    variant === 'print' && !whole ? card.sections.filter((s) => !s.safety) : card.sections
  );
  const shownSections = $derived(
    variant === 'compact'
      ? bodySections.filter((s) => compactSections.includes(s.title))
      : bodySections
  );
  const provText = $derived(provenanceText(card.provenance, page.data?.locale));
  const nextText = $derived(
    card.next ? `${card.next.label}${card.next.due ? ` (${card.next.due})` : ''}` : ''
  );
</script>

<article
  class="cardview kind-{card.kind} v-{variant}"
  class:selected
  class:whole
  class:has-qr={whole && !!link}
  style:--strip={card.accent}
  data-card-kind={card.kind}
  data-card-key={card.key}
  data-variant={variant}
  aria-labelledby={titleId}
>
  <div class="strip" aria-hidden="true"></div>
  <div class="body">
    {#if variant === 'print' && !kickerNamesKind}
      <div class="kind-label">{tr(CARD_KIND_LABEL_KEYS[card.kind])}</div>
    {/if}
    {#if part}
      <div class="kicker-row part-row">
        <div class="kicker">{card.kicker}</div>
        <span class="part" data-print-part="{part.n}/{part.of}"
          >{tr('cardsui.part', { n: part.n, of: part.of })}{#if part.ref}
            · {part.ref}{/if}</span
        >
      </div>
    {:else if badges && variant !== 'print'}
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
      <p class="stale" role="status">{tr('cardsui.stale')}</p>
    {/if}
    {#if card.notices?.length}
      <ul class="notices">
        {#each card.notices as n, i (i)}
          {#if card.englishOnlyNotices?.includes(n)}
            <li><span lang="en" data-english-only="safety">{n}</span></li>
          {:else}
            <li>{n}</li>
          {/if}
        {/each}
      </ul>
    {/if}

    {#snippet itemBody(item: string, nowrapAfter: string | undefined)}
      {@const at = nowrapAfter ? item.lastIndexOf(nowrapAfter) : -1}
      {#if at >= 0 && nowrapAfter}{item.slice(0, at + nowrapAfter.length)}<span class="nowrap"
          >{item.slice(at + nowrapAfter.length)}</span
        >{:else}{item}{/if}
    {/snippet}

    {#snippet itemText(item: string, s: CardSection)}
      {#if s.englishOnly || s.englishOnlyItems?.includes(item)}<span
          lang="en"
          data-english-only="safety">{@render itemBody(item, s.nowrapAfter)}</span
        >{:else}{@render itemBody(item, s.nowrapAfter)}{/if}
    {/snippet}

    {#snippet sectionTitle(s: CardSection)}
      {#if s.englishOnly === 'all'}<span lang="en" data-english-only="safety">{s.title}</span
        >{:else}{s.title}{/if}
    {/snippet}

    {#each safetyFirst as s (s.title)}
      <section class="section safety" data-safety-section>
        <h4>{@render sectionTitle(s)}</h4>
        <ul>
          {#each s.items as item, i (i)}
            <li>{@render itemText(item, s)}</li>
          {/each}
        </ul>
      </section>
    {/each}

    <div class="content">
      {#if facts.length}
        <dl class="facts">
          {#each facts as f, i (`${i}-${f.label}`)}
            <div class="fact" class:wide={variant === 'print' && f.printWide}>
              {#if f.englishOnly}
                <dt><span lang="en" data-english-only="safety">{f.label}</span></dt>
              {:else}
                <dt>{f.label}</dt>
              {/if}
              <dd>
                {#if f.englishOnly}
                  <span class="value" lang="en" data-english-only="safety"
                    >{variant === 'print' && f.printValue ? f.printValue : f.value}</span
                  >
                {:else}
                  <span class="value"
                    >{variant === 'print' && f.printValue ? f.printValue : f.value}</span
                  >
                {/if}
                {#if f.provenance && variant === 'screen'}
                  <Provenance source={f.provenance} compact />
                {/if}
                {#if f.note}
                  <span class="fact-note" data-fact-note
                    >{#if f.provenance && variant === 'compact'}<Provenance
                        source={f.provenance}
                        compact
                      />{/if}{#if f.englishOnly}<span lang="en" data-english-only="safety"
                        >{f.note}</span
                      >{:else}{f.note}{/if}</span
                  >
                {/if}
              </dd>
            </div>
          {/each}
        </dl>
      {/if}

      {#if card.next}
        {#if variant === 'print'}
          <p class="next"><span class="next-label">{tr('cardsui.next')}</span> {nextText}</p>
        {:else}
          <a class="next" href={card.next.href}>
            <span class="next-label">{tr('cardsui.next')}</span>
            {nextText}
          </a>
        {/if}
      {/if}

      {#if card.bedMap && variant !== 'compact'}
        <section class="section" data-testid="card-bed-map">
          <h4>{tr('cardsui.bedMap')}</h4>
          <BedMapThumb map={card.bedMap} print={variant === 'print'} />
        </section>
      {/if}

      {#if card.calendar && variant !== 'compact'}
        <CardCalendarView calendar={card.calendar} mode={variant === 'print' ? 'grid' : 'agenda'} />
      {/if}

      {#if card.links?.length && variant === 'screen'}
        <div class="links">
          {#each card.links as l (l.href)}
            {#if l.external}
              <a class="next" href={l.href} rel="noopener noreferrer nofollow" target="_blank"
                >{l.label}</a
              >
            {:else}
              <a class="next" href={l.href}>{l.label}</a>
            {/if}
          {/each}
        </div>
      {/if}

      {#if actions && variant !== 'print'}
        <div class="actions">{@render actions()}</div>
      {/if}

      {#each shownSections as s (s.title)}
        {#if s.collapsible && variant !== 'print'}
          <details class="section fold" class:safety={s.safety} data-collapsible-section>
            <summary>
              <span class="fold-title">{@render sectionTitle(s)}</span>
              {#if s.provenance && variant === 'screen'}
                <Provenance source={s.provenance} compact />
              {/if}
            </summary>
            <ul>
              {#each s.items as item, i (i)}
                <li>{@render itemText(item, s)}</li>
              {/each}
            </ul>
          </details>
        {:else}
          <section class="section" class:safety={s.safety}>
            <h4>
              {@render sectionTitle(s)}
              {#if s.provenance && variant === 'screen'}
                <Provenance source={s.provenance} compact />
              {/if}
            </h4>
            <ul>
              {#each s.items as item, i (i)}
                <li>{@render itemText(item, s)}</li>
              {/each}
            </ul>
          </section>
        {/if}
      {/each}
    </div>
    {#if part && part.n < part.of}
      <p class="continued" data-print-continued>
        {tr('cardsui.continued', { next: part.n + 1, of: part.of })}
      </p>
    {/if}
    {#if variant === 'print' && !whole && bodySections.length && !complete}
      <p class="more">
        {#if card.kind === 'spray'}<span lang="en" data-english-only="safety"
            >Cut short? The label and the live card have the full directions.</span
          >{:else}{tr('cardsui.cutShort')}{/if}
      </p>
    {/if}

    {#if whole}
      {#if link}
        <div class="whole-qr">
          <svg
            class="qr"
            viewBox="0 0 {link.qr.size} {link.qr.size}"
            shape-rendering="crispEdges"
            role="img"
            aria-label={tr('cardsui.qr', { url: link.url })}
          >
            <rect width={link.qr.size} height={link.qr.size} fill="#fff" />
            <path d={link.qr.d} fill="#000" />
          </svg>
          <span class="short-url mono">{link.url}</span>
        </div>
      {/if}
      <footer class="foot">
        <span class="asof">{tr('cardsui.asOf', { date: asOf })}</span>
        {#if card.rulesVersion}
          <span class="rules mono"
            >{tr('cardsui.rulesVersion', { version: card.rulesVersion })}</span
          >
        {/if}
        <span class="prov-text">{provText}</span>
      </footer>
    {:else if showAsOf || card.rulesVersion || variant !== 'compact'}
      <footer class="foot">
        {#if showAsOf || variant === 'print'}
          <span class="asof">{tr('cardsui.asOf', { date: asOf })}</span>
        {/if}
        {#if card.rulesVersion}
          <span class="rules mono"
            >{tr('cardsui.rulesVersion', { version: card.rulesVersion })}</span
          >
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

    {#if link && !whole}
      <div class="qr-row">
        <svg
          class="qr"
          viewBox="0 0 {link.qr.size} {link.qr.size}"
          shape-rendering="crispEdges"
          role="img"
          aria-label={tr('cardsui.qr', { url: link.url })}
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
  .kind-day,
  .kind-week,
  .kind-month {
    --strip: var(--color-ink-soft);
  }
  .kind-task {
    --strip: var(--color-forest-deep);
  }
  .kind-scout {
    --strip: var(--color-ink-muted);
  }
  .kind-soilTest {
    --strip: var(--color-wheat);
  }
  .kind-animal,
  .kind-flock {
    --strip: var(--color-sky);
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
    min-width: 48px;
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
  .fact-note {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    width: 100%;
    font-size: var(--font-size-meta);
    color: var(--color-ink-soft);
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
  .fold summary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    min-height: 48px;
    cursor: pointer;
    font-weight: 600;
    color: var(--color-ink);
    overflow-wrap: anywhere;
  }
  .fold-title {
    min-width: 0;
  }
  .fold ul {
    margin-top: var(--space-1);
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
  /* Whole-print cards (#581): fixed sizes the packer in printPack.ts
     estimates against (WHOLE_PRINT). Nothing fades; overflow is a bug the
     print-fit e2e test catches. */
  .v-print.whole,
  .v-print.whole * {
    line-height: 1.25;
  }
  .v-print.whole .body {
    padding: 0.1in 0.12in;
    gap: 0.05in;
  }
  .v-print.whole .content {
    -webkit-mask-image: none;
    mask-image: none;
    padding-bottom: 0;
    gap: 0.05in;
  }
  .v-print.whole .part-row {
    justify-content: space-between;
    gap: 0 0.1in;
  }
  .v-print.whole .kicker,
  .v-print.whole .part {
    font-size: 8pt;
  }
  .v-print.whole .part {
    font-weight: 700;
    color: #000;
  }
  .v-print.whole .title {
    font-size: 13pt;
  }
  .v-print.whole .notices {
    font-size: 8.5pt;
    gap: 1pt;
  }
  .v-print.whole .facts {
    gap: 0.04in 0.12in;
    padding: 0.03in 0;
    border-width: 0.5pt;
  }
  .v-print.whole dt {
    font-size: 7pt;
    letter-spacing: 0.06em;
  }
  .v-print.whole dd {
    font-size: 10pt;
    font-weight: 600;
  }
  .v-print.whole .fact.wide {
    grid-column: 1 / -1;
  }
  .v-print.whole .fact {
    gap: 0.02in;
    break-inside: avoid;
  }
  .v-print.whole .section h4 {
    font-size: 7.5pt;
    margin-bottom: 0.03in;
    color: #000;
    font-weight: 700;
  }
  .v-print.whole .section ul {
    font-size: 9pt;
    padding-left: 1.1em;
  }
  .v-print.whole p.next {
    font-size: 9pt;
  }
  .continued {
    margin: 0;
    flex: 0 0 auto;
    font-size: 8pt;
    font-weight: 700;
  }
  .v-print.whole.has-qr .body {
    position: relative;
    padding-right: calc(0.12in + 0.78in);
  }
  .v-print.whole .whole-qr {
    position: absolute;
    top: 0.1in;
    right: 0.12in;
    width: 0.7in;
    display: flex;
    flex-direction: column;
    gap: 0.03in;
  }
  .v-print.whole .whole-qr .qr {
    width: 0.7in;
    height: 0.7in;
  }
  .v-print.whole .whole-qr .short-url {
    font-size: 6pt;
    overflow-wrap: anywhere;
  }
  .v-print.whole .foot {
    font-size: 7pt;
    border-top-width: 0.5pt;
    padding-top: 0.03in;
    gap: 0 0.06in;
  }
  .v-print.kind-week .content,
  .v-print.kind-month .content {
    -webkit-mask-image: none;
    mask-image: none;
    padding-bottom: 0;
  }
  .v-print.kind-week .facts,
  .v-print.kind-month .facts {
    grid-template-columns: repeat(4, auto);
    justify-content: start;
    padding: 0.03in 0;
  }
  .v-print.kind-week .qr,
  .v-print.kind-month .qr {
    width: 0.6in;
    height: 0.6in;
  }
</style>
