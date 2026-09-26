<script lang="ts">
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { CARD_KIND_LABEL, type CardModel, type CardVariant } from '$lib/cards/model';
  import type { QrPath } from '$lib/cards/qr';
  import { DEFAULT_PREFS, formatInstant, type Prefs } from '$lib/prefs';

  interface Props {
    card: CardModel;
    variant?: CardVariant;
    prefs?: Prefs;
    /** Print only: the live-card link and its QR, built by CardPrintSheet so
     *  the encoder stays out of screen-only bundles. */
    printLink?: { url: string; qr: QrPath } | null;
  }

  const COMPACT_FACTS = 2;

  const { card, variant = 'screen', prefs = DEFAULT_PREFS, printLink = null }: Props = $props();

  const titleId = $derived(`card-title-${variant}-${card.key}`);
  const facts = $derived(variant === 'compact' ? card.facts.slice(0, COMPACT_FACTS) : card.facts);
  const asOf = $derived(formatInstant(card.asOf, prefs, 'datetime'));
  const kickerNamesKind = $derived(
    card.kicker.toLowerCase().startsWith(CARD_KIND_LABEL[card.kind].toLowerCase())
  );
  const link = $derived(variant === 'print' ? printLink : null);
  const nextText = $derived(
    card.next ? `${card.next.label}${card.next.due ? ` (${card.next.due})` : ''}` : ''
  );
</script>

<article
  class="cardview kind-{card.kind} v-{variant}"
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
    <div class="kicker">{card.kicker}</div>
    {#if variant === 'print'}
      <h3 class="title serif" id={titleId}>{card.title}</h3>
    {:else}
      <h3 class="title serif" id={titleId}><a href={card.href}>{card.title}</a></h3>
    {/if}

    <div class="content">
      {#if facts.length}
        <dl class="facts">
          {#each facts as f (f.label)}
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

      {#if variant !== 'compact'}
        {#each card.sections as s (s.title)}
          <section class="section">
            <h4>{s.title}</h4>
            <ul>
              {#each s.items as item, i (i)}
                <li>{item}</li>
              {/each}
            </ul>
          </section>
        {/each}
      {/if}
    </div>

    <footer class="foot">
      <span class="asof">As of {asOf}</span>
      {#if card.rulesVersion}
        <span class="rules mono">Rules {card.rulesVersion}</span>
      {/if}
      {#if variant === 'print'}
        <span class="prov-text">
          {card.provenance
            .map((p) => (p.detail ? `${p.source} (${p.detail})` : p.source))
            .join(' · ')}
        </span>
      {:else if variant === 'screen'}
        <span class="prov-list">
          {#each card.provenance as p, i (i)}
            <Provenance source={p.source} detail={p.detail} />
          {/each}
        </span>
      {/if}
    </footer>

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
    color: var(--color-ink-muted);
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
    color: var(--color-ink-muted);
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
  p.next {
    margin: 0;
    font-weight: 600;
  }
  .next-label {
    font-weight: 700;
  }
  .section h4 {
    margin: 0 0 var(--space-1);
    font-size: var(--font-size-meta);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-ink-muted);
  }
  .section ul {
    margin: 0;
    padding-left: 1.1em;
    font-size: var(--font-size-body);
    color: var(--color-ink-soft);
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    font-size: var(--font-size-caption);
    color: var(--color-ink-muted);
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
  .v-print .foot {
    font-size: 8pt;
    flex: 0 0 auto;
  }
  .v-print .qr-row {
    flex: 0 0 auto;
  }
</style>
