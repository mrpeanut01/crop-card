<script lang="ts">
  import {
    User,
    MapPin,
    Users,
    Wrench,
    Box,
    FileText,
    Sparkles,
    Plug,
    CreditCard,
    Settings,
    Archive,
    LayoutGrid
  } from 'lucide-svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';

  // Pattern lifted from WorkflowStrip — lucide-svelte exports class
  // components; `typeof Check` is the established way to type them in
  // this codebase without per-icon casts.
  type LucideIcon = typeof User;

  /**
   * Phase 25c (#88) — /settings index.
   *
   * 11-card grid per the Almanac design's IA. Replaces the 2466-line
   * single-page tabbed monolith (moved to /settings/system, accessible
   * via the "Power tools" card for back-compat + functionality that
   * hasn't migrated to its own subroute yet).
   *
   * Each card links to either:
   *   - A new dedicated subpage built in this PR (account, farm,
   *     sprayers, plugins, records, integrations, billing, advanced)
   *   - An existing route already split (ai, helpers)
   *   - An adjacent app route the design wants surfaced from here
   *     (records → /records audit list)
   */

  let { data } = $props();

  interface Card {
    href: string;
    icon: LucideIcon;
    title: string;
    subtitle: string;
    ownerOnly?: boolean;
  }

  const cards: Card[] = $derived([
    {
      href: '/settings/account',
      icon: User,
      title: 'Account & sign-in',
      subtitle: `Signed in as ${data.user.email} (${data.user.role})`
    },
    {
      href: '/settings/farm',
      icon: MapPin,
      title: 'Farm & blocks',
      subtitle: `${data.counts.blocks} block${data.counts.blocks === 1 ? '' : 's'} · location, frost dates, season setup`,
      ownerOnly: true
    },
    {
      href: '/settings/helpers',
      icon: Users,
      title: 'Helpers & invites',
      subtitle: `${data.counts.helpers} ${data.counts.helpers === 1 ? 'person' : 'people'} with access`,
      ownerOnly: true
    },
    {
      href: '/settings/sprayers',
      icon: Wrench,
      title: 'Sprayers & calibration',
      subtitle: `${data.counts.equipment} sprayer${data.counts.equipment === 1 ? '' : 's'} configured`,
      ownerOnly: true
    },
    {
      href: '/settings/plugins',
      icon: Box,
      title: 'Plugins & crop library',
      subtitle: 'Browse, upload, override crop / spray plugin data'
    },
    {
      href: '/records',
      icon: FileText,
      title: 'Records (audit)',
      subtitle: 'Sprays, harvests, scout logs — searchable + exportable'
    },
    {
      href: '/settings/records',
      icon: Archive,
      title: 'Records & retention',
      subtitle: 'Retention policy + bulk export',
      ownerOnly: true
    },
    {
      href: '/settings/ai',
      icon: Sparkles,
      title: 'AI assistant',
      subtitle: data.counts.aiMonthlyCapUsd
        ? `$${data.counts.aiMonthlyUsd.toFixed(2)} / $${data.counts.aiMonthlyCapUsd.toFixed(2)} this month`
        : 'API key not set',
      ownerOnly: true
    },
    {
      href: '/settings/integrations',
      icon: Plug,
      title: 'Integrations',
      subtitle: 'External agents (Bearer tokens), webhooks',
      ownerOnly: true
    },
    {
      href: '/settings/billing',
      icon: CreditCard,
      title: 'Plan & billing',
      subtitle: 'Current plan, usage, upgrade options',
      ownerOnly: true
    },
    {
      href: '/settings/advanced',
      icon: Settings,
      title: 'Advanced & export-all',
      subtitle: 'Types taxonomy, inventory maintenance, danger zone',
      ownerOnly: true
    }
  ]);

  const visibleCards = $derived(cards.filter((c) => !c.ownerOnly || data.isOwner));
</script>

<svelte:head>
  <title>Settings · CropCard</title>
</svelte:head>

<header class="page-head">
  <Kicker>Configuration · per-Owner</Kicker>
  <h1>Settings</h1>
  <p class="lede">
    Pick a section to tune CropCard for your operation. Owners see all sections; helpers see the
    ones they can act on.
  </p>
</header>

<ul class="card-grid" aria-label="Settings sections">
  {#each visibleCards as card (card.href)}
    {@const Icon = card.icon}
    <li>
      <a class="card" href={card.href}>
        <div class="icon" aria-hidden="true">
          <Icon size={22} strokeWidth={1.5} />
        </div>
        <div class="body">
          <h2>{card.title}</h2>
          <p>{card.subtitle}</p>
        </div>
      </a>
    </li>
  {/each}
  {#if data.isOwner}
    <li class="system-card">
      <a class="card subtle" href="/settings/system">
        <div class="icon" aria-hidden="true">
          <LayoutGrid size={22} strokeWidth={1.5} />
        </div>
        <div class="body">
          <h2>Power tools (legacy)</h2>
          <p>
            The pre-Phase-25c tabbed page — Display / AI / Location / Types / Inventory / Danger.
            Stays here until each tab fully migrates to its dedicated subpage.
          </p>
        </div>
      </a>
    </li>
  {/if}
</ul>

<style>
  .page-head {
    margin-bottom: 18px;
  }
  .page-head h1 {
    margin: 4px 0 8px;
    font-family: var(--font-serif, serif);
    font-size: 28px;
    color: var(--color-forest-deep);
    letter-spacing: var(--letter-tight, -0.01em);
  }
  .lede {
    margin: 0;
    font-size: 13.5px;
    color: var(--color-ink-soft);
    line-height: 1.5;
    max-width: 60ch;
  }
  .card-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
  }
  .card {
    display: flex;
    gap: 12px;
    padding: 16px;
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card, 8px);
    text-decoration: none;
    color: var(--color-ink);
    transition: transform 0.08s ease, border-color 0.15s ease;
    min-height: 88px;
  }
  .card:hover {
    border-color: var(--color-forest-deep);
    transform: translateY(-1px);
  }
  .card.subtle {
    background: var(--color-cream);
    border-style: dashed;
  }
  .system-card {
    grid-column: 1 / -1;
  }
  .icon {
    width: 40px;
    height: 40px;
    border-radius: var(--radius-input, 6px);
    background: rgba(44, 82, 55, 0.06);
    color: var(--color-forest-deep);
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .body h2 {
    margin: 0;
    font-size: 14.5px;
    font-weight: 700;
    color: var(--color-ink);
    letter-spacing: var(--letter-tight, -0.01em);
  }
  .body p {
    margin: 0;
    font-size: 12.5px;
    color: var(--color-ink-soft);
    line-height: 1.4;
  }
</style>
