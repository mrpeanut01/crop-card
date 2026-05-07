<script lang="ts">
  const tiles = [
    { href: '/today', title: 'Today', sub: "Today's actions + upcoming windows" },
    { href: '/spray', title: 'Spray', sub: 'Pre-spray check, dilution, tank mix' },
    { href: '/scout', title: 'Scout', sub: 'Walk the block, decide spray/skip' },
    { href: '/harvest', title: 'Harvest', sub: 'Record a harvest, track curing' },
    { href: '/plan', title: 'Plan', sub: 'Blocks + planting records' },
    { href: '/plan/calendar', title: 'Calendar', sub: 'Visual month grid of every event' },
    { href: '/calibrate', title: 'Calibrate', sub: '1/128-acre method GPA wizard' },
    { href: '/equipment', title: 'Equipment', sub: 'Sprayers + planters + tractors + log' },
    { href: '/stock', title: 'Stock', sub: 'Inventory, lots, low-stock alerts' },
    { href: '/records', title: 'Records', sub: 'Spray-record archive + CSV/PDF' },
    { href: '/plugins', title: 'Plugins', sub: 'Manage crop / herbicide library' },
    { href: '/spray/decon', title: 'Decon', sub: 'Sprayer decontamination wizard' }
  ];
</script>

<section class="hero">
  <h1>CropCard</h1>
  <p class="lede">Field-card herbicide planning, planting, and harvest tracking.</p>
</section>

<nav class="tiles">
  {#each tiles as t}
    <a class="tile" href={t.href}>
      <strong>{t.title}</strong>
      <small>{t.sub}</small>
    </a>
  {/each}
</nav>

<style>
  .hero {
    text-align: center;
    padding: 1.5rem 1rem 0.5rem;
  }
  h1 {
    margin: 0 0 0.5rem;
    font-size: 2rem;
    color: #1f5e3a;
  }
  .lede {
    margin: 0 0 1rem;
    color: #555;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 0.75rem;
    margin-top: 1rem;
  }
  .tile {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 1.25rem;
    background: white;
    border-radius: 8px;
    text-decoration: none;
    color: #1f5e3a;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    border: 2px solid transparent;
    min-height: 80px;
  }
  .tile:hover {
    border-color: #1f5e3a;
    background: #f8fbf9;
  }
  .tile strong {
    font-size: 1.1rem;
  }
  .tile small {
    color: #555;
    font-size: 0.85rem;
  }
</style>
