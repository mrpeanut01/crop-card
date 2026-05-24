<script lang="ts">
  import Button from '$lib/components/ui/Button.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Banner from '$lib/components/ui/Banner.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import Select from '$lib/components/ui/Select.svelte';
  import Textarea from '$lib/components/ui/Textarea.svelte';
  import Modal from '$lib/components/ui/Modal.svelte';
  import OfflineIndicator from '$lib/components/ui/OfflineIndicator.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import ProvenanceLegend from '$lib/components/ui/ProvenanceLegend.svelte';

  let modalOpen = $state(false);
  let inputValue = $state('');
  let selectValue = $state('a');
  let textareaValue = $state('');
</script>

<svelte:head>
  <title>Primitives — CropCard dev</title>
</svelte:head>

<div class="page">
  <header>
    <Kicker>Phase 25a · Dev only</Kicker>
    <h1 class="serif">Primitives</h1>
    <p>Visual + a11y baseline for the Almanac design system. Used by the Playwright screenshot baseline.</p>
  </header>

  <section>
    <h2 class="serif">Pill — 5 tones</h2>
    <div class="row">
      <Pill tone="neutral">Neutral</Pill>
      <Pill tone="forest">Forest</Pill>
      <Pill tone="wheat">Wheat</Pill>
      <Pill tone="rust">Rust</Pill>
      <Pill tone="sky">Sky</Pill>
    </div>
  </section>

  <section>
    <h2 class="serif">Kicker</h2>
    <Kicker>Today · do this first</Kicker>
  </section>

  <section>
    <h2 class="serif">Card</h2>
    <div class="grid">
      <Card>
        <Kicker>Padded (default)</Kicker>
        <p>14px padding, paper background, 8px radius.</p>
      </Card>
      <Card loose>
        <Kicker>Loose padding</Kicker>
        <p>18px padding variant.</p>
      </Card>
      <Card padded={false}>
        <div style="padding: 14px"><Kicker>Padded=false</Kicker>
        <p>Caller controls padding (e.g., for divided rows).</p></div>
      </Card>
    </div>
  </section>

  <section>
    <h2 class="serif">Button</h2>
    <div class="row">
      <Button variant="primary">Primary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="danger">Danger</Button>
      <Button variant="primary" size="sm">Small</Button>
      <Button variant="primary" loading>Loading</Button>
      <Button variant="primary" disabled>Disabled</Button>
    </div>
  </section>

  <section>
    <h2 class="serif">Banner</h2>
    <div class="stack">
      <Banner tone="forest">Today's plan committed. <span class="mono">14:02</span></Banner>
      <Banner tone="wheat">Backpack sprayer 1 needs decontamination before next use.</Banner>
      <Banner tone="rust" urgent>Spray blocked — kernel reason: PHI not met for tomato.</Banner>
      <Banner tone="sky">Forecast shows 0.4 in rain Tue→Wed.</Banner>
      <Banner tone="neutral" dismissible onDismiss={() => {}}>You can dismiss this one.</Banner>
    </div>
  </section>

  <section>
    <h2 class="serif">Form fields</h2>
    <div class="grid">
      <Input label="Field name" placeholder="e.g., Block A" bind:value={inputValue} />
      <Input label="Acres" type="number" hint="Acres of the block being sprayed" />
      <Input label="EPA #" error="Required for kernel evaluation." />
      <Select label="Variety" bind:value={selectValue}>
        <option value="a">Bloody Butcher</option>
        <option value="b">Painted Mountain</option>
        <option value="c">Silver Queen F1</option>
      </Select>
      <Textarea label="Notes" placeholder="Anything worth recording..." bind:value={textareaValue} />
    </div>
  </section>

  <section>
    <h2 class="serif">Modal</h2>
    <Button onclick={() => (modalOpen = true)}>Open modal</Button>
    <Modal open={modalOpen} title="Confirm spray" onClose={() => (modalOpen = false)}>
      <p>The kernel verdict will be re-checked at submit. This modal demonstrates focus trap, Esc, and backdrop click — all default behaviors of the primitive.</p>
      {#snippet footer()}
        <Button variant="ghost" onclick={() => (modalOpen = false)}>Cancel</Button>
        <Button variant="primary" onclick={() => (modalOpen = false)}>Confirm</Button>
      {/snippet}
    </Modal>
  </section>

  <section>
    <h2 class="serif">OfflineIndicator</h2>
    <div class="row">
      <OfflineIndicator online={true} pendingCount={0} />
      <OfflineIndicator online={true} pendingCount={3} />
      <OfflineIndicator online={false} pendingCount={0} />
      <OfflineIndicator online={false} pendingCount={5} />
    </div>
  </section>

  <section>
    <h2 class="serif">Provenance — 5 sources (Phase 25d v2 addendum)</h2>
    <div class="row">
      <Provenance source="plugin" detail="corn-bb · v1.4" />
      <Provenance source="data" detail="your scout · May 24" />
      <Provenance source="ai" confidence={0.92} />
      <Provenance source="manual" detail="edited 2 min ago" />
      <Provenance source="fallback" detail="AI was off" />
    </div>
    <div class="row">
      <span class="row-label">Compact</span>
      <Provenance source="plugin" compact />
      <Provenance source="data" compact />
      <Provenance source="ai" compact confidence={0.81} />
      <Provenance source="manual" compact />
      <Provenance source="fallback" compact />
    </div>
    <div class="row">
      <span class="row-label">Confidence bands</span>
      <Provenance source="ai" confidence={0.95} detail="high" />
      <Provenance source="ai" confidence={0.83} detail="medium" />
      <Provenance source="ai" confidence={0.68} detail="low" />
    </div>
  </section>

  <section>
    <h2 class="serif">ProvenanceLegend</h2>
    <ProvenanceLegend
      shown={['plugin', 'data', 'ai', 'manual']}
      note="AI on · mix and rates pre-populated · all editable"
    />
    <ProvenanceLegend
      shown={['plugin', 'data', 'fallback', 'manual']}
      note="AI off · plugin defaults filled · all editable"
    />
    <ProvenanceLegend shown={['plugin', 'data']} />
  </section>
</div>

<style>
  .page {
    max-width: 980px;
    margin: 0 auto;
    padding: var(--page-padding);
    display: flex;
    flex-direction: column;
    gap: 36px;
  }
  header h1 {
    margin-top: 6px;
  }
  header p {
    margin-top: 6px;
    color: var(--color-ink-soft);
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .row-label {
    font-size: var(--font-size-meta);
    color: var(--color-ink-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 700;
  }
  section h2 {
    font-size: var(--font-size-screen-title);
    margin: 0;
    color: var(--color-forest-deep);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 14px;
  }
</style>
