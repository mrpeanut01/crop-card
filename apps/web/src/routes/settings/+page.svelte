<script lang="ts">
  import { invalidateAll } from '$app/navigation';

  let { data } = $props();

  type SectionId = 'overview' | 'display' | 'ai' | 'location' | 'types' | 'inventory' | 'danger';

  const SECTIONS: { id: SectionId; icon: string; label: string; ownerOnly: boolean }[] = [
    { id: 'overview', icon: '📊', label: 'Overview', ownerOnly: false },
    { id: 'display', icon: '🖥', label: 'Display', ownerOnly: false },
    { id: 'ai', icon: '🤖', label: 'AI', ownerOnly: true },
    { id: 'location', icon: '🌍', label: 'Location & Climate', ownerOnly: true },
    { id: 'types', icon: '🏷', label: 'Types', ownerOnly: true },
    { id: 'inventory', icon: '📦', label: 'Inventory', ownerOnly: true },
    { id: 'danger', icon: '⚠️', label: 'Danger Zone', ownerOnly: true }
  ];

  const visibleSections = $derived(SECTIONS.filter((s) => !s.ownerOnly || data.isOwner));
  let active = $state<SectionId>('overview');

  // ─── Phase 15d — short-names regeneration ────────────────────────────────
  let shortNamesBusy = $state(false);
  let shortNamesStatus = $state<string | null>(null);
  let shortNamesError = $state(false);

  async function regenerateShortNames(force: boolean) {
    if (shortNamesBusy) return;
    if (force) {
      const ok = confirm(
        'Regenerate short names for ALL stock items? This overwrites every existing short name (including manual edits).'
      );
      if (!ok) return;
    }
    shortNamesBusy = true;
    shortNamesStatus = null;
    shortNamesError = false;
    try {
      const r = await fetch('/api/stock/short-names', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ force })
      });
      const j = await r.json();
      if (!r.ok) {
        shortNamesError = true;
        shortNamesStatus = `Error: ${j.error ?? r.statusText}`;
        return;
      }
      const usd = j.meta?.usdEstimate ? ` (~$${j.meta.usdEstimate.toFixed(3)})` : '';
      shortNamesStatus = `Generated ${j.updated} short name${j.updated === 1 ? '' : 's'}${usd}.`;
      await invalidateAll();
    } catch (e) {
      shortNamesError = true;
      shortNamesStatus = e instanceof Error ? e.message : 'request failed';
    } finally {
      shortNamesBusy = false;
    }
  }

  // ─── Phase 17 follow-up — AI Refresh from web (bulk) ─────────────────────
  // Mirrors the short-names regen flow: server-side iterates over stock
  // items missing canonical metadata, calls Claude+web_search per item, and
  // persists the returned fields. This is a PREVIEW dispatch — the server
  // does NOT auto-write changes; the operator reviews and applies each
  // item's diff from the inventory edit modal. The button surfaces a count
  // of items that would benefit + USD estimate so the operator can decide.
  let refreshBusy = $state(false);
  let refreshStatus = $state<string | null>(null);
  let refreshError = $state(false);
  let refreshLastResults = $state<Array<Record<string, unknown>> | null>(null);
  let refreshDiagnostics = $state<Record<
    string,
    { total: number; eligible: number; reasonWhenZero?: string }
  > | null>(null);
  let refreshOverflowed = $state(false);

  // Phase 17 follow-up — pending-suggestions panel state.
  interface PendingSummary {
    itemId: string;
    displayName: string;
    shortName?: string;
    category: string;
    pendingRefreshAt: number;
    ageMs: number;
    fieldCount: number;
    citationCount: number;
    fieldKeys: string[];
  }
  let pendingList = $state<PendingSummary[] | null>(null);
  let pendingBusy = $state(false);
  let pendingError = $state<string | null>(null);

  async function loadPendingSuggestions() {
    pendingBusy = true;
    pendingError = null;
    try {
      const r = await fetch('/api/stock/refresh-ai', { method: 'GET' });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        pendingError = j.error ?? `Load failed (${r.status})`;
        return;
      }
      const j = await r.json();
      pendingList = (j.pending ?? []) as PendingSummary[];
    } catch (e) {
      pendingError = e instanceof Error ? e.message : 'request failed';
    } finally {
      pendingBusy = false;
    }
  }

  async function discardPending(itemId: string) {
    if (!confirm('Discard this pending AI Refresh suggestion?')) return;
    try {
      const r = await fetch(`/api/stock/${itemId}/refresh-ai`, { method: 'DELETE' });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert(`Discard failed: ${j.error ?? r.statusText}`);
        return;
      }
      pendingList = pendingList?.filter((p) => p.itemId !== itemId) ?? null;
    } catch (e) {
      alert(e instanceof Error ? e.message : 'request failed');
    }
  }

  async function discardAllPending() {
    const count = pendingList?.length ?? 0;
    if (count === 0) return;
    if (
      !confirm(
        `Discard ALL ${count} pending AI Refresh suggestion${count === 1 ? '' : 's'}? This cannot be undone.`
      )
    )
      return;
    try {
      const r = await fetch('/api/stock/refresh-ai', { method: 'DELETE' });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert(`Discard failed: ${j.error ?? r.statusText}`);
        return;
      }
      pendingList = [];
    } catch (e) {
      alert(e instanceof Error ? e.message : 'request failed');
    }
  }

  function relativeAge(ms: number): string {
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const days = Math.round(hr / 24);
    return `${days}d ago`;
  }

  // ─── Settings-page Review popup state ───────────────────────────────────
  interface PendingResultField {
    value: unknown;
    sourceUrl?: string;
    sourceTitle?: string;
  }
  interface PendingResult {
    itemId: string;
    hasCitations: boolean;
    notes?: string;
    citations?: Array<{ url: string; title?: string }>;
    [k: string]: unknown;
  }
  let reviewing = $state<PendingSummary | null>(null);
  let reviewResult = $state<PendingResult | null>(null);
  let reviewAccept = $state<Record<string, boolean>>({});
  let reviewBusy = $state(false);
  let reviewError = $state<string | null>(null);

  async function openReview(p: PendingSummary) {
    reviewing = p;
    reviewResult = null;
    reviewError = null;
    reviewAccept = {};
    reviewBusy = true;
    try {
      const r = await fetch(`/api/stock/${p.itemId}/refresh-ai`, { method: 'GET' });
      const j = await r.json();
      if (!r.ok) {
        reviewError = j.error ?? `Load failed (${r.status})`;
        return;
      }
      const result = j.result as PendingResult | null;
      if (!result) {
        reviewError = 'This item no longer has a pending suggestion.';
        return;
      }
      reviewResult = result;
      const accept: Record<string, boolean> = {};
      for (const k of Object.keys(result)) {
        if (['itemId', 'hasCitations', 'notes', 'citations'].includes(k)) continue;
        accept[k] = true;
      }
      reviewAccept = accept;
    } catch (e) {
      reviewError = e instanceof Error ? e.message : 'request failed';
    } finally {
      reviewBusy = false;
    }
  }

  function closeReview() {
    reviewing = null;
    reviewResult = null;
    reviewAccept = {};
    reviewError = null;
    reviewBusy = false;
  }

  async function applyReview() {
    if (!reviewing || !reviewResult) return;
    const acceptedKeys = Object.entries(reviewAccept)
      .filter(([, v]) => v)
      .map(([k]) => k);
    reviewBusy = true;
    reviewError = null;
    try {
      const r = await fetch(`/api/stock/${reviewing.itemId}/refresh-ai/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ acceptedKeys })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        reviewError = j.error ?? `Apply failed (${r.status})`;
        return;
      }
      // Remove from pending list + close popup.
      const removedId = reviewing.itemId;
      pendingList = pendingList?.filter((p) => p.itemId !== removedId) ?? null;
      closeReview();
    } catch (e) {
      reviewError = e instanceof Error ? e.message : 'request failed';
    } finally {
      reviewBusy = false;
    }
  }

  async function discardReview() {
    if (!reviewing) return;
    if (!confirm('Discard this pending AI Refresh suggestion?')) return;
    reviewBusy = true;
    try {
      const r = await fetch(`/api/stock/${reviewing.itemId}/refresh-ai`, { method: 'DELETE' });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        reviewError = j.error ?? `Discard failed (${r.status})`;
        return;
      }
      const removedId = reviewing.itemId;
      pendingList = pendingList?.filter((p) => p.itemId !== removedId) ?? null;
      closeReview();
    } catch (e) {
      reviewError = e instanceof Error ? e.message : 'request failed';
    } finally {
      reviewBusy = false;
    }
  }

  function formatReviewValue(value: unknown): string {
    if (value == null) return '—';
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      const parts = value.map((v) => {
        if (v && typeof v === 'object' && 'name' in v) {
          const r = v as { name: string; concentrationPct?: number };
          return r.concentrationPct != null ? `${r.name} ${r.concentrationPct}%` : r.name;
        }
        return JSON.stringify(v);
      });
      return parts.join(', ');
    }
    if (typeof value === 'object') {
      const v = value as Record<string, unknown>;
      if ('n' in v && 'p' in v && 'k' in v) return `${v.n}-${v.p}-${v.k}`;
      return JSON.stringify(value);
    }
    return String(value);
  }

  function prettyKey(k: string): string {
    switch (k) {
      case 'daysToMaturity':
        return 'DTM';
      case 'plantingTempMinF':
        return 'soil temp';
      case 'spacingInches':
        return 'spacing';
      case 'depthInches':
        return 'depth';
      case 'sunRequirement':
        return 'sun';
      case 'seedsPerPacket':
        return 'seeds/pkt';
      case 'matureHeightFt':
        return 'height';
      case 'activeIngredients':
        return 'ingredients';
      case 'npk':
        return 'N-P-K';
      case 'formulationType':
        return 'formulation';
      case 'productClass':
        return 'class';
      default:
        return k;
    }
  }

  // Auto-load the pending list when the Inventory section becomes active.
  $effect(() => {
    if (active === 'inventory' && pendingList === null && !pendingBusy) {
      void loadPendingSuggestions();
    }
  });

  async function refreshAllMissingMetadata(forceAll = false) {
    if (refreshBusy) return;
    refreshBusy = true;
    refreshStatus = null;
    refreshError = false;
    refreshLastResults = null;
    refreshDiagnostics = null;
    refreshOverflowed = false;
    try {
      const r = await fetch('/api/stock/refresh-ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ onlyMissing: !forceAll })
      });
      const j = await r.json();
      if (!r.ok) {
        refreshError = true;
        refreshStatus = `Error: ${j.error ?? r.statusText}`;
        return;
      }
      refreshDiagnostics = j.meta?.diagnostics ?? null;
      refreshOverflowed = !!j.overflowed;
      const processed = j.processed ?? 0;
      const cites = j.withCitations ?? 0;
      const usd = j.meta?.totalUsd ? ` (~$${j.meta.totalUsd.toFixed(3)})` : '';
      if (processed === 0) {
        refreshStatus = j.meta?.message ?? 'No items processed.';
      } else {
        const overflowNote = j.overflowed
          ? ` — capped at the per-click limit; click again to continue.`
          : '';
        refreshStatus = `Looked up ${processed} item${processed === 1 ? '' : 's'}; ${cites} returned citations${usd}.${overflowNote} Open each in /stock to review and apply.`;
      }
      refreshLastResults = j.results ?? [];
      // After a bulk run, reload the pending-suggestions panel so the
      // newly captured items appear immediately without a manual click.
      void loadPendingSuggestions();
    } catch (e) {
      refreshError = true;
      refreshStatus = e instanceof Error ? e.message : 'request failed';
    } finally {
      refreshBusy = false;
    }
  }

  // ─── Generic settings helpers ────────────────────────────────────────────
  async function postSetting(
    key: string,
    value: unknown
  ): Promise<{ ok: boolean; message?: string }> {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, value })
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: out.message ?? out.error ?? 'Save failed' };
    return { ok: true };
  }

  async function deleteSetting(key: string): Promise<{ ok: boolean; message?: string }> {
    const res = await fetch(`/api/settings?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: out.message ?? out.error ?? 'Reset failed' };
    return { ok: true };
  }

  // ─── Types (taxonomy) ────────────────────────────────────────────────────
  type TaxonomyTerm = (typeof data.taxonomy)[0];

  const DOMAIN_LABELS: Record<string, string> = {
    'inventory:seed': '🌱 Inventory — Seed types',
    'inventory:herbicide': '🧪 Inventory — Herbicide types',
    'inventory:insecticide': '🐛 Inventory — Insecticide types',
    'inventory:fungicide': '🍄 Inventory — Fungicide types',
    'inventory:fertilizer': '🌿 Inventory — Fertilizer types',
    'inventory:adjuvant': '💧 Inventory — Adjuvant types',
    'inventory:fuel': '⛽ Inventory — Fuel types',
    'inventory:part': '🔧 Inventory — Part types',
    equipment: '🚜 Equipment types'
  };

  const KNOWN_DOMAINS = [
    'inventory:seed',
    'inventory:herbicide',
    'inventory:insecticide',
    'inventory:fungicide',
    'inventory:fertilizer',
    'inventory:adjuvant',
    'inventory:fuel',
    'inventory:part',
    'equipment'
  ];

  const termsByDomain = $derived.by(() => {
    const m = new Map<string, TaxonomyTerm[]>();
    for (const d of KNOWN_DOMAINS) m.set(d, []);
    for (const t of data.taxonomy) {
      const list = m.get(t.domain) ?? [];
      list.push(t);
      m.set(t.domain, list);
    }
    return m;
  });

  let openDomain = $state<string | null>(null);
  let newTermName = $state('');
  let newTermDescription = $state('');
  let typesBusy = $state(false);
  let typesError = $state<string | null>(null);

  let editingId = $state<string | null>(null);
  let editName = $state('');
  let editDescription = $state('');

  function startAdd(domain: string) {
    openDomain = domain;
    newTermName = '';
    newTermDescription = '';
    typesError = null;
  }

  async function saveNewTerm(domain: string) {
    if (!newTermName.trim()) return;
    typesBusy = true;
    typesError = null;
    try {
      const res = await fetch('/api/types', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          domain,
          name: newTermName.trim(),
          description: newTermDescription.trim() || undefined
        })
      });
      const out = await res.json();
      if (!res.ok) {
        typesError = out.error ?? 'Save failed';
        return;
      }
      newTermName = '';
      newTermDescription = '';
      openDomain = null;
      await invalidateAll();
    } catch (e) {
      typesError = e instanceof Error ? e.message : String(e);
    } finally {
      typesBusy = false;
    }
  }

  function startEdit(term: TaxonomyTerm) {
    editingId = term.id;
    editName = term.name;
    editDescription = term.description ?? '';
    typesError = null;
  }

  async function saveEditTerm() {
    if (!editingId) return;
    typesBusy = true;
    typesError = null;
    try {
      const res = await fetch(`/api/types/${editingId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim() || null
        })
      });
      const out = await res.json();
      if (!res.ok) {
        typesError = out.error ?? 'Save failed';
        return;
      }
      editingId = null;
      await invalidateAll();
    } catch (e) {
      typesError = e instanceof Error ? e.message : String(e);
    } finally {
      typesBusy = false;
    }
  }

  async function deleteTerm(term: TaxonomyTerm) {
    if (
      !confirm(
        `Delete the Type "${term.name}"? Items currently linked to it keep their data but lose the Type label.`
      )
    )
      return;
    typesBusy = true;
    typesError = null;
    try {
      const res = await fetch(`/api/types/${term.id}`, { method: 'DELETE' });
      const out = await res.json();
      if (!res.ok) {
        typesError = out.error ?? 'Delete failed';
        return;
      }
      await invalidateAll();
    } catch (e) {
      typesError = e instanceof Error ? e.message : String(e);
    } finally {
      typesBusy = false;
    }
  }

  // ─── API key form ────────────────────────────────────────────────────────
  let apiKeyInput = $state('');
  let apiKeyBusy = $state(false);
  let apiKeyResult = $state<string | null>(null);
  let apiKeyError = $state<string | null>(null);

  async function saveApiKey() {
    if (!apiKeyInput.trim()) return;
    apiKeyBusy = true;
    apiKeyResult = null;
    apiKeyError = null;
    const r = await postSetting('anthropic_api_key', apiKeyInput.trim());
    if (!r.ok) {
      apiKeyError = r.message ?? 'Save failed';
      apiKeyBusy = false;
      return;
    }
    apiKeyResult = 'API key saved.';
    apiKeyInput = '';
    apiKeyBusy = false;
    await invalidateAll();
  }

  async function clearApiKey() {
    apiKeyBusy = true;
    apiKeyResult = null;
    apiKeyError = null;
    const r = await deleteSetting('anthropic_api_key');
    if (!r.ok) {
      apiKeyError = r.message ?? 'Clear failed';
      apiKeyBusy = false;
      return;
    }
    apiKeyResult = 'API key cleared.';
    apiKeyBusy = false;
    await invalidateAll();
  }

  // ─── AI cap + quota forms (owner-only) ───────────────────────────────────
  let monthlyCapInput = $state(0);
  let monthlyCapBusy = $state(false);
  let monthlyCapMsg = $state<{ kind: 'ok' | 'err'; text: string } | null>(null);

  $effect(() => {
    monthlyCapInput = data.ai?.monthlyUsdCap ?? 0;
  });

  async function saveMonthlyCap() {
    monthlyCapBusy = true;
    monthlyCapMsg = null;
    const value = Number(monthlyCapInput);
    if (!Number.isFinite(value) || value < 0) {
      monthlyCapMsg = { kind: 'err', text: 'Cap must be a non-negative number.' };
      monthlyCapBusy = false;
      return;
    }
    const r = await postSetting('ai_monthly_usd_cap', value);
    if (!r.ok) {
      monthlyCapMsg = { kind: 'err', text: r.message ?? 'Save failed' };
    } else {
      monthlyCapMsg = { kind: 'ok', text: 'Monthly cap saved.' };
      await invalidateAll();
    }
    monthlyCapBusy = false;
  }

  async function resetMonthlyCap() {
    monthlyCapBusy = true;
    monthlyCapMsg = null;
    const r = await deleteSetting('ai_monthly_usd_cap');
    if (!r.ok) {
      monthlyCapMsg = { kind: 'err', text: r.message ?? 'Reset failed' };
    } else {
      monthlyCapMsg = {
        kind: 'ok',
        text: `Reset to default $${data.ai?.monthlyUsdCapDefault.toFixed(2)}.`
      };
      await invalidateAll();
    }
    monthlyCapBusy = false;
  }

  type QuotaKind = 'suggest' | 'succession' | 'optimize' | 'allocate';
  const QUOTA_LABELS: Record<QuotaKind, { label: string; help: string }> = {
    suggest: {
      label: 'Suggest',
      help: 'Plant suggestions on the Plan tab — recommends what to grow next given soil + frost.'
    },
    succession: {
      label: 'Succession',
      help: 'Recommends second/third plantings of the same crop across the season.'
    },
    optimize: {
      label: 'Optimize',
      help: 'Whole-farm optimizer — re-balances all swim-lane assignments. Heaviest model call.'
    },
    allocate: {
      label: 'Allocate',
      help: 'Seed-to-block AI allocation wizard (Crops tab, UC-37).'
    }
  };

  let quotaInputs = $state<Record<QuotaKind, number>>({
    suggest: 0,
    succession: 0,
    optimize: 0,
    allocate: 0
  });
  let quotaBusy = $state(false);
  let quotaMsg = $state<{ kind: 'ok' | 'err'; text: string } | null>(null);

  $effect(() => {
    if (data.ai) {
      quotaInputs = { ...data.ai.dailyQuota };
    }
  });

  async function saveQuotas() {
    quotaBusy = true;
    quotaMsg = null;
    for (const k of ['suggest', 'succession', 'optimize', 'allocate'] as QuotaKind[]) {
      const v = Number(quotaInputs[k]);
      if (!Number.isInteger(v) || v < 0) {
        quotaMsg = {
          kind: 'err',
          text: `${QUOTA_LABELS[k].label}: must be a non-negative whole number.`
        };
        quotaBusy = false;
        return;
      }
    }
    const r = await postSetting('ai_daily_call_quota', {
      suggest: Number(quotaInputs.suggest),
      succession: Number(quotaInputs.succession),
      optimize: Number(quotaInputs.optimize),
      allocate: Number(quotaInputs.allocate)
    });
    if (!r.ok) {
      quotaMsg = { kind: 'err', text: r.message ?? 'Save failed' };
    } else {
      quotaMsg = { kind: 'ok', text: 'Daily quotas saved.' };
      await invalidateAll();
    }
    quotaBusy = false;
  }

  async function resetQuotas() {
    quotaBusy = true;
    quotaMsg = null;
    const r = await deleteSetting('ai_daily_call_quota');
    if (!r.ok) {
      quotaMsg = { kind: 'err', text: r.message ?? 'Reset failed' };
    } else {
      quotaMsg = { kind: 'ok', text: 'Reset to defaults.' };
      await invalidateAll();
    }
    quotaBusy = false;
  }

  // ─── Location & climate (owner-only) ─────────────────────────────────────
  let latInput = $state(0);
  let lonInput = $state(0);
  let lastFrostInput = $state('04-15');
  let firstFrostInput = $state('10-15');
  let locationBusy = $state(false);
  let locationMsg = $state<{ kind: 'ok' | 'err'; text: string } | null>(null);

  $effect(() => {
    if (data.location) {
      latInput = data.location.farmLatLon.lat;
      lonInput = data.location.farmLatLon.lon;
      lastFrostInput = data.location.lastFrostMmDd;
      firstFrostInput = data.location.firstFrostMmDd;
    }
  });

  const mmDdRe = /^(0?[1-9]|1[0-2])-(0?[1-9]|[12][0-9]|3[01])$/;

  async function saveLatLon() {
    locationBusy = true;
    locationMsg = null;
    const lat = Number(latInput);
    const lon = Number(lonInput);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      locationMsg = { kind: 'err', text: 'Latitude must be between -90 and 90.' };
      locationBusy = false;
      return;
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      locationMsg = { kind: 'err', text: 'Longitude must be between -180 and 180.' };
      locationBusy = false;
      return;
    }
    const r = await postSetting('farm_lat_lon', { lat, lon });
    if (!r.ok) {
      locationMsg = { kind: 'err', text: r.message ?? 'Save failed' };
    } else {
      locationMsg = { kind: 'ok', text: 'Farm location saved.' };
      await invalidateAll();
    }
    locationBusy = false;
  }

  async function resetLatLon() {
    locationBusy = true;
    locationMsg = null;
    const r = await deleteSetting('farm_lat_lon');
    if (!r.ok) {
      locationMsg = { kind: 'err', text: r.message ?? 'Reset failed' };
    } else {
      locationMsg = { kind: 'ok', text: 'Farm location reset to default.' };
      await invalidateAll();
    }
    locationBusy = false;
  }

  async function saveFrostDates() {
    locationBusy = true;
    locationMsg = null;
    if (!mmDdRe.test(lastFrostInput)) {
      locationMsg = { kind: 'err', text: 'Last frost: expected MM-DD (e.g., 04-15).' };
      locationBusy = false;
      return;
    }
    if (!mmDdRe.test(firstFrostInput)) {
      locationMsg = { kind: 'err', text: 'First frost: expected MM-DD (e.g., 10-15).' };
      locationBusy = false;
      return;
    }
    const r1 = await postSetting('last_frost_date', lastFrostInput);
    if (!r1.ok) {
      locationMsg = { kind: 'err', text: r1.message ?? 'Save failed' };
      locationBusy = false;
      return;
    }
    const r2 = await postSetting('first_frost_date', firstFrostInput);
    if (!r2.ok) {
      locationMsg = { kind: 'err', text: r2.message ?? 'Save failed' };
      locationBusy = false;
      return;
    }
    locationMsg = { kind: 'ok', text: 'Frost dates saved.' };
    await invalidateAll();
    locationBusy = false;
  }

  async function resetFrostDates() {
    locationBusy = true;
    locationMsg = null;
    await deleteSetting('last_frost_date');
    await deleteSetting('first_frost_date');
    locationMsg = { kind: 'ok', text: 'Frost dates reset to defaults.' };
    await invalidateAll();
    locationBusy = false;
  }

  // ─── Wipe form ───────────────────────────────────────────────────────────
  let confirmText = $state('');
  let keepEquipment = $state(false);
  let keepWeatherCache = $state(true);
  let busy = $state(false);
  let result = $state<string | null>(null);
  let error = $state<string | null>(null);

  async function wipe() {
    busy = true;
    error = null;
    result = null;
    try {
      const res = await fetch('/api/admin/wipe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          confirm: confirmText,
          keepEquipment,
          keepWeatherCache
        })
      });
      const out = await res.json();
      if (!res.ok) {
        error = out.error ?? 'wipe failed';
        return;
      }
      const summary = Object.entries(out.removed)
        .filter(([, n]) => (n as number) > 0)
        .map(([k, n]) => `${k}: ${n}`)
        .join(', ');
      result = `Wiped — ${summary || 'nothing to remove'}`;
      confirmText = '';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  // ─── Display preferences ────────────────────────────────────────────────
  let displayBusy = $state(false);
  let displayMsg = $state<{ kind: 'ok' | 'err'; text: string } | null>(null);
  /** Local mirrors for optimistic updates; fall back to server-loaded values. */
  let showShadeMarkersOverride = $state<boolean | null>(null);
  let reorderLevelOverride = $state<boolean | null>(null);
  let planterSetupOverride = $state<boolean | null>(null);
  const showShadeMarkers = $derived(
    showShadeMarkersOverride ?? data.display?.showShadeMarkers ?? true
  );
  const reorderLevelDisplay = $derived(reorderLevelOverride ?? data.display?.reorderLevel ?? false);
  const planterSetupDisplay = $derived(planterSetupOverride ?? data.display?.planterSetup ?? true);

  async function saveDisplayToggle(
    key: 'show_shade_markers' | 'display_reorder_level' | 'display_planter_setup',
    next: boolean,
    okMsg: { on: string; off: string },
    setOverride: (v: boolean | null) => void,
    currentValue: boolean
  ) {
    if (displayBusy) return;
    displayBusy = true;
    displayMsg = null;
    setOverride(next);
    try {
      const r = await postSetting(key, next);
      if (!r.ok) {
        displayMsg = { kind: 'err', text: r.message ?? 'Failed to save.' };
        setOverride(currentValue);
        return;
      }
      displayMsg = { kind: 'ok', text: next ? okMsg.on : okMsg.off };
      await invalidateAll();
      setOverride(null);
    } catch (e) {
      displayMsg = { kind: 'err', text: e instanceof Error ? e.message : String(e) };
      setOverride(currentValue);
    } finally {
      displayBusy = false;
    }
  }

  function saveShowShadeMarkers(next: boolean) {
    return saveDisplayToggle(
      'show_shade_markers',
      next,
      { on: 'Shade markers enabled.', off: 'Shade markers hidden.' },
      (v) => (showShadeMarkersOverride = v),
      showShadeMarkers
    );
  }
  function saveReorderLevel(next: boolean) {
    return saveDisplayToggle(
      'display_reorder_level',
      next,
      { on: 'Reorder level field shown on inventory edit.', off: 'Reorder level field hidden.' },
      (v) => (reorderLevelOverride = v),
      reorderLevelDisplay
    );
  }
  function savePlanterSetup(next: boolean) {
    return saveDisplayToggle(
      'display_planter_setup',
      next,
      { on: 'Planter setup section shown for seeds.', off: 'Planter setup section hidden.' },
      (v) => (planterSetupOverride = v),
      planterSetupDisplay
    );
  }
</script>

<div class="settings-shell">
  <aside class="sidebar" aria-label="Settings sections">
    <h1>Settings</h1>
    <nav>
      {#each visibleSections as s (s.id)}
        <button
          class="nav-item"
          class:active={active === s.id}
          aria-current={active === s.id ? 'page' : undefined}
          onclick={() => (active = s.id)}
        >
          <span class="nav-icon" aria-hidden="true">{s.icon}</span>
          <span class="nav-label">{s.label}</span>
        </button>
      {/each}
      <a class="nav-item nav-link" href="/plugins">
        <span class="nav-icon" aria-hidden="true">🧩</span>
        <span class="nav-label">Plugins</span>
      </a>
      <a class="nav-item nav-link" href="/calibrate">
        <span class="nav-icon" aria-hidden="true">📏</span>
        <span class="nav-label">Calibrate</span>
      </a>
    </nav>
  </aside>

  <section class="detail">
    {#if active === 'overview'}
      <header class="detail-header">
        <h2>Overview</h2>
        <p class="lede">Snapshot of the records currently in this farm's database.</p>
      </header>
      <div class="card">
        <dl class="counts">
          <dt>Blocks</dt>
          <dd>{data.counts.blocks}</dd>
          <dt>Crops (all statuses)</dt>
          <dd>{data.counts.crops}</dd>
          <dt>Equipment</dt>
          <dd>{data.counts.equipment}</dd>
          <dt>Stock SKUs</dt>
          <dd>{data.counts.stockItems}</dd>
        </dl>
      </div>
    {/if}

    {#if active === 'display'}
      <header class="detail-header">
        <h2>Display</h2>
        <p class="lede">
          View preferences for the Plan→Schedule swim-lane and the inventory edit modal.
        </p>
      </header>

      <div class="card">
        <h3>Inventory: Reorder level</h3>
        <p class="muted">
          Show the per-item Reorder-level checkbox + threshold field on the inventory edit modal.
          Off by default — most operators rely on visual inspection rather than per-SKU thresholds.
          Stored values are preserved when hidden.
        </p>
        <label class="checkbox">
          <input
            type="checkbox"
            checked={reorderLevelDisplay}
            disabled={displayBusy || !data.isOwner}
            onchange={(e) => saveReorderLevel((e.currentTarget as HTMLInputElement).checked)}
          />
          <span>Show Reorder level field on inventory edit</span>
        </label>
        {#if !data.isOwner}
          <p class="muted">Owner-only setting.</p>
        {/if}
      </div>

      <div class="card">
        <h3>Inventory: Planter setup</h3>
        <p class="muted">
          Show the Planter setup subsection (plate number, color, dimensions, seed dimensions in mm)
          on the inventory edit modal for seed items. On by default. The data is still persisted in <code
            >metadataJson</code
          > when hidden — the toggle only affects display.
        </p>
        <label class="checkbox">
          <input
            type="checkbox"
            checked={planterSetupDisplay}
            disabled={displayBusy || !data.isOwner}
            onchange={(e) => savePlanterSetup((e.currentTarget as HTMLInputElement).checked)}
          />
          <span>Show Planter setup section for seed items</span>
        </label>
        {#if !data.isOwner}
          <p class="muted">Owner-only setting.</p>
        {/if}
      </div>

      <div class="card">
        <h3>Shade markers</h3>
        <p class="muted">
          Shows where tall crops (corn, sunflower, sorghum, anything with mature height ≥ 5 ft)
          project shadow onto adjacent blocks during the second half of their growing window.
          Computed from each block's physical east-west index — independent of the swim-lane column
          visual order, so dragging a column to a new position does not change the underlying field
          shading.
        </p>
        <label class="checkbox">
          <input
            type="checkbox"
            checked={showShadeMarkers}
            disabled={displayBusy || !data.isOwner}
            onchange={(e) => saveShowShadeMarkers((e.currentTarget as HTMLInputElement).checked)}
          />
          <span>Show shade markers on schedule</span>
        </label>
        {#if !data.isOwner}
          <p class="muted">
            Owner-only setting. Helpers see the current state but cannot change it.
          </p>
        {/if}
        {#if displayMsg}
          <p class={displayMsg.kind === 'ok' ? 'success' : 'error'}>{displayMsg.text}</p>
        {/if}
      </div>

      <div class="card">
        <h3>Shade sources</h3>
        <p class="muted">
          Tree rows, groves, hedges, fences, and buildings are managed on the Plan→Layout tab where
          they can be drawn directly on the map. Right-click a row on the map to remove it; the
          toolbar above the map exposes <strong>🌳 Tree row</strong> and
          <strong>⬛ Grove/building</strong>
          draw buttons.
        </p>
        <p>
          <a href="/plan?tab=layout">Open Plan → Layout</a>
        </p>
      </div>
    {/if}

    {#if active === 'ai' && data.isOwner && data.ai}
      <header class="detail-header">
        <h2>AI</h2>
        <p class="lede">
          Configure the Anthropic key, the monthly USD cap, and per-endpoint daily call quotas. The
          guard rejects calls that would exceed either limit.
        </p>
      </header>

      <div class="card">
        <h3>Anthropic API key</h3>
        <p class="muted">
          Used by the barcode label reader and the Plan-Schedule AI features. The key is stored in
          the local database; it never leaves the server.
          {#if data.anthropicKeyFromEnv}
            <strong>An environment-variable key is active</strong> — the stored value below is a fallback.
          {:else if data.anthropicKeySet}
            A key is currently stored. Enter a new value below to replace it.
          {:else}
            No key is set yet.
          {/if}
        </p>
        <label class="field">
          <span class="field-label">API key</span>
          <input
            type="password"
            bind:value={apiKeyInput}
            placeholder={data.anthropicKeySet
              ? '••••••••  (key stored — paste to replace)'
              : 'sk-ant-…'}
            autocomplete="off"
            spellcheck="false"
          />
        </label>
        <div class="actions">
          <button class="primary" onclick={saveApiKey} disabled={apiKeyBusy || !apiKeyInput.trim()}>
            {apiKeyBusy ? '…' : 'Save key'}
          </button>
          {#if data.anthropicKeySet}
            <button class="secondary danger-text" onclick={clearApiKey} disabled={apiKeyBusy}>
              Clear stored key
            </button>
          {/if}
        </div>
        {#if apiKeyResult}<p class="success">{apiKeyResult}</p>{/if}
        {#if apiKeyError}<p class="error">{apiKeyError}</p>{/if}
      </div>

      <div class="card">
        <h3>Monthly USD cap</h3>
        <p class="muted">
          Hard ceiling on AI spend per calendar month (UTC). Once spend reaches the cap, all AI
          endpoints return 402 until the next month rolls over.
        </p>

        <div class="spend-widget" aria-label="Monthly spend so far">
          <div class="spend-row">
            <span class="spend-label">Spent this month</span>
            <span class="spend-value">${data.ai.spend.monthlyUsdSoFar.toFixed(2)}</span>
          </div>
          <div class="spend-row">
            <span class="spend-label">Cap</span>
            <span class="spend-value">${data.ai.spend.cap.toFixed(2)}</span>
          </div>
          <div class="spend-bar" aria-hidden="true">
            <div
              class="spend-bar-fill"
              class:warn={data.ai.spend.warnAt80}
              style="width: {Math.min(100, data.ai.spend.pctUsed * 100).toFixed(1)}%"
            ></div>
          </div>
          <div class="spend-meta">{(data.ai.spend.pctUsed * 100).toFixed(0)}% of cap used</div>
        </div>

        <label class="field">
          <span class="field-label">Cap (USD / month)</span>
          <input
            type="number"
            min="0"
            step="0.50"
            bind:value={monthlyCapInput}
            inputmode="decimal"
          />
        </label>
        <div class="actions">
          <button class="primary" onclick={saveMonthlyCap} disabled={monthlyCapBusy}>
            {monthlyCapBusy ? '…' : 'Save cap'}
          </button>
          <button class="secondary" onclick={resetMonthlyCap} disabled={monthlyCapBusy}>
            Reset to default (${data.ai.monthlyUsdCapDefault.toFixed(2)})
          </button>
        </div>
        {#if monthlyCapMsg}
          <p class={monthlyCapMsg.kind === 'ok' ? 'success' : 'error'}>{monthlyCapMsg.text}</p>
        {/if}
      </div>

      <div class="card">
        <h3>Daily call quotas</h3>
        <p class="muted">
          Per-user, per-endpoint, per-UTC-day request budget. Calls beyond the budget return 429
          until the next day. Set to 0 to disable an endpoint entirely.
        </p>

        {#each ['suggest', 'succession', 'optimize', 'allocate'] as kind (kind)}
          {@const k = kind as QuotaKind}
          <div class="quota-row">
            <div class="quota-info">
              <div class="quota-name">{QUOTA_LABELS[k].label}</div>
              <div class="quota-help">{QUOTA_LABELS[k].help}</div>
              <div class="quota-default">Default: {data.ai.dailyQuotaDefault[k]}</div>
            </div>
            <input
              class="quota-input"
              type="number"
              min="0"
              step="1"
              bind:value={quotaInputs[k]}
              inputmode="numeric"
              aria-label="{QUOTA_LABELS[k].label} daily quota"
            />
          </div>
        {/each}

        <div class="actions">
          <button class="primary" onclick={saveQuotas} disabled={quotaBusy}>
            {quotaBusy ? '…' : 'Save quotas'}
          </button>
          <button class="secondary" onclick={resetQuotas} disabled={quotaBusy}>
            Reset all to defaults
          </button>
        </div>
        {#if quotaMsg}
          <p class={quotaMsg.kind === 'ok' ? 'success' : 'error'}>{quotaMsg.text}</p>
        {/if}
      </div>
    {/if}

    {#if active === 'location' && data.isOwner && data.location}
      <header class="detail-header">
        <h2>Location & Climate</h2>
        <p class="lede">
          Farm coordinates feed the NOAA NWS forecast (Hay tab + Plan-Schedule). Frost dates anchor
          the season calendar engine and seed-suggestion windows.
        </p>
      </header>

      <div class="card">
        <h3>Farm coordinates</h3>
        <p class="muted">
          Used as the cache key for the NOAA forecast. Defaults to Loudoun County, VA ({data.location.farmLatLonDefault.lat.toFixed(
            2
          )},
          {data.location.farmLatLonDefault.lon.toFixed(2)}).
        </p>
        <div class="grid-2">
          <label class="field">
            <span class="field-label">Latitude</span>
            <input type="number" step="0.0001" bind:value={latInput} inputmode="decimal" />
          </label>
          <label class="field">
            <span class="field-label">Longitude</span>
            <input type="number" step="0.0001" bind:value={lonInput} inputmode="decimal" />
          </label>
        </div>
        <div class="actions">
          <button class="primary" onclick={saveLatLon} disabled={locationBusy}>
            {locationBusy ? '…' : 'Save coordinates'}
          </button>
          <button class="secondary" onclick={resetLatLon} disabled={locationBusy}>
            Reset to default
          </button>
        </div>
      </div>

      <div class="card">
        <h3>Frost dates</h3>
        <p class="muted">
          Average last spring frost and first fall frost as <code>MM-DD</code>. Defaults are Loudoun
          County (04-15 / 10-15).
        </p>
        <div class="grid-2">
          <label class="field">
            <span class="field-label">Last spring frost (MM-DD)</span>
            <input
              type="text"
              bind:value={lastFrostInput}
              placeholder="04-15"
              inputmode="numeric"
            />
          </label>
          <label class="field">
            <span class="field-label">First fall frost (MM-DD)</span>
            <input
              type="text"
              bind:value={firstFrostInput}
              placeholder="10-15"
              inputmode="numeric"
            />
          </label>
        </div>
        <div class="actions">
          <button class="primary" onclick={saveFrostDates} disabled={locationBusy}>
            {locationBusy ? '…' : 'Save frost dates'}
          </button>
          <button class="secondary" onclick={resetFrostDates} disabled={locationBusy}>
            Reset to defaults
          </button>
        </div>
      </div>

      {#if locationMsg}
        <p class={locationMsg.kind === 'ok' ? 'success' : 'error'}>{locationMsg.text}</p>
      {/if}
    {/if}

    {#if active === 'types' && data.isOwner}
      <header class="detail-header">
        <h2>Types</h2>
        <p class="lede">
          Configurable Type lists drive the sub-categorization on Inventory and the type chips on
          Equipment. Default Types are seeded from the canonical agronomy taxonomy and can be
          renamed but not deleted; user-added Types can be edited or removed at any time.
        </p>
      </header>

      <div class="card">
        {#if typesError}<p class="error">{typesError}</p>{/if}

        {#each KNOWN_DOMAINS as domain (domain)}
          {@const terms = termsByDomain.get(domain) ?? []}
          <details class="types-domain" open>
            <summary>
              <span class="domain-label">{DOMAIN_LABELS[domain] ?? domain}</span>
              <span class="domain-count">{terms.length}</span>
            </summary>

            {#if terms.length === 0}
              <p class="empty-types">No Types yet — add the first one below.</p>
            {:else}
              <ul class="type-list">
                {#each terms as term (term.id)}
                  <li class="type-row">
                    {#if editingId === term.id}
                      <div class="type-edit">
                        <input type="text" bind:value={editName} placeholder="Name" />
                        <input
                          type="text"
                          bind:value={editDescription}
                          placeholder="Description (optional)"
                        />
                        <button
                          class="primary tiny"
                          onclick={saveEditTerm}
                          disabled={typesBusy || !editName.trim()}>Save</button
                        >
                        <button class="secondary tiny" onclick={() => (editingId = null)}
                          >Cancel</button
                        >
                      </div>
                    {:else}
                      <div class="type-info">
                        <span class="type-name">{term.name}</span>
                        {#if term.isDefault}<span class="badge default">default</span>{/if}
                        {#if term.description}<span class="type-desc">{term.description}</span>{/if}
                      </div>
                      <div class="type-actions">
                        <button class="secondary tiny" onclick={() => startEdit(term)}>Edit</button>
                        {#if !term.isDefault}
                          <button class="danger-btn tiny" onclick={() => deleteTerm(term)}
                            >Delete</button
                          >
                        {/if}
                      </div>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}

            {#if openDomain === domain}
              <div class="add-form">
                <input type="text" bind:value={newTermName} placeholder="New Type name" />
                <input
                  type="text"
                  bind:value={newTermDescription}
                  placeholder="Description (optional)"
                />
                <button
                  class="primary tiny"
                  onclick={() => saveNewTerm(domain)}
                  disabled={typesBusy || !newTermName.trim()}>Add</button
                >
                <button class="secondary tiny" onclick={() => (openDomain = null)}>Cancel</button>
              </div>
            {:else}
              <button class="secondary tiny add-type-btn" onclick={() => startAdd(domain)}
                >+ Add Type</button
              >
            {/if}
          </details>
        {/each}
      </div>
    {/if}

    {#if active === 'inventory' && data.isOwner}
      <header class="detail-header">
        <h2>Inventory</h2>
        <p class="lede">
          Maintenance actions for the stock catalog. Run these occasionally to keep the schedule UI
          tidy.
        </p>
      </header>

      <div class="card">
        <h3>Short names</h3>
        <p class="lede">
          The schedule swim-lane and group wizard render a short label per stock item to keep bars
          readable. New items get one automatically from the AI label scan; this action regenerates
          short names for items that don't have one (or, with the second button, replaces ALL short
          names — including manual edits).
        </p>
        <div class="actions-row">
          <button
            type="button"
            class="primary"
            onclick={() => regenerateShortNames(false)}
            disabled={shortNamesBusy}
          >
            {shortNamesBusy
              ? 'Generating…'
              : `✨ Generate missing (${data.shortNamesMissing ?? 0})`}
          </button>
          <button
            type="button"
            class="secondary"
            onclick={() => regenerateShortNames(true)}
            disabled={shortNamesBusy || (data.shortNamesTotal ?? 0) === 0}
          >
            {shortNamesBusy ? 'Regenerating…' : `Regenerate all (${data.shortNamesTotal ?? 0})`}
          </button>
        </div>
        {#if shortNamesStatus}
          <p class="status-line" class:status-error={shortNamesError}>{shortNamesStatus}</p>
        {/if}
        <p class="hint">
          Uses Haiku 4.5 (~$0.001 per 50 items). Daily quota lives on the AI tab. Manual edits via
          the Stock edit modal stay; the second button overwrites them.
        </p>
      </div>

      <div class="card">
        <h3>Refresh metadata from web</h3>
        <p class="lede">
          Look up canonical specs for stock items missing metadata — DTM and plant spacing for
          seeds, active ingredients for chems, N-P-K for fertilizers. Uses Claude Sonnet with the
          web search tool so every field comes back with a citation. Capped at 25 items per click.
          Returned data is staged for review; nothing persists until you open each item in <code
            >/stock</code
          >
          and click <strong>Apply selected</strong>.
        </p>
        <div class="actions-row">
          <button
            type="button"
            class="primary"
            onclick={() => refreshAllMissingMetadata(false)}
            disabled={refreshBusy}
          >
            {refreshBusy ? 'Looking up…' : '🔍 Look up missing metadata'}
          </button>
          <button
            type="button"
            class="secondary"
            onclick={() => refreshAllMissingMetadata(true)}
            disabled={refreshBusy}
            title="Run AI Refresh on every eligible category, even items that already carry the key field. Costs more — use when you want second-opinion citations."
          >
            {refreshBusy ? '…' : 'Refresh all anyway'}
          </button>
        </div>
        {#if refreshStatus}
          <p class="status-line" class:status-error={refreshError}>{refreshStatus}</p>
        {/if}
        {#if refreshDiagnostics && Object.keys(refreshDiagnostics).length > 0}
          <details class="hint" open={refreshLastResults?.length === 0}>
            <summary>Inventory breakdown (why items were / weren't eligible)</summary>
            <ul>
              {#each Object.entries(refreshDiagnostics) as [cat, slot]}
                <li>
                  <strong>{cat}</strong>: {slot.eligible} of {slot.total} eligible
                  {#if slot.reasonWhenZero}<span class="muted"> — {slot.reasonWhenZero}</span>{/if}
                </li>
              {/each}
            </ul>
          </details>
        {/if}
        {#if refreshLastResults && refreshLastResults.length > 0}
          <details class="hint">
            <summary>Items that came back with citations</summary>
            <ul>
              {#each refreshLastResults as r}
                {@const id = (r as { itemId: string }).itemId}
                {@const cites =
                  (r as { citations?: Array<{ url: string; title?: string }> }).citations ?? []}
                <li>
                  <a href={`/stock/${id}`}>{id}</a> — {cites.length} citation{cites.length === 1
                    ? ''
                    : 's'}
                </li>
              {/each}
            </ul>
          </details>
        {/if}
        <p class="hint">
          Sonnet + web_search runs ~$0.02–0.05 per item depending on search count. Daily quota lives
          on the AI tab.
        </p>
      </div>

      <div class="card">
        <div class="pending-header">
          <h3>Pending AI Refresh suggestions</h3>
          <button
            type="button"
            class="secondary pending-refresh-btn"
            onclick={loadPendingSuggestions}
            disabled={pendingBusy}
            title="Re-fetch the list of items with pending suggestions"
          >
            {pendingBusy ? '…' : '↻ Reload'}
          </button>
        </div>
        <p class="lede">
          Every item with an unreviewed AI Refresh suggestion sits here until you Apply or Discard
          it from the stock edit modal. Click <strong>Review</strong>
          to open the item; the diff panel pre-loads with the captured fields and citations.
        </p>
        {#if pendingError}
          <p class="status-line status-error">{pendingError}</p>
        {/if}
        {#if pendingList === null}
          <p class="hint">{pendingBusy ? 'Loading…' : 'Click Reload to fetch.'}</p>
        {:else if pendingList.length === 0}
          <p class="hint">
            No pending suggestions. Run <strong>Look up missing metadata</strong> above, or click
            <strong>🔍 Refresh from web</strong>
            on any item in <a href="/stock">/stock</a>.
          </p>
        {:else}
          <div class="actions-row">
            <span class="muted"
              >{pendingList.length} item{pendingList.length === 1 ? '' : 's'} awaiting review</span
            >
            <button type="button" class="secondary" onclick={discardAllPending}>Discard all</button>
          </div>
          <ul class="pending-list">
            {#each pendingList as p (p.itemId)}
              <li class="pending-row">
                <div class="pending-row-main">
                  <span class="pending-row-name">{p.shortName ?? p.displayName}</span>
                  <span class="pending-row-meta">
                    <span class="pending-pill">{p.category}</span>
                    <span class="muted">{p.fieldCount} field{p.fieldCount === 1 ? '' : 's'}</span>
                    <span class="muted">·</span>
                    <span class="muted"
                      >{p.citationCount} citation{p.citationCount === 1 ? '' : 's'}</span
                    >
                    <span class="muted">·</span>
                    <span class="muted">{relativeAge(p.ageMs)}</span>
                  </span>
                  {#if p.fieldKeys.length > 0}
                    <span class="pending-row-fields">{p.fieldKeys.map(prettyKey).join(', ')}</span>
                  {/if}
                </div>
                <div class="pending-row-actions">
                  <button type="button" class="pending-review-btn" onclick={() => openReview(p)}
                    >Review</button
                  >
                  <button type="button" class="secondary" onclick={() => discardPending(p.itemId)}
                    >Discard</button
                  >
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}

    {#if active === 'danger' && data.isOwner}
      <header class="detail-header">
        <h2>Danger Zone</h2>
        <p class="lede">
          Destructive operations. These cannot be undone — Litestream replicates the delete to the
          cloud as well.
        </p>
      </header>

      <div class="card danger-card">
        <h3>Wipe all farm data</h3>
        <p class="muted">
          Deletes every block, crop, event (spray / harvest / insecticide / hay / fertility), task,
          soil test, fertility credit, stock SKU + lot + movement, and (by default) every equipment
          row + sprayer. Plugins on disk and your user account are preserved.
        </p>
        <p class="muted">
          Type <code>WIPE-EVERYTHING</code> below to enable the button.
        </p>
        <label class="field">
          <span class="field-label">Confirmation</span>
          <input type="text" bind:value={confirmText} placeholder="WIPE-EVERYTHING" />
        </label>
        <label class="checkbox">
          <input type="checkbox" bind:checked={keepEquipment} />
          Keep equipment + sprayers (only data resets — calibration setup stays)
        </label>
        <label class="checkbox">
          <input type="checkbox" bind:checked={keepWeatherCache} />
          Keep NOAA forecast cache (saves a refetch round-trip)
        </label>
        <button
          class="primary danger"
          onclick={wipe}
          disabled={busy || confirmText !== 'WIPE-EVERYTHING'}
        >
          {busy ? 'Wiping…' : '🗑 Wipe all farm data'}
        </button>
        {#if result}<p class="success">{result}</p>{/if}
        {#if error}<p class="error">{error}</p>{/if}
      </div>
    {/if}

    {#if !data.isOwner && active !== 'overview'}
      <header class="detail-header">
        <h2>Owner-only</h2>
      </header>
      <div class="card warn">
        <p>This section is restricted to owners. Sign in as an owner to use it.</p>
      </div>
    {/if}
  </section>
</div>

<!-- Phase 17 follow-up — inline Review popup for pending AI Refresh
     suggestions. Renders OVER the Settings page so the operator can
     accept/reject without navigating to /stock. Closes back to the
     pending list, which auto-removes the just-handled item. -->
{#if reviewing}
  <div
    class="review-overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="review-title"
    onclick={(e) => {
      if (e.target === e.currentTarget) closeReview();
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape') closeReview();
    }}
    tabindex="-1"
  >
    <div class="review-modal">
      <div class="review-header">
        <h3 id="review-title" class="review-title">
          Review AI Refresh — <strong>{reviewing.shortName ?? reviewing.displayName}</strong>
        </h3>
        <button type="button" class="review-close" onclick={closeReview} aria-label="Close"
          >✕</button
        >
      </div>
      {#if reviewError}
        <p class="status-line status-error">{reviewError}</p>
      {/if}
      {#if reviewBusy && !reviewResult}
        <p class="hint">Loading suggestion…</p>
      {:else if reviewResult}
        {@const r = reviewResult}
        {@const fieldCount = Object.keys(reviewAccept).length}
        {@const cites = r.citations ?? []}
        {#if fieldCount > 0}
          <p class="review-lede">
            {fieldCount} field{fieldCount === 1 ? '' : 's'} returned with citations. Uncheck any you don't
            trust; Apply writes the rest directly to this item.
          </p>
          {#if r.notes}<p class="review-notes">{r.notes}</p>{/if}
          <ul class="review-list">
            {#each Object.keys(reviewAccept) as key (key)}
              {@const field = r[key] as PendingResultField | undefined}
              {#if field}
                <li class="review-row">
                  <label class="review-check">
                    <input type="checkbox" bind:checked={reviewAccept[key]} />
                    <span class="review-key">{prettyKey(key)}</span>
                  </label>
                  <span class="review-value">{formatReviewValue(field.value)}</span>
                  {#if field.sourceUrl}
                    <a
                      class="review-cite"
                      href={field.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`Source: ${field.sourceTitle ?? field.sourceUrl}`}
                      onclick={(e) => e.stopPropagation()}>i</a
                    >
                  {/if}
                </li>
              {/if}
            {/each}
          </ul>
          <div class="review-actions">
            <button type="button" class="primary" onclick={applyReview} disabled={reviewBusy}>
              {reviewBusy ? 'Applying…' : 'Apply selected'}
            </button>
            <button type="button" class="secondary" onclick={discardReview} disabled={reviewBusy}>
              Discard
            </button>
            <button type="button" class="secondary" onclick={closeReview} disabled={reviewBusy}>
              Cancel
            </button>
          </div>
        {:else}
          <p class="review-lede">
            Web search found {cites.length} page{cites.length === 1 ? '' : 's'} but couldn't extract structured
            specs.
          </p>
          {#if r.notes}<p class="review-notes">{r.notes}</p>{/if}
          {#if cites.length > 0}
            <ul class="review-cite-list">
              {#each cites as c}
                <li>
                  <a href={c.url} target="_blank" rel="noopener noreferrer">{c.title ?? c.url}</a>
                </li>
              {/each}
            </ul>
          {/if}
          <div class="review-actions">
            <button type="button" class="secondary" onclick={discardReview}>Discard</button>
            <button type="button" class="secondary" onclick={closeReview}>Close</button>
          </div>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  .settings-shell {
    display: grid;
    grid-template-columns: 240px 1fr;
    gap: 1.5rem;
    max-width: 1200px;
    margin: 0 auto;
    padding: 1rem;
    align-items: start;
  }

  /* ── Sidebar ─────────────────────────────────────────────────────────── */
  .sidebar {
    position: sticky;
    top: 1rem;
    background: white;
    border-radius: 10px;
    padding: 0.75rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  .sidebar h1 {
    font-size: 1.1rem;
    margin: 0.25rem 0.5rem 0.75rem;
    color: #1a1a1a;
    letter-spacing: -0.01em;
  }
  .sidebar nav {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .nav-item {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    width: 100%;
    padding: 0.55rem 0.7rem;
    border: none;
    background: transparent;
    color: #1a1a1a;
    font-family: inherit;
    font-size: 0.95rem;
    text-align: left;
    border-radius: 7px;
    cursor: pointer;
    min-height: 40px;
  }
  .nav-item:hover {
    background: #f0f3f0;
  }
  .nav-item.active {
    background: #1f5e3a;
    color: white;
  }
  .nav-item.active:hover {
    background: #1f5e3a;
  }
  a.nav-item.nav-link {
    text-decoration: none;
    color: #1a1a1a;
  }
  .nav-icon {
    font-size: 1.05rem;
    width: 1.4rem;
    text-align: center;
    flex-shrink: 0;
  }
  .nav-label {
    flex: 1;
  }

  /* ── Detail pane ─────────────────────────────────────────────────────── */
  .detail {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 0;
  }
  .detail-header h2 {
    margin: 0 0 0.25rem;
    font-size: 1.5rem;
    letter-spacing: -0.01em;
    color: #1a1a1a;
  }
  .detail-header .lede {
    margin: 0 0 0.5rem;
    color: #555;
    font-size: 0.95rem;
  }

  .card {
    background: white;
    padding: 1.25rem;
    border-radius: 10px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  .card h3 {
    margin: 0 0 0.5rem;
    font-size: 1.05rem;
    color: #1f5e3a;
  }
  .muted {
    color: #555;
    font-size: 0.9rem;
    line-height: 1.4;
    margin: 0 0 1rem;
  }
  .actions-row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin: 0.5rem 0;
  }
  .status-line {
    margin: 0.6rem 0 0;
    padding: 0.5rem 0.7rem;
    background: #ecfdf5;
    color: #065f46;
    border-radius: 6px;
    font-size: 0.88rem;
  }
  .status-line.status-error {
    background: #fef2f2;
    color: #b91c1c;
  }
  .hint {
    color: #6b7280;
    font-size: 0.82rem;
    margin: 0.6rem 0 0;
  }

  /* Pending AI Refresh suggestions panel */
  .pending-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }
  .pending-refresh-btn {
    padding: 0.25rem 0.6rem;
    font-size: 0.78rem;
    min-height: unset;
    min-width: unset;
  }
  .pending-list {
    list-style: none;
    padding: 0;
    margin: 0.75rem 0 0;
    border-top: 1px solid #e5e7eb;
  }
  .pending-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.6rem 0;
    border-bottom: 1px solid #f1f5f9;
  }
  .pending-row:last-child {
    border-bottom: none;
  }
  .pending-row-main {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
    flex: 1 1 auto;
  }
  .pending-row-name {
    font-weight: 600;
    color: #1f2937;
    font-size: 0.92rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pending-row-meta {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.78rem;
    flex-wrap: wrap;
  }
  .pending-row-meta .muted {
    margin: 0;
    font-size: 0.78rem;
  }
  .pending-row-fields {
    color: #4338ca;
    font-size: 0.78rem;
    font-style: italic;
  }
  .pending-pill {
    display: inline-block;
    background: #eef2ff;
    color: #4338ca;
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .pending-row-actions {
    display: flex;
    gap: 0.4rem;
    flex-shrink: 0;
  }
  .pending-review-btn {
    background: #2563eb;
    color: #fff;
    border: 1px solid #2563eb;
    border-radius: 4px;
    padding: 0.3rem 0.7rem;
    font-size: 0.82rem;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
    font-family: inherit;
    min-height: unset;
    min-width: unset;
  }
  .pending-review-btn:hover {
    background: #1d4ed8;
    border-color: #1d4ed8;
  }

  /* Inline review popup (overlay over Settings) */
  .review-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(15, 23, 42, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  .review-modal {
    background: #fff;
    border-radius: 10px;
    width: min(560px, 100%);
    max-height: 85vh;
    overflow-y: auto;
    padding: 1.1rem 1.25rem 1rem;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.25);
  }
  .review-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .review-title {
    font-size: 1rem;
    color: #1f2937;
    margin: 0;
    line-height: 1.3;
  }
  .review-close {
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 1.1rem;
    color: #6b7280;
    padding: 0.1rem 0.3rem;
    min-height: unset;
    min-width: unset;
  }
  .review-lede {
    color: #1f2937;
    font-size: 0.88rem;
    margin: 0.25rem 0 0.4rem;
  }
  .review-notes {
    color: #475569;
    font-size: 0.82rem;
    font-style: italic;
    margin: 0.25rem 0 0.5rem;
  }
  .review-list {
    list-style: none;
    padding: 0;
    margin: 0.5rem 0 0.75rem;
  }
  .review-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0;
    border-bottom: 1px dashed #e2e8f0;
    font-size: 0.85rem;
    min-height: 26px;
  }
  .review-row:last-child {
    border-bottom: none;
  }
  .review-check {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    flex: 0 0 auto;
    cursor: pointer;
  }
  .review-check input {
    margin: 0;
  }
  .review-key {
    font-weight: 600;
    color: #1f2937;
    white-space: nowrap;
  }
  .review-value {
    flex: 1 1 auto;
    text-align: right;
    color: #1f2937;
    font-family: ui-monospace, Menlo, monospace;
    font-size: 0.82rem;
    padding-left: 0.4rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  a.review-cite {
    display: inline-block;
    padding: 0 1px;
    margin: 0 0 0 2px;
    color: #6366f1;
    font-size: 0.7rem;
    font-style: italic;
    font-weight: 700;
    font-family: serif;
    line-height: 1;
    text-decoration: none;
    vertical-align: super;
    cursor: help;
    flex: 0 0 auto;
  }
  a.review-cite:hover {
    color: #4338ca;
    text-decoration: underline;
  }
  .review-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: 0.75rem;
    padding-top: 0.6rem;
    border-top: 1px solid #e5e7eb;
  }
  .review-cite-list {
    list-style: disc;
    padding-left: 1.1rem;
    margin: 0.3rem 0 0;
    font-size: 0.83rem;
  }
  .review-cite-list a {
    color: #2563eb;
    text-decoration: underline;
  }

  .card.warn {
    background: #fff8e1;
    border-left: 4px solid #b35900;
  }
  .card.danger-card {
    background: #fff5f5;
    border-left: 4px solid #b00020;
  }

  /* ── Generic form controls ───────────────────────────────────────────── */
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.9rem;
    margin-bottom: 0.75rem;
  }
  .field-label {
    font-weight: 600;
    color: #333;
  }
  .field input[type='text'],
  .field input[type='password'],
  .field input[type='number'] {
    padding: 0.55rem 0.7rem;
    border: 1.5px solid #d0d7d0;
    border-radius: 6px;
    font-size: 1rem;
    min-height: 44px;
    font-family: inherit;
    background: white;
  }
  .grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }
  .checkbox {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.6rem;
    font-size: 0.95rem;
  }
  .actions {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
    margin-top: 0.25rem;
  }

  button.primary {
    background: #1f5e3a;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.6rem 1.1rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 44px;
    font-size: 0.95rem;
    font-family: inherit;
  }
  button.primary:disabled {
    background: #999;
    cursor: not-allowed;
  }
  button.secondary {
    background: white;
    color: #1f5e3a;
    border: 1.5px solid #1f5e3a;
    border-radius: 6px;
    padding: 0.6rem 1.1rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 44px;
    font-size: 0.95rem;
    font-family: inherit;
  }
  button.secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  button.secondary.danger-text {
    color: #b00020;
    border-color: #b00020;
  }
  button.primary.danger {
    background: #b00020;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.85rem 1.4rem;
    font-weight: 700;
    cursor: pointer;
    min-height: 52px;
    font-size: 1rem;
    margin-top: 0.5rem;
  }
  button.primary.danger:disabled {
    background: #999;
    cursor: not-allowed;
  }

  /* ── Spend widget ────────────────────────────────────────────────────── */
  .spend-widget {
    background: #f5f7f4;
    border-radius: 8px;
    padding: 0.85rem 1rem;
    margin-bottom: 1rem;
  }
  .spend-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 0.15rem 0;
  }
  .spend-label {
    color: #555;
    font-size: 0.85rem;
  }
  .spend-value {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .spend-bar {
    margin-top: 0.5rem;
    height: 8px;
    background: #e0e6e0;
    border-radius: 4px;
    overflow: hidden;
  }
  .spend-bar-fill {
    height: 100%;
    background: #1f5e3a;
    border-radius: 4px;
    transition: width 0.2s;
  }
  .spend-bar-fill.warn {
    background: #b35900;
  }
  .spend-meta {
    margin-top: 0.35rem;
    font-size: 0.78rem;
    color: #777;
    text-align: right;
  }

  /* ── Quota row ───────────────────────────────────────────────────────── */
  .quota-row {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    padding: 0.7rem 0;
    border-top: 1px solid #f0f3f0;
  }
  .quota-row:first-of-type {
    border-top: none;
    padding-top: 0;
  }
  .quota-info {
    flex: 1;
    min-width: 0;
  }
  .quota-name {
    font-weight: 600;
  }
  .quota-help {
    font-size: 0.83rem;
    color: #555;
    margin-top: 0.15rem;
  }
  .quota-default {
    font-size: 0.78rem;
    color: #888;
    margin-top: 0.2rem;
  }
  .quota-input {
    width: 5.5rem;
    padding: 0.5rem 0.6rem;
    border: 1.5px solid #d0d7d0;
    border-radius: 6px;
    font-size: 1rem;
    min-height: 44px;
    font-family: inherit;
    text-align: right;
    background: white;
  }

  /* ── Counts ──────────────────────────────────────────────────────────── */
  dl.counts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.5rem 1.25rem;
    margin: 0;
  }
  dl.counts dt {
    color: #666;
    font-size: 0.9rem;
  }
  dl.counts dd {
    margin: 0;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  /* ── Types section ───────────────────────────────────────────────────── */
  .types-domain {
    border-top: 1px solid #e8ede8;
    padding: 0.4rem 0;
  }
  .types-domain:first-of-type {
    border-top: none;
    padding-top: 0;
  }
  .types-domain summary {
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 600;
    color: #1f5e3a;
    padding: 0.4rem 0;
    list-style: none;
  }
  .types-domain summary::-webkit-details-marker {
    display: none;
  }
  .types-domain summary::before {
    content: '▸';
    font-size: 0.8rem;
    color: #888;
    width: 0.8rem;
    transition: transform 0.15s;
  }
  .types-domain[open] summary::before {
    transform: rotate(90deg);
  }
  .domain-label {
    flex: 1;
  }
  .domain-count {
    background: #e7f1ea;
    color: #1f5e3a;
    border-radius: 10px;
    font-size: 0.72rem;
    font-weight: 700;
    padding: 0.1rem 0.5rem;
  }
  .empty-types {
    font-size: 0.85rem;
    color: #888;
    margin: 0.4rem 0 0.4rem 1rem;
  }
  .type-list {
    list-style: none;
    padding: 0;
    margin: 0.4rem 0 0.5rem 0;
  }
  .type-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.35rem 0.5rem;
    gap: 0.5rem;
    flex-wrap: wrap;
    border-bottom: 1px solid #f0f3f0;
  }
  .type-row:last-child {
    border-bottom: none;
  }
  .type-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    flex: 1;
    min-width: 0;
  }
  .type-name {
    font-weight: 600;
    font-size: 0.92rem;
  }
  .type-desc {
    color: #666;
    font-size: 0.82rem;
  }
  .badge.default {
    background: #e7f1ea;
    color: #1f5e3a;
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    letter-spacing: 0.4px;
  }
  .type-actions {
    display: flex;
    gap: 0.4rem;
    flex-shrink: 0;
  }
  .type-edit,
  .add-form {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
    flex: 1;
    align-items: center;
  }
  .type-edit input,
  .add-form input {
    flex: 1 1 140px;
    padding: 0.4rem 0.6rem;
    border: 1.5px solid #d0d7d0;
    border-radius: 4px;
    font-size: 0.9rem;
    min-height: 36px;
    font-family: inherit;
  }
  .add-form {
    margin-top: 0.4rem;
  }
  .add-type-btn {
    margin-top: 0.4rem;
  }
  .tiny {
    padding: 0.35rem 0.7rem;
    font-size: 0.82rem;
    min-height: 32px;
    border-radius: 4px;
    font-family: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .tiny.primary {
    background: #1f5e3a;
    color: #fff;
    border: none;
  }
  .tiny.primary:disabled {
    background: #999;
    cursor: not-allowed;
  }
  .tiny.secondary {
    background: #fff;
    color: #555;
    border: 1.5px solid #d0d7d0;
  }
  .tiny.secondary:hover {
    background: #f5f7f4;
  }
  .tiny.danger-btn {
    background: #fff;
    color: #b00020;
    border: 1.5px solid #b00020;
  }
  .tiny.danger-btn:hover {
    background: #fce4e4;
  }

  /* ── Status messages ─────────────────────────────────────────────────── */
  .success {
    background: #e7f1ea;
    color: #1f5e3a;
    padding: 0.6rem 0.8rem;
    border-radius: 6px;
    margin-top: 0.75rem;
    font-size: 0.9rem;
  }
  .error {
    background: #fce4e4;
    color: #b00020;
    padding: 0.6rem 0.8rem;
    border-radius: 6px;
    margin-top: 0.75rem;
    font-size: 0.9rem;
  }
  code {
    background: #f5f7f4;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    font-family: ui-monospace, Menlo, Monaco, monospace;
  }

  /* ── Responsive ──────────────────────────────────────────────────────── */
  @media (max-width: 720px) {
    .settings-shell {
      grid-template-columns: 1fr;
      gap: 0.75rem;
    }
    .sidebar {
      position: static;
    }
    .sidebar nav {
      flex-direction: row;
      overflow-x: auto;
      gap: 0.4rem;
      -webkit-overflow-scrolling: touch;
    }
    .nav-item {
      flex-shrink: 0;
      flex-direction: column;
      gap: 0.2rem;
      padding: 0.5rem 0.6rem;
      min-width: 80px;
      font-size: 0.8rem;
    }
    .grid-2 {
      grid-template-columns: 1fr;
    }
  }
</style>
