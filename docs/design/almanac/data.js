/* Shared mock data — same farm across all three directions for fair comparison. */
window.MOCK = {
  farm: "Loudoun Home Farm",
  user: { name: "Sherry M.", role: "Owner", initial: "S" },
  date: { iso: "2026-05-26", display: "Tuesday, May 26", short: "May 26" },
  weather: {
    tempF: 68, condition: "Partly cloudy", windMph: 6, windDir: "SW",
    humidity: 54, rainChance7d: [0, 10, 30, 60, 80, 20, 5], rainTomorrow: "0.4 in tomorrow night",
  },
  todayAction: {
    title: "Scout Block A — Bloody Butcher corn",
    why: "Corn earworm trap threshold crossed Sunday; check 12 plants for tip damage before window closes Thursday.",
    kind: "scout",
    // Structured scope: an array of {blockId, plantingIds[]} so the UI can
    // render single/multi-block AND single/multi-planting scouts cleanly.
    scopes: [
      { blockId: "a", plantingIds: ["a1"] },  // only the corn planting within Three Sisters
    ],
    stageSummary: "V8 · pre-tassel",
    windowCloses: "Thu 10pm",
  },
  // Alternate scout examples for variation artboards
  todayActionMultiBlock: {
    title: "Weekly pest walk — Block A corn + Orchard",
    why: "Reset codling-moth trap, recount earworm catches, and eyeball clover N nodulation. Both blocks scouted together saves a truck trip.",
    kind: "scout",
    scopes: [
      { blockId: "a", plantingIds: ["a1"] },
      { blockId: "f", plantingIds: ["f1", "f2"] },
    ],
    stageSummary: "mixed",
    windowCloses: "Sat 6pm",
  },
  todayActionWholeBlock: {
    title: "Walk Block A — full Three Sisters check",
    why: "First combined check since bean sow. Look for emergence on beans, vine extension on squash, and earworm on corn.",
    kind: "scout",
    scopes: [
      { blockId: "a", plantingIds: ["a1", "a2", "a3"] },  // all 3 plantings
    ],
    stageSummary: "mixed (V8 / pre-sow / pre-sow)",
    windowCloses: "Wed 8pm",
  },
  upcoming: [
    { id: 1, when: "Wed", title: "Spray window opens — burndown Block C", crop: "Cover (rye/vetch)", kind: "spray" },
    { id: 2, when: "Thu", title: "Side-dress nitrogen — Block A", crop: "Bloody Butcher Corn", kind: "fertility" },
    { id: 3, when: "Fri", title: "Transplant tomatoes → Block B", crop: "Brandywine", kind: "planting" },
    { id: 4, when: "Sat", title: "Harvest first cut — spring mix", crop: "Lettuce Mix", kind: "harvest" },
    { id: 5, when: "Sun", title: "Mow orchard understory", crop: "Apple block", kind: "task" },
  ],
  alerts: [
    { kind: "decon", level: "danger", text: "Backpack Sprayer 1 needs decontamination", detail: "Last load: 2,4-D (synthetic-auxin). Will not spray sensitive crops until cleaned.", cta: "Run decon wizard" },
    { kind: "stock", level: "warn", text: "Glyphosate 41% — 1.2 gal on hand", detail: "Below reorder threshold of 2.5 gal.", cta: "Reorder" },
  ],
  // ── Season planning wizard mock ───────────────────────────────────
  // Persistent chat thread that runs alongside every wizard step.
  // Real impl posts to /api/plan/<step>/refine; messages here mimic
  // the kind of substitution-only AI refinement the codebase enforces.
  wizardChat: [
    {
      role: "ai", time: "10:14", text: "Welcome back. Allocation looks solid — 6 blocks, 11 plantings. Schedule has one stale flag on Block A since you swapped beans into the Three Sisters. Want me to re-derive sowing dates for the polyculture, or do you want to handle that manually?",
    },
    {
      role: "user", time: "10:15", text: "Re-derive please. Keep corn at May 12, but stagger bean and squash off the corn V-stage.",
    },
    {
      role: "ai", time: "10:15", text: "Got it. Pulling the 3-sisters companion plugin for offsets:\n\n• Cherokee Trail-of-Tears bean: sow when corn ≥ V4 (~14 d after corn emergence). Earliest sow May 26.\n• Seminole pumpkin: sow when corn ≥ V6 (~21 d). Earliest sow Jun 2.\n\nBoth respect the soil-temp gate (60°F sustained — your data shows last 5 days avg 64°F). Should I commit the new dates?",
      actions: [
        { kind: "accept", label: "Accept both" },
        { kind: "modify", label: "Push squash to Jun 8" },
        { kind: "reject", label: "Keep current dates" },
      ],
    },
  ],
  // Season setup answers (Phase 21a fields)
  seasonSetup: {
    year: 2026,
    philosophy: "ipm",                  // organic | ipm | conventional | transitioning
    tillage: "reduced-till",            // no-till | strip-till | reduced-till | conventional-till
    fertilityApproach: "balanced",      // synthetic-led | balanced | organic-amendment-led
    transitioning: false,
    transitioningStartedYear: null,
    irrigationStrategy: "rainfed-supplemental", // rainfed | rainfed-supplemental | drip | overhead
    recordKeepingTier: "vdacs-audit",   // minimal | csa-disclosure | vdacs-audit
    helperRoles: 1,
  },
  // Schedule step — proposed planting dates per planting
  scheduleProposals: [
    { plantingId: "a1", crop: "Bloody Butcher Corn", block: "Block A",  current: "May 12 ✓ planted", suggested: null,           reason: "Already planted — no change.", status: "locked",   color: "#c9961f" },
    { plantingId: "a2", crop: "Cherokee Bean",        block: "Block A",  current: "May 22 (stale)",   suggested: "May 26",       reason: "Corn at V4 (companion plugin: 3-sisters → +14 d from emergence). Soil temp gate clear.", status: "proposed", color: "#7a3a4d" },
    { plantingId: "a3", crop: "Seminole Pumpkin",     block: "Block A",  current: "May 29 (stale)",   suggested: "Jun 2",        reason: "Corn at V6 (3-sisters → +21 d). Frost risk passed.", status: "proposed", color: "#a85a1f" },
    { plantingId: "b1", crop: "Brandywine Tomato",    block: "Block B",  current: "May 28",           suggested: null,           reason: "Last-frost-safe + soil ≥ 60°F. Holds.", status: "ok",       color: "#a23a3a" },
    { plantingId: "b2", crop: "French Marigold",      block: "Block B",  current: "May 28",           suggested: null,           reason: "Co-transplant with tomato per companion plugin.", status: "ok", color: "#d99a3a" },
    { plantingId: "d1", crop: "Spring Mix Lettuce",   block: "Block D",  current: "Mar 30 ✓ planted", suggested: null,           reason: "Already planted — second cut due May 27.", status: "locked", color: "#4a8b54" },
    { plantingId: "g1", crop: "Painted Mtn Corn",     block: "Block G",  current: "May 3 ✓ planted",  suggested: null,           reason: "Already planted at V6.", status: "locked", color: "#8a5a2c" },
  ],
  // ── Crop-archetype scenarios ─────────────────────────────────────
  // Plugin-driven shapes — each crop family declares its stage scale +
  // harvest schema + phenology model, and the UI renders accordingly.
  cropScenarios: {
    // ── 1. Wheat — small-grain archetype ──────────────────────────
    wheat: {
      block: { label: "Block W", crop: "Hard Red Winter Wheat", variety: "Shirley (soft red also OK)", acres: 1.4, planted: "Oct 8 '25", harvest: "Jul 5 – Jul 14 '26 (Z92)" },
      stageScale: "Zadoks",
      currentStage: { id: "Z37", label: "Flag leaf just visible", date: "May 26", next: "Z61 — flowering" },
      stages: [
        { id: "Z11", label: "1 leaf",        when: "Oct 25 ✓", done: true },
        { id: "Z21", label: "Tillering",     when: "Nov 14 ✓", done: true },
        { id: "Z30", label: "Stem elongation", when: "Apr 18 ✓", done: true },
        { id: "Z37", label: "Flag leaf",     when: "May 26",   done: false, current: true },
        { id: "Z45", label: "Booting",       when: "~Jun 3",   done: false },
        { id: "Z61", label: "Flowering",     when: "~Jun 12",  done: false, fhbGate: true },
        { id: "Z83", label: "Soft dough",    when: "~Jul 1",   done: false },
        { id: "Z92", label: "Mature (combine)", when: "~Jul 8", done: false, harvestGate: true },
      ],
      vernalizationStatus: { complete: true, daysAccum: 47, daysNeeded: 35, note: "Cold requirement satisfied · grain head will form." },
      fhbForecast: {
        modelName: "USDA Fusarium Risk Tool",
        windowOpens: "Jun 12 (Z61)",
        currentRisk: "moderate",
        nextSpray: "Triazole + scout · 2 days into flowering",
        history: [
          { day: "Z11", risk: "low" }, { day: "Z21", risk: "low" }, { day: "Z30", risk: "low" },
          { day: "Z37 today", risk: "low" }, { day: "Z45", risk: "low" }, { day: "Z55", risk: "mod" },
          { day: "Z61", risk: "high" },
        ],
      },
      harvest: {
        schemaKind: "small-grain",
        moistureTarget: 13.5,
        moistureMax: 15.0,
        testWeightTarget: 60,
        readings: [
          { spot: "north strip", bu: 38, moisture: 14.2, testWeight: 58.5 },
          { spot: "south strip", bu: 41, moisture: 13.8, testWeight: 60.1 },
        ],
        totalBu: 0, totalLb: 0,
      },
    },

    // ── 2. Grape — vine fruit archetype ───────────────────────────
    grape: {
      block: { label: "Block GR", crop: "Cabernet Franc", variety: "clone 312 on 101-14 rootstock", acres: 0.6, planted: "2019", harvest: "Oct 8 – Oct 18 '26 (target)" },
      trellisSystem: "VSP (vertical shoot positioning)",
      stageScale: "Eichhorn-Lorenz",
      currentStage: { id: "EL19", label: "Bloom", date: "May 26 (early)" },
      harvestSchema: "brix-ph-ta-tons",
      qualityTargets: { brix: { min: 22.5, target: 23.5, max: 25 }, ph: { min: 3.40, target: 3.55, max: 3.75 }, ta: { min: 5.5, target: 6.5, max: 8.0 } },
      samples: [
        { date: "Sep 12", brix: 19.2, ph: 3.22, ta: 9.1, note: "Pre-veraison · low brix expected" },
        { date: "Sep 22", brix: 21.4, ph: 3.31, ta: 7.6, note: "Veraison complete · climbing fast" },
        { date: "Sep 29", brix: 22.8, ph: 3.46, ta: 6.4, note: "Approaching target band" },
        { date: "Oct 6",  brix: 23.4, ph: 3.54, ta: 5.9, note: "In target — pick decision window" },
      ],
      pickRecommendation: { date: "Oct 8 – Oct 12", reasoning: "Numbers in target band, 5-day dry weather forecast, no rot pressure. Sample again Oct 7 morning before final call." },
      sprayProgram: { sprays: 11, frac: ["3", "7", "11", "M03"], lastSpray: "Sep 28 (Inspire Super)" },
    },

    // ── 3. Hay — alfalfa cutting cycle ────────────────────────────
    hay: {
      block: { label: "Hay Field 2", crop: "Alfalfa + Orchardgrass mix", acres: 4.8, planted: "Apr 2023" },
      cutNumber: 2,
      cutsPlanned: 4,
      cutsThisSeason: [
        { num: 1, mowedOn: "May 4", baledOn: "May 7", totalBales: 124, moisture: 13.6, quality: "RFV 142", weatherWindow: "3-day clear" },
        { num: 2, mowedOn: null,    baledOn: null,    totalBales: null, moisture: null, quality: null, weatherWindow: null, current: true },
      ],
      currentDecision: {
        forecast: [
          { day: "Today Tue", high: 78, low: 58, rain: 0,  cond: "Sun",       hayOk: true },
          { day: "Wed",       high: 82, low: 60, rain: 0,  cond: "Sun",       hayOk: true },
          { day: "Thu",       high: 84, low: 62, rain: 0,  cond: "Sun",       hayOk: true },
          { day: "Fri",       high: 79, low: 64, rain: 30, cond: "Cloud",     hayOk: false },
          { day: "Sat",       high: 72, low: 60, rain: 80, cond: "CloudRain", hayOk: false },
        ],
        verdict: "GO",
        reasoning: "3 consecutive dry days starting today. Mow this afternoon, ted Wed morning, rake Wed evening, bale Thu before 5pm. Fri rain risk too high to extend.",
      },
      sequence: [
        { id: "mow",  label: "Mow",   icon: "Tractor",  status: "ready", when: null, moisture: null, note: "Cut at ~3 inches when alfalfa hits 10% bloom" },
        { id: "ted",  label: "Ted",   icon: "Wind",     status: "pending", when: null, moisture: null, note: "Spread for drying · 1 pass first day" },
        { id: "rake", label: "Rake",  icon: "Wind",     status: "pending", when: null, moisture: null, note: "Into windrows · 2nd day morning" },
        { id: "bale", label: "Bale",  icon: "Bale",     status: "pending", when: null, moisture: null, note: "When moisture ≤ 18% for square, ≤ 16% for round" },
      ],
    },

    // ── 4. Tree fruit — multi-pick harvest ────────────────────────
    treeFruit: {
      block: { label: "Orchard", crop: "Apple — Goldrush", variety: "semi-dwarf · M.7 rootstock", acres: 1.2, planted: "2021" },
      bloomDate: "May 18 '26",
      expectedYieldLb: 1800,
      picks: [
        { num: 1, date: "Sep 8",  type: "thinning drop",    qtyLb: 80,   grade: "drop / cider",       reasoning: "Hand-thin under-developed fruit · don't count toward yield" },
        { num: 2, date: "Sep 28", type: "early storage",    qtyLb: 320,  grade: "Extra Fancy",         reasoning: "Color break + starch index 4 · 6-month CA storage candidates" },
        { num: 3, date: "Oct 10", type: "peak pick",        qtyLb: 720,  grade: "Fancy + Extra Fancy", reasoning: "Brix 14.5 · firmness 18 lb · starch 6 · CSA + farm-stand" },
        { num: 4, date: "Oct 22", type: "tail pick",        qtyLb: 480,  grade: "Fancy + Cider",       reasoning: "Last commercial-grade picks · taste sweet · cider apple bin starts" },
        { num: 5, date: "Nov 1",  type: "cider drop",       qtyLb: 200,  grade: "Cider",               reasoning: "Tree-shake + ground-fall · all to local cider mill" },
      ],
      cumulative: 0,  // computed
      lastPick: { num: 3, date: "Oct 10", qty: 720 },
      currentDate: "Oct 18", // demo state — between pick 3 and 4
    },
  },
  // ── Insecticide variant of the spray flow ───────────────────────
  // Same shell as `sprayPlan` but adds IPM threshold gate + pollinator
  // gate. Codling moth in the orchard (Block F), trap above threshold.
  insecticidePlan: {
    blocks: [{ id: "f", plantingId: "f1", area: 1.2, stage: "petal-fall + 6 d" }],
    blockCompatibility: { ok: true, label: "Single-block orchard spray", reason: "Apple goldrush at petal-fall + 6 days. Clover understory tolerates phosmet (no foliar contact). No drift-sensitive crops within 60 ft." },
    crop: "Apple — Goldrush",
    stage: "Petal-fall + 6 d · post-bloom",
    sprayer: "tow",
    targets: [
      { name: "Codling moth (1st gen)", count: "8 / wk", threshold: "≥5 / wk", pressure: "above", primary: true },
      { name: "Plum curculio",          count: "2 / wk", threshold: "≥3 / wk", pressure: "below", primary: true },
      { name: "Apple aphid",            count: "trace",  threshold: "≥5 / leaf", pressure: "below", primary: false },
      { name: "Oriental fruit moth",    count: "trap 0", threshold: "≥4 / wk", pressure: "below", primary: false },
    ],
    targetSummary: "Codling moth above threshold · 3 others monitored",
    area: 1.2, gpa: 100, totalGal: 120, tankSize: 25,
    tanks: [
      { idx: 1, fill: 25, label: "Tank 1 · full" },
      { idx: 2, fill: 25, label: "Tank 2 · full" },
      { idx: 3, fill: 25, label: "Tank 3 · full" },
      { idx: 4, fill: 25, label: "Tank 4 · full" },
      { idx: 5, fill: 20, label: "Tank 5 · partial" },
    ],
    products: [
      { id: "ip1", name: "Imidan 70-W",  color: "#5C3A1F", group: "Phosmet (IRAC 1B organophosphate)", rate: "2.13 lb/A",  total: "2.56 lb",  perTank: ["0.53 lb", "0.53 lb", "0.53 lb", "0.53 lb", "0.44 lb"], restrictions: "PHI 14 d · REI 72 h",   status: "ok" },
      { id: "ip2", name: "Surround WP",  color: "#A8956B", group: "Kaolin clay (IRAC UN — deterrent)", rate: "25 lb/A",    total: "30 lb",    perTank: ["6.25 lb", "6.25 lb", "6.25 lb", "6.25 lb", "5.0 lb"],   restrictions: "Adjuvant — coats fruit", status: "ok" },
    ],
    waterColor: "#6F8FA8",
    waterPerTank: ["18.2 gal", "18.2 gal", "18.2 gal", "18.2 gal", "14.6 gal"],
    waterTotal: "87.4 gal",
    ipmGate: {
      species: "Codling moth (CM)",
      pluginSource: "UMD orchard IPM (codling-moth-CM-DA)",
      trapCount: 8,
      threshold: 5,
      triggered: true,
      history: [
        { week: "Wk 18", count: 0 },
        { week: "Wk 19", count: 0 },
        { week: "Wk 20", count: 1 },
        { week: "Wk 21", count: 3 },
        { week: "Wk 22", count: 8, triggered: true },
      ],
      note: "Pheromone trap (CM-DA combo lure) checked weekly. Action threshold per UMD Apple IPM Guide §6.2.",
    },
    pollinatorGate: {
      bloomStatus: "complete",
      bloomEnded: "May 20",
      daysSinceBloom: 6,
      beeForecast: "low",
      ok: true,
      note: "Bloom ended May 20 (6 days). Pollinator gate clears at petal-fall + 3 d for OP class. Active hives 0.4 mi NW — beekeeper notified per courtesy policy.",
    },
    checks: [
      { id: "wind",  label: "Wind speed",           value: "5 mph S",                     ok: true, threshold: "≤10 mph" },
      { id: "temp",  label: "Air temp",             value: "72°F",                        ok: true, threshold: "60–85°F" },
      { id: "rain",  label: "Rain forecast (6h)",   value: "10% — clear",                 ok: true, threshold: "≤30%" },
      { id: "bee",   label: "Bee activity",         value: "Forecast: low (post-bloom)",  ok: true, threshold: "no active foraging" },
      { id: "phi",   label: "Pre-harvest interval", value: "143 d to harvest",            ok: true, threshold: "phosmet ≥14 d" },
      { id: "rei",   label: "Re-entry interval",    value: "72 h post-spray",             ok: true, threshold: "no field workers" },
      { id: "sprayer", label: "Sprayer state",      value: "Tow Boom · clean",            ok: true, threshold: "no carryover" },
      { id: "stage", label: "Bloom stage gate",     value: "Petal-fall + 6 d",            ok: true, threshold: "post-bloom" },
    ],
  },
  // Mirrors the wizard sequence: Season setup → Allocation → Schedule → Inputs → Commit.
  // ── Wizard Step 1 · Allocation ────────────────────────────────────
  allocationPlan: {
    targetYear: 2026,
    proposals: [
      { blockId: "a", title: "Three Sisters polyculture", note: "AI co-proposed corn + bean + squash. Reuses last year's tomato bed (rotation). Companion plugin matched.",
        plantings: [
          { id: "a1", crop: "Bloody Butcher Corn",      role: "structure",     pop: "28k/ac",       status: "accepted" },
          { id: "a2", crop: "Cherokee Trail-of-Tears Bean", role: "N + climber", pop: "1 per corn hill", status: "accepted" },
          { id: "a3", crop: "Seminole Pumpkin",         role: "groundcover",   pop: "perimeter",    status: "accepted" },
        ] },
      { blockId: "b", title: "Tomato + companion border",
        plantings: [
          { id: "b1", crop: "Brandywine Tomato",  role: "main",             pop: "24″ spacing", status: "accepted" },
          { id: "b2", crop: "French Marigold",    role: "pest border",      pop: "12″ perimeter", status: "auto-companion" },
        ] },
      { blockId: "c", title: "Cover crop (carry-forward)",
        plantings: [
          { id: "c1", crop: "Cereal Rye",       role: "biomass",   pop: "drilled", status: "carry-forward" },
          { id: "c2", crop: "Hairy Vetch",      role: "N fix",     pop: "co-seeded", status: "carry-forward" },
        ] },
      { blockId: "d", title: "Spring lettuce succession",
        plantings: [
          { id: "d1", crop: "Lettuce — 4-cv mix",   role: "main",     pop: "8″ spacing", status: "accepted" },
        ] },
      { blockId: "e", title: "Perennial hops",
        plantings: [
          { id: "e1", crop: "Cascade Hops",     role: "perennial", pop: "16′ trellis", status: "perennial" },
        ] },
      { blockId: "f", title: "Orchard + understory",
        plantings: [
          { id: "f1", crop: "Apple — Goldrush", role: "perennial", pop: "18′ × 12′", status: "perennial" },
          { id: "f2", crop: "White Clover",     role: "living mulch", pop: "row middles", status: "carry-forward" },
        ] },
      { blockId: "g", title: "Second corn block",
        plantings: [
          { id: "g1", crop: "Painted Mountain Flour Corn", role: "main", pop: "28k/ac", status: "accepted" },
        ] },
    ],
    unallocated: [
      { id: "u1", crop: "Buttercup Squash", reason: "No suitable block — would clash with Three Sisters in Block A (same family). AI suggests pushing to Fall 2026 or finding a 0.3 ac plot.", action: "defer" },
      { id: "u2", crop: "Summer Lettuce Succession #2", reason: "Block D will be in summer fallow then garlic. AI proposes Block D2 (not yet defined).", action: "needs-block" },
    ],
    rotationViolations: [],
    summary: { proposed: 11, accepted: 9, pending: 2, blocks: 7 },
  },
  // ── Wizard Step 3 · Inputs Plan ───────────────────────────────────
  inputsPlanData: {
    perPlanting: [
      { plantingId: "a1", crop: "Bloody Butcher Corn", expanded: true, applications: [
        { id: "ap1", when: "May 12 ✓", type: "fertility", product: "Pre-plant N (urea)", rate: "60 lb N/A", source: "Crop plugin", status: "completed" },
        { id: "ap2", when: "May 27",   type: "fertility", product: "Side-dress N",       rate: "80 lb N/A", source: "UMD small-plot guide", status: "accepted" },
        { id: "ap3", when: "Jun 12",   type: "herbicide", product: "Atrazine 4L + Roundup PMx", rate: "1.5 qt/A + 32 fl oz/A", source: "Safety kernel + Group strategy", status: "accepted" },
        { id: "ap4", when: "Jul 5",    type: "fertility", product: "Foliar K",           rate: "0.5 gal/A",  source: "Crop plugin", status: "substituted", was: "K-Mag" },
      ], scoutCadence: [
        { kind: "Corn earworm trap", freq: "weekly", from: "Jun 1" },
        { kind: "Tip damage walk",    freq: "bi-weekly", from: "Jul 1" },
      ], warnings: [] },
      { plantingId: "a2", crop: "Cherokee Bean", expanded: false, applications: [
        { id: "ap5", when: "May 26",   type: "planting", product: "Cherokee Bean seed",  rate: "1 per corn hill", source: "Companion plugin", status: "accepted" },
        { id: "ap6", when: "Jul 20",   type: "scout",    product: "Mexican bean beetle scout", rate: "—", source: "Crop plugin", status: "accepted" },
      ], scoutCadence: [], warnings: [] },
      { plantingId: "f1", crop: "Apple Goldrush", expanded: false, applications: [
        { id: "ap7", when: "Apr 15 ✓", type: "fungicide", product: "Captan 80WDG",       rate: "2.5 lb/A",  source: "Orchard IPM", status: "completed" },
        { id: "ap8", when: "May 26",   type: "insecticide", product: "Imidan 70-W + Surround WP", rate: "2.13 lb/A + 25 lb/A", source: "IPM (codling moth above threshold)", status: "accepted" },
        { id: "ap9", when: "Jun 8",    type: "fungicide", product: "Inspire Super",      rate: "12 fl oz/A", source: "Apple scab degree-day model", status: "pending" },
      ], scoutCadence: [
        { kind: "Pheromone trap (CM)",  freq: "weekly", from: "Apr 25" },
        { kind: "Plum curculio trap",   freq: "weekly", from: "May 1" },
      ], warnings: [
        { level: "info", text: "Captan and Inspire Super have a 24-hr tank-mix incompatibility — kernel will block co-application." },
      ] },
    ],
    shoppingList: [
      { item: "Urea (46-0-0)",          total: "320 lb",   onHand: "180 lb",   shortfall: "140 lb",  status: "short" },
      { item: "Atrazine 4L",            total: "1.2 gal",  onHand: "1.5 gal",  shortfall: "0",       status: "ok" },
      { item: "Roundup PowerMax 3",     total: "1.0 gal",  onHand: "0.4 gal",  shortfall: "0.6 gal", status: "short" },
      { item: "Crop Oil Concentrate",   total: "0.5 gal",  onHand: "1.2 gal",  shortfall: "0",       status: "ok" },
      { item: "Cherokee Bean seed",     total: "0.5 lb",   onHand: "0 lb",     shortfall: "0.5 lb",  status: "short" },
      { item: "Seminole Pumpkin seed",  total: "0.1 lb",   onHand: "0 lb",     shortfall: "0.1 lb",  status: "short" },
      { item: "French Marigold starts", total: "60 plants",onHand: "0",        shortfall: "60",      status: "short" },
      { item: "Imidan 70-W",            total: "2.6 lb",   onHand: "5 lb",     shortfall: "0",       status: "ok" },
      { item: "Surround WP",            total: "30 lb",    onHand: "10 lb",    shortfall: "20 lb",   status: "short" },
      { item: "Inspire Super",          total: "14 fl oz", onHand: "16 fl oz", shortfall: "0",       status: "ok" },
    ],
    warnings: [
      { level: "warn", text: "Roundup PowerMax 3 application requires hooded sprayer over corn. Confirm equipment before Jun 12." },
      { level: "info", text: "Plan derives from Phase-21b deterministic planner; AI refinements are substitution-only." },
    ],
    aiNote: "Substituted 2 applications: K-Mag → Foliar K (your fertility approach prefers liquid), and pushed Inspire Super by 4 days to clear Captan REI.",
  },
  // ── Wizard Step 4 · Commit / Review ───────────────────────────────
  commitSummary: {
    steps: [
      { label: "Season setup",  status: "valid",  count: "6 fields · IPM + Reduced-till" },
      { label: "Allocation",    status: "valid",  count: "11 plantings across 7 blocks · 2 deferred" },
      { label: "Schedule",      status: "valid",  count: "7 planting dates · 2 stale resolved" },
      { label: "Inputs plan",   status: "valid",  count: "28 applications · 14 scout cadences" },
    ],
    toCreate: { plantings: 11, tasks: 47, applications: 28, scoutCadences: 14, shoppingItems: 10 },
    carryForward: { covers: 2, perennials: 3 },
    blockedBy: [],
    aiFinalCheck: "All four cross-tenant validation passes succeeded. Safety kernel verified 0 bypass attempts in the 28 proposed applications.",
  },
  // ── Fungicide variant ─────────────────────────────────────────────
  fungicidePlan: {
    blocks: [{ id: "f", plantingId: "f1", area: 1.2, stage: "petal-fall + 6 d" }],
    blockCompatibility: { ok: true, label: "Single-block orchard fungicide", reason: "Apple Goldrush is scab-susceptible. Petal-fall is the standard timing for primary scab management. Clover understory unaffected." },
    crop: "Apple — Goldrush",
    stage: "Petal-fall + 6 d · post-bloom",
    sprayer: "tow",
    targets: [
      { name: "Apple scab (Venturia)",     count: "wet hrs 14 / 9 needed", threshold: "≥9 wet hrs + leaf-wet temp", pressure: "above", primary: true },
      { name: "Powdery mildew",            count: "early visual",          threshold: "any leaf incidence",         pressure: "above", primary: true },
      { name: "Cedar-apple rust",          count: "0 lesions",             threshold: "any active galls",           pressure: "below", primary: false },
      { name: "Fly speck / sooty blotch",  count: "predict 320 leaf-wet hrs", threshold: "≥175 leaf-wet hrs", pressure: "below", primary: false },
    ],
    targetSummary: "Scab + powdery mildew above threshold per RIMpro / NEWA models",
    area: 1.2, gpa: 100, totalGal: 120, tankSize: 25,
    tanks: [
      { idx: 1, fill: 25, label: "Tank 1 · full" },
      { idx: 2, fill: 25, label: "Tank 2 · full" },
      { idx: 3, fill: 25, label: "Tank 3 · full" },
      { idx: 4, fill: 25, label: "Tank 4 · full" },
      { idx: 5, fill: 20, label: "Tank 5 · partial" },
    ],
    products: [
      { id: "fp1", name: "Inspire Super",      color: "#3F5C8A", group: "Difenoconazole + cyprodinil (FRAC 3 + FRAC 9)", rate: "12 fl oz/A", total: "14 fl oz",  perTank: ["3 fl oz", "3 fl oz", "3 fl oz", "3 fl oz", "2 fl oz"], restrictions: "PHI 72 d · REI 12 h · alternate with non-FRAC-3 next spray", status: "ok" },
      { id: "fp2", name: "Captan 80WDG",       color: "#A8835C", group: "Captan (FRAC M04 multi-site)",                  rate: "2.5 lb/A",   total: "3.0 lb",     perTank: ["0.62 lb", "0.62 lb", "0.62 lb", "0.62 lb", "0.50 lb"], restrictions: "Do NOT tank-mix with oil within 14 d · REI 96 h",  status: "ok" },
    ],
    waterColor: "#6F8FA8",
    waterPerTank: ["21.6 gal", "21.6 gal", "21.6 gal", "21.6 gal", "17.3 gal"],
    waterTotal: "103.7 gal",
    diseaseGate: {
      model: "NEWA Apple Scab (RIMpro-derived)",
      condition: "Ascospore release · primary infection window",
      leafWetHours: 14, leafWetThreshold: 9,
      avgTempF: 58,
      triggered: true,
      history: [
        { day: "May 19", wetHrs: 4, infect: false },
        { day: "May 20", wetHrs: 0, infect: false },
        { day: "May 21", wetHrs: 8, infect: false },
        { day: "May 22", wetHrs: 12, infect: true },
        { day: "May 24", wetHrs: 14, infect: true },
      ],
      note: "RIMpro model predicts 84% ascospore maturity. Petal-fall infection event Apr 22 went uncovered — this spray is the catch-up.",
    },
    rainDewGate: {
      next6h: "0% rain — dry",
      next12h: "0% rain — dry",
      nextDew: "tonight ~3am",
      ok: true,
      note: "Captan needs ≥4 dry hrs for redistribution to surface. Spray before noon to clear evening dew.",
    },
    resistanceGate: {
      ok: true,
      lastFRAC: "FRAC 7 (May 5 · Sercadis)",
      thisFRAC: "FRAC 3 + 9 (Inspire Super) + M04 (Captan)",
      rotationOk: true,
      note: "FRAC group rotation respected — no consecutive same-MOA sprays. Captan (M04) is multi-site, doesn't count against rotation.",
    },
    checks: [
      { id: "wind",  label: "Wind speed",          value: "4 mph S",                ok: true, threshold: "≤10 mph" },
      { id: "temp",  label: "Air temp",            value: "62°F",                   ok: true, threshold: "55–80°F" },
      { id: "rain",  label: "Rain forecast (6h)",  value: "0% — dry window",        ok: true, threshold: "≥4 dry hrs (captan)" },
      { id: "dew",   label: "Next dew event",      value: "~3am tonight",           ok: true, threshold: "post-application OK" },
      { id: "phi",   label: "Pre-harvest interval",value: "143 d to harvest",       ok: true, threshold: "Inspire ≥72 d" },
      { id: "rei",   label: "Re-entry interval",   value: "96 h (captan limits)",   ok: true, threshold: "no field workers" },
      { id: "sprayer", label: "Sprayer state",     value: "Tow Boom · clean",       ok: true, threshold: "no carryover" },
      { id: "rotation", label: "FRAC group rotation", value: "OK — last was Group 7", ok: true, threshold: "no consecutive same MOA" },
    ],
  },
  // ── First-run onboarding (Phase 5 persona) ────────────────────────
  onboarding: {
    user: "Sherry M.",
    farm: "Loudoun Home Farm",
    steps: [
      { id: "farm",     label: "Tell us about your farm",     icon: "Field",   done: true,  detail: "2.5 ac · Loudoun County VA · 6 blocks defined"  },
      { id: "season",   label: "Pick your season philosophy", icon: "Sprout",  done: true,  detail: "IPM + Reduced-till · balanced fertility" },
      { id: "block",    label: "Define your first block",     icon: "Map",     done: false, current: true, detail: "Walk through Block A as an example" },
      { id: "planting", label: "Record what you've planted",  icon: "Leaf",    done: false, detail: "Or skip — the wizard can help" },
      { id: "sprayer",  label: "Register a sprayer",          icon: "Spray",   done: false, detail: "Safety kernel needs at least one before you can record" },
      { id: "calibrate",label: "Calibrate it (~5 min)",       icon: "Beaker",  done: false, detail: "1/128-acre method — dilution math derives from here" },
    ],
    tips: [
      { kind: "shortcut", text: "Already have a CSV from last year? Import on Settings → Records." },
      { kind: "shortcut", text: "Want to skip ahead? The AI assistant can populate a sample plan for any of the 308 supported crops." },
    ],
  },
  aiEnabled: true, // Drives wizard chat gating + Settings → AI assistant card. Flip false for AI-off demo.
  aiSettings: {
    provider: "Anthropic",
    model: "claude-haiku-4-5",
    keyMasked: "sk-ant-***xyz9",
    monthlyCapUSD: 8,
    spendThisMonth: 2.40,
    callsThisMonth: 47,
    gatedFeatures: [
      "Allocation refinement chat",
      "Schedule re-derivation (e.g. 3-sisters offsets)",
      "Input plan substitutions",
      "Free-text 'ask the assistant' on Plan v2 + Today",
      "AI photo extract in Stock-add (Claude vision)",
      "Marketplace search tier 3 (Claude web lookup)",
      "Personalised ranking of Today recommendations",
    ],
    keepWorking: [
      "All five wizard steps run fully manually — drag Gantt bars, click edit, fill forms",
      "Safety kernel + decon + retention logic are local and never call AI",
      "CSV import / export · 308 plugins · all calendar derivations",
      "Stock-add via barcode, label OCR, search, manual entry — 4 of 5 methods",
      "Spray + harvest + scout records, GPA calibration math, IPM thresholds",
      "Today's action card still derives from your scout + plugin rules",
    ],
  },
  // ── Harvest ───────────────────────────────────────────────────────
  harvestData: {
    readyNow: [
      { id: "h1", plantingId: "d1", crop: "Lettuce — 4-cv mix", block: "Block D · 0.3 ac", daysSincePlanting: 57, expectedYield: "85 lb / cut", mode: "cut-and-come-again", phiClear: true, urgency: "today", note: "First cut window opens today. 3-day harvest window before heat stress." },
      { id: "h2", plantingId: "e1", crop: "Cascade Hops", block: "Block E · 0.5 ac", daysSincePlanting: 86, expectedYield: "240 lb wet / 60 lb dry", mode: "cone-pick", phiClear: true, urgency: "in 18 days", note: "Burr → cone in ~18 d. Aroma check at lupulin development." },
    ],
    upcoming: [
      { id: "h3", crop: "Brandywine Tomato", block: "Block B", window: "Aug 5 – Sep 30", est: "180 lb",  mode: "hand-pick weekly" },
      { id: "h4", crop: "Bloody Butcher Corn", block: "Block A", window: "Sep 15 – Sep 25 (R6)", est: "320 lb (28k pop)", mode: "ear-pick" },
      { id: "h5", crop: "Painted Mtn Corn",  block: "Block G", window: "Sep 28 – Oct 8 (R6)",   est: "400 lb",          mode: "ear-pick" },
      { id: "h6", crop: "Apple — Goldrush",  block: "Orchard", window: "Oct 10 – Nov 1",        est: "~1,800 lb",       mode: "hand-pick" },
      { id: "h7", crop: "Seminole Pumpkin",  block: "Block A", window: "Oct 5 (after cure)",    est: "~80 fruit",       mode: "field cure 7 d" },
    ],
    recentLog: [
      { id: "hl1", when: "May 24",   crop: "Lettuce — 4-cv mix", block: "D", qty: 12, unit: "lb", by: "Sherry", mode: "cut",       notes: "Light first taste — Salanova lead." },
      { id: "hl2", when: "May 17",   crop: "Lettuce — 4-cv mix", block: "D", qty: 8,  unit: "lb", by: "Marco",  mode: "cut",       notes: "Thinning cut." },
      { id: "hl3", when: "Apr 30",   crop: "Spring radish",      block: "D", qty: 18, unit: "lb", by: "Sherry", mode: "pull",      notes: "Side bed (untracked planting)." },
      { id: "hl4", when: "Oct 4 '25",crop: "Goldrush apple",     block: "Orchard", qty: 1640, unit: "lb", by: "Sherry", mode: "hand-pick", notes: "Full crop · CSA + storage split." },
    ],
    ytd: { totalLbs: 38, totalEvents: 3, byCrop: [{ crop: "Lettuce mix", lbs: 20, count: 2 }, { crop: "Spring radish", lbs: 18, count: 1 }] },
  },
  stockData: {
    summary: { totalItems: 34, lowStock: 6, expiringSoon: 2, lotsTotal: 47, lastReceived: "May 18" },
    categories: [
      { id: "all",    label: "All",          count: 34, low: 6 },
      { id: "herb",   label: "Herbicides",   count: 8,  low: 2 },
      { id: "insect", label: "Insecticides", count: 6,  low: 1 },
      { id: "fung",   label: "Fungicides",   count: 4,  low: 0 },
      { id: "fert",   label: "Fertility",    count: 7,  low: 1 },
      { id: "seed",   label: "Seeds",        count: 9,  low: 2 },
    ],
    items: [
      { id: "s1",  name: "Glyphosate 41% (Roundup PowerMax 3)", category: "herb",   unit: "gal",    onHand: 1.2, reorderAt: 2.5, lots: 1, expires: "Oct 2027",   status: "short" },
      { id: "s2",  name: "Atrazine 4L",                          category: "herb",   unit: "gal",    onHand: 1.5, reorderAt: 1.0, lots: 1, expires: "Jul 2028",   status: "ok" },
      { id: "s3",  name: "2,4-D Amine",                          category: "herb",   unit: "gal",    onHand: 0.6, reorderAt: 1.0, lots: 1, expires: "May 2027",   status: "short" },
      { id: "s4",  name: "Imidan 70-W (phosmet)",                category: "insect", unit: "lb",     onHand: 5.0, reorderAt: 3.0, lots: 1, expires: "Mar 2028",   status: "ok" },
      { id: "s5",  name: "Surround WP (kaolin)",                 category: "insect", unit: "lb",     onHand: 10,  reorderAt: 25,  lots: 1, expires: "—",          status: "short" },
      { id: "s6",  name: "Captan 80WDG",                         category: "fung",   unit: "lb",     onHand: 8,   reorderAt: 5,   lots: 2, expires: "Apr 2027",   status: "ok" },
      { id: "s7",  name: "Inspire Super",                        category: "fung",   unit: "fl oz", onHand: 16,  reorderAt: 12,  lots: 1, expires: "Aug 2026 ⏳", status: "expiring" },
      { id: "s8",  name: "Urea (46-0-0)",                        category: "fert",   unit: "lb",     onHand: 180, reorderAt: 300, lots: 2, expires: "—",          status: "short" },
      { id: "s9",  name: "Compost — composted manure",            category: "fert",   unit: "yd³",   onHand: 4,   reorderAt: 2,   lots: 1, expires: "—",          status: "ok" },
      { id: "s10", name: "Cherokee Trail-of-Tears Bean seed",     category: "seed",   unit: "lb",     onHand: 0,   reorderAt: 0.5, lots: 0, expires: "—",          status: "short" },
      { id: "s11", name: "Seminole Pumpkin seed",                category: "seed",   unit: "lb",     onHand: 0,   reorderAt: 0.1, lots: 0, expires: "—",          status: "short" },
      { id: "s12", name: "French Marigold starts",               category: "seed",   unit: "plants", onHand: 0,   reorderAt: 60,  lots: 0, expires: "—",          status: "short" },
    ],
    recentTxns: [
      { when: "May 18", item: "Inspire Super",          qty: "+1 jug (16 fl oz)", reason: "Received from Helena Agri",         by: "Sherry", kind: "received" },
      { when: "May 17", item: "Atrazine 4L",            qty: "−1.2 qt",            reason: "Spray event · Block A V4 burndown", by: "Marco",  kind: "used" },
      { when: "May 12", item: "Urea (46-0-0)",          qty: "−80 lb",             reason: "Pre-plant N · Block A",             by: "Sherry", kind: "used" },
      { when: "May 8",  item: "Cover crop seed (rye)",  qty: "+50 lb",             reason: "Fall '25 carry-forward",            by: "Sherry", kind: "received" },
    ],
  },
  recordsData: {
    summary: { total: 124, locked: 118, ytd: 38, retainsUntil: "Dec 31, 2027", oldest: "May 8, 2024" },
    filters: { activeKinds: ["spray", "scout", "harvest"], dateRange: "May 1 → today", block: "all", sprayer: "all" },
    counts: { spray: 14, insecticide: 3, fungicide: 5, scout: 22, harvest: 17, fertility: 9, planting: 11, decon: 2 },
    rows: [
      { id: "r1",  when: "2026-05-24 09:14", kind: "scout",       block: "A", planting: "Bloody Butcher Corn", detail: "Earworm pheromone trap · 8 moths / wk · above threshold", by: "Sherry", locked: true, hash: "f4a2…" },
      { id: "r2",  when: "2026-05-18 06:42", kind: "spray",       block: "A", planting: "Bloody Butcher Corn", detail: "Atrazine 4L 1.5 qt/A · V4 burndown · 0.8 ac",            by: "Marco",  locked: true, hash: "8b91…" },
      { id: "r3",  when: "2026-05-17 17:08", kind: "harvest",     block: "D", planting: "Lettuce 4-cv",        detail: "Cut · 8 lb · cut-and-come-again",                       by: "Marco",  locked: true, hash: "2c7e…" },
      { id: "r4",  when: "2026-05-15 10:33", kind: "fungicide",   block: "F", planting: "Apple Goldrush",      detail: "Captan 80WDG 2.5 lb/A · petal-fall · 1.2 ac · 5 tanks",  by: "Sherry", locked: true, hash: "ad44…" },
      { id: "r5",  when: "2026-05-12 14:21", kind: "fertility",   block: "A", planting: "Bloody Butcher Corn", detail: "Pre-plant urea · 60 lb N/A · 0.8 ac",                   by: "Sherry", locked: true, hash: "1ef0…" },
      { id: "r6",  when: "2026-05-12 13:55", kind: "planting",    block: "A", planting: "Bloody Butcher Corn", detail: "Direct seed · 28k pop/ac · 0.8 ac",                     by: "Sherry", locked: true, hash: "9d2b…" },
      { id: "r7",  when: "2026-05-08 11:00", kind: "decon",       block: "—", planting: "—",                   detail: "Backpack 1 · triple rinse + ammonia · 2,4-D out",        by: "Marco",  locked: true, hash: "4af9…" },
      { id: "r8",  when: "2026-05-05 08:30", kind: "insecticide", block: "F", planting: "Apple Goldrush",      detail: "Sercadis 4 fl oz/A · pre-bloom · 1.2 ac",                by: "Sherry", locked: true, hash: "be17…" },
      { id: "r9",  when: "2026-05-03 16:40", kind: "planting",    block: "G", planting: "Painted Mountain Corn",detail: "Direct seed · 28k pop/ac · 1.0 ac",                    by: "Sherry", locked: true, hash: "75c1…" },
      { id: "r10", when: "2026-04-30 09:15", kind: "harvest",     block: "D", planting: "Spring Radish",       detail: "Pull · 18 lb · side-bed planting",                      by: "Sherry", locked: false,hash: "—" },
    ],
  },
  loginData: {
    sellingPoints: [
      { icon: "Sprout", title: "Plan together, record once",   sub: "AI-assisted season plans; the safety kernel keeps every spray record audit-ready." },
      { icon: "Wind",   title: "Offline-first in the field",   sub: "Records queue locally; sync when you're back at the truck. No data lost at the back of a field." },
      { icon: "Lock",   title: "Audit-ready by default",       sub: "48-hour record lock + VDACS-ready CSV + PDF exports. Two-year retention with hash chains." },
      { icon: "Eye",    title: "IPM scout cadence built-in",   sub: "Trap counts trigger spray gates; calendar sprays without a pest record are blocked." },
    ],
    demoRoles: [
      { id: "owner",          label: "Owner",        name: "Sherry",  sub: "Full access · plans, sprays, exports" },
      { id: "helper",         label: "Helper",       name: "Marco",   sub: "Field actions · gloves-on UI" },
      { id: "inspector",      label: "Inspector",    name: "Dale",    sub: "Read-only · audit + exports" },
      { id: "custom-operator",label: "Custom op",    name: "Tony",    sub: "Per-block · stock financials hidden" },
    ],
  },
  settingsData: {
    user: { name: "Sherry M.", email: "sherry@loudoun-home.farm", role: "Owner", since: "Mar 2024", lastLogin: "today · 8:42 AM", sessions: 2 },
    sections: [
      { id: "account",      label: "Account & sign-in",     icon: "User",     sub: "Email · password · 2FA · active sessions",            badge: null },
      { id: "season",       label: "Season setup",          icon: "Sprout",   sub: "Philosophy · tillage · fertility · irrigation",       badge: { tone: "neutral", text: "Synced from wizard" } },
      { id: "farm",         label: "Farm & blocks",         icon: "Field",    sub: "Acreage · soil zones · field map · irrigation",       badge: null },
      { id: "helpers",      label: "Helpers & invites",     icon: "User",     sub: "1 active helper · 1 pending invite",                  badge: { tone: "wheat", text: "1 pending" } },
      { id: "sprayers",     label: "Sprayers & calibration",icon: "Spray",    sub: "3 registered · 1 needs decon · last calibrated May 4",badge: { tone: "rust", text: "Decon needed" } },
      { id: "plugins",      label: "Plugins & crop library",icon: "Layers",   sub: "308 loaded · 0 failed · 2 updates available",          badge: { tone: "wheat", text: "2 updates" } },
      { id: "records",      label: "Records & retention",   icon: "FileText", sub: "VDACS audit tier · 2-year hold · last export May 14",  badge: null },
      { id: "ai",           label: "AI assistant",          icon: "Leaf",     sub: "Claude API key · monthly cap · model · gated steps",  badge: { tone: "rust", text: "No key" } },
      { id: "integrations", label: "Integrations",          icon: "Wrench",   sub: "Weather · soil-test · USDA · Quickbooks (planned)",   badge: null },
      { id: "billing",      label: "Plan & billing",        icon: "Box",      sub: "Solo plan · single-replica · ~$1/mo storage",         badge: null },
      { id: "danger",       label: "Advanced & export-all", icon: "Alert",    sub: "Bulk export · transfer farm ownership · delete account",badge: null },
    ],
    advanced: { buildVersion: "v1.3.4-phase-21b", rulesVersion: "RULES_v18", pluginFailures: 0, tenantId: "owner_loudoun_home", lastBackup: "Litestream · 4 min ago" },
  },
  // Mirrors the wizard sequence: Season setup → Allocation → Schedule → Inputs → Commit.
  seasonPlan: {
    year: 2026,
    steps: [
      { id: "setup",     label: "Season setup",  state: "done",        when: "Mar 12", note: "No-till · IPM philosophy" },
      { id: "alloc",     label: "Allocation",    state: "done",        when: "Apr 2",  note: "6 blocks · refined 2×" },
      { id: "schedule",  label: "Schedule",      state: "stale",       when: "Apr 8",  note: "Block A stale after bean swap" },
      { id: "inputs",    label: "Inputs plan",   state: "in-progress", when: "May 14", note: "Block A: 2 of 3 accepted" },
      { id: "commit",    label: "Commit",        state: "pending",     when: null,     note: "Auto-commits when Inputs accepted" },
    ],
  },
  // Provenance — where each planting came from. Keyed by planting id.
  plantingProvenance: {
    a1: { source: "AI plan",      seededAt: "Apr 2",  edits: 2, lastEdit: "May 18", note: "Refined once for plant population, once for sowing date." },
    a2: { source: "AI plan",      seededAt: "Apr 2",  edits: 1, lastEdit: "May 24", note: "Companion offset auto-derived from 3-sisters plugin." },
    a3: { source: "AI plan",      seededAt: "Apr 2",  edits: 0, lastEdit: null,     note: null },
    b1: { source: "AI plan",      seededAt: "Apr 2",  edits: 1, lastEdit: "May 15", note: "Sherry pushed transplant date back 1 week for last frost risk." },
    b2: { source: "Companion AI", seededAt: "Apr 2",  edits: 0, lastEdit: null,     note: "Auto-added from marigold-tomato companion plugin." },
    c1: { source: "Carry-forward",seededAt: "Oct '25",edits: 0, lastEdit: null,     note: "Carried over from 2025 fall cover-crop plan." },
    c2: { source: "Carry-forward",seededAt: "Oct '25",edits: 0, lastEdit: null,     note: "Carried over from 2025 fall cover-crop plan." },
    d1: { source: "Manual",       seededAt: "Mar 28", edits: 0, lastEdit: null,     note: "Added by Sherry — not part of AI plan (last-minute succession)." },
    e1: { source: "Perennial",    seededAt: "2023",   edits: 0, lastEdit: null,     note: "Perennial — not on this season's plan." },
    f1: { source: "Perennial",    seededAt: "2021",   edits: 0, lastEdit: null,     note: "Perennial orchard — managed by recurring orchard plugin." },
    f2: { source: "Companion AI", seededAt: "2022",   edits: 0, lastEdit: null,     note: "Living-mulch understory from clover-orchard plugin." },
  },
  blocks: [
    { id: "a", label: "Block A", acres: 0.8, crop: "Three Sisters", variety: "corn / bean / squash polyculture", stage: "mixed", planted: "May 12 (corn)", harvest: "Aug 20 → Oct 5", status: "active", color: "#c9961f", x: 6, y: 8, w: 36, h: 18,
      plantings: [
        { id: "a1", crop: "Bloody Butcher Corn", variety: "OP heirloom", role: "structure", planted: "May 12", stage: "V8 · pre-tassel", harvest: "Sep 18", color: "#c9961f", area: "0.8 ac (full row)", source: "Direct seed · 28k pop/ac", companions: ["a2", "a3"], status: "active" },
          { id: "a2", crop: "Cherokee Trail-of-Tears Bean", variety: "climbing dry", role: "nitrogen + climber", planted: "May 26 (today)", stage: "pending sow", harvest: "Sep 5", color: "#7a3a4d", area: "interplant · 1 bean per corn hill", source: "Companion plugin (3-sisters)", companions: ["a1", "a3"], status: "planned" },
          { id: "a3", crop: "Seminole Pumpkin", variety: "C. moschata", role: "groundcover + pest", planted: "Jun 2 (planned)", stage: "pending sow", harvest: "Oct 5", color: "#a85a1f", area: "row ends + perimeter", source: "Companion plugin (3-sisters)", companions: ["a1"], status: "planned" },
        ],
      },
    { id: "b", label: "Block B", acres: 0.4, crop: "Brandywine Tomato + Marigold border", variety: "indeterminate + french marigold", stage: "transplant", planted: "May 28 (planned)", harvest: "Aug 5 – Sep 30", status: "planned", color: "#a23a3a", x: 44, y: 8, w: 22, h: 18,
      plantings: [
        { id: "b1", crop: "Brandywine Tomato", variety: "indeterminate heirloom", role: "main", planted: "May 28", stage: "transplant (planned)", harvest: "Aug 5 – Sep 30", color: "#a23a3a", area: "0.36 ac · 24″ spacing", source: "Owner plan", companions: ["b2"], status: "planned" },
        { id: "b2", crop: "French Marigold", variety: "Tagetes patula", role: "pest deterrent border", planted: "May 28", stage: "transplant (planned)", harvest: "—", color: "#d99a3a", area: "0.04 ac · perimeter", source: "Companion plugin (marigold-tomato)", companions: ["b1"], status: "planned" },
      ],
    },
    { id: "c", label: "Block C", acres: 0.6, crop: "Cover: Rye + Hairy Vetch", variety: "cover crop mix", stage: "boot", planted: "Oct 4 '25", harvest: "Burndown May 27", status: "terminating", color: "#6b7e3a", x: 6, y: 30, w: 28, h: 16,
      plantings: [
        { id: "c1", crop: "Cereal Rye", variety: "VNS", role: "biomass / weed suppression", planted: "Oct 4 '25", stage: "boot · ready to terminate", harvest: "—", color: "#6b7e3a", area: "0.6 ac · drilled", source: "Cover crop plugin", companions: ["c2"], status: "terminating" },
        { id: "c2", crop: "Hairy Vetch", variety: "VNS", role: "N fixation", planted: "Oct 4 '25", stage: "early bloom", harvest: "—", color: "#8a6a9a", area: "co-seeded with rye", source: "Cover crop plugin", companions: ["c1"], status: "terminating" },
      ],
    },
    { id: "d", label: "Block D", acres: 0.3, crop: "Spring Lettuce Mix", variety: "4-cultivar blend", stage: "harvest-ready", planted: "Mar 30", harvest: "May 27 – Jun 18", status: "active", color: "#4a8b54", x: 36, y: 30, w: 18, h: 16,
      plantings: [
        { id: "d1", crop: "Lettuce — 4-cv mix", variety: "Salanova / Forellenschluss / Lollo / Buttercrunch", role: "main", planted: "Mar 30", stage: "harvest-ready (cut & come again)", harvest: "May 27 – Jun 18", color: "#4a8b54", area: "0.3 ac", source: "Owner succession plan", companions: [], status: "active" },
      ],
    },
    { id: "e", label: "Block E", acres: 0.5, crop: "Cascade Hops", variety: "perennial", stage: "burr", planted: "2023", harvest: "Aug 20 – Sep 5", status: "active", color: "#8a6b3a", x: 56, y: 30, w: 18, h: 16,
      plantings: [
        { id: "e1", crop: "Cascade Hops", variety: "perennial bine", role: "main", planted: "2023", stage: "burr (early cones)", harvest: "Aug 20 – Sep 5", color: "#8a6b3a", area: "0.5 ac · 16′ trellis", source: "Owner plan", companions: [], status: "active" },
      ],
    },
    { id: "f", label: "Orchard", acres: 1.2, crop: "Apple Goldrush + Clover understory", variety: "scab-resistant", stage: "petal-fall", planted: "2021", harvest: "Oct 10 – Nov 1", status: "active", color: "#c9461f", x: 6, y: 50, w: 68, h: 22,
      plantings: [
        { id: "f1", crop: "Apple — Goldrush", variety: "semi-dwarf, scab-resistant", role: "main", planted: "2021", stage: "petal-fall", harvest: "Oct 10 – Nov 1", color: "#c9461f", area: "1.2 ac · 18′ × 12′ grid", source: "Owner plan", companions: ["f2"], status: "active" },
        { id: "f2", crop: "White Clover Understory", variety: "living mulch", role: "pollinator + N + mulch", planted: "2022", stage: "established", harvest: "—", color: "#4d8e36", area: "row middles", source: "Companion plugin (clover-orchard)", companions: ["f1"], status: "active" },
      ],
    },
    { id: "g", label: "Block G", acres: 1.0, crop: "Painted Mountain Flour Corn", variety: "OP heirloom", stage: "V6", planted: "May 3", harvest: "Sep 30 (R6)", status: "active", color: "#8a5a2c", x: 50, y: 50, w: 24, h: 14,
      plantings: [
        { id: "g1", crop: "Painted Mountain Flour Corn", variety: "OP heirloom", role: "main", planted: "May 3", stage: "V6 · pre-tassel", harvest: "Sep 30", color: "#8a5a2c", area: "1.0 ac · 28k pop/ac", source: "Owner plan", companions: [], status: "active" },
      ],
    },
  ],
  sprayers: [
    { id: "bp1", label: "Backpack Sprayer 1", lastLoad: "2,4-D (synthetic-auxin)", state: "dirty", deconDays: 0 },
    { id: "bp2", label: "Backpack Sprayer 2", lastLoad: null, state: "clean", deconDays: 14 },
    { id: "tow", label: "Tow Boom 25 gal", lastLoad: "Glyphosate", state: "clean", deconDays: 6 },
  ],
  // Spray flow — building a tank mix
  sprayPlan: {
    // Multi-block target: combined post-emerge across two corn blocks
    // since both are pre-tassel and the chemistry is identical.
    blocks: [
      { id: "a", plantingId: "a1", area: 0.8, stage: "V8 · pre-tassel" },
      { id: "g", plantingId: "g1", area: 1.0, stage: "V6 · pre-tassel" },
    ],
    blockCompatibility: {
      ok: true,
      label: "Kernel verified — same chemistry profile",
      reason: "Both blocks are corn (Bloody Butcher V8, Painted Mountain V6). Atrazine label OK through V12 for both; glyphosate hooded-sprayer rule applies equally. No drift-sensitive crops within 30 ft of either block.",
    },
    crop: "Corn (2 varieties)",
    stage: "V6 – V8 · pre-tassel",
    sprayer: "tow",
    // Structured targets — primary species shown as chips, rest collapsed under "+N more".
    targets: [
      { name: "Foxtail (giant)",  pressure: "heavy",    primary: true },
      { name: "Smartweed",        pressure: "moderate", primary: true },
      { name: "Lambsquarter",     pressure: "moderate", primary: true },
      { name: "Pigweed (redroot)",pressure: "light",    primary: false },
      { name: "Crabgrass",        pressure: "trace",    primary: false },
      { name: "Velvetleaf",       pressure: "trace",    primary: false },
    ],
    targetSummary: "Foxtail + smartweed + 4 others (post-emerge grass & broadleaf)",
    area: 1.8,         // sum of block areas
    gpa: 18,           // calibrated gal/ac
    totalGal: 33,      // ≈ area × gpa (rounded for clean math)
    tankSize: 25,      // single 25-gal tow boom
    tanks: [
      { idx: 1, fill: 25, label: "Tank 1 · full" },
      { idx: 2, fill: 8,  label: "Tank 2 · partial" },
    ],
    products: [
      { id: "p1", name: "Atrazine 4L",          color: "#2C5237",  group: "Photosystem-II inhibitor (Group 5)", rate: "1.5 qt/A",   total: "2.75 qt",    perTank: ["2.10 qt", "0.65 qt"],   restrictions: "Pre-tassel only — OK at V8", status: "ok" },
      { id: "p2", name: "Roundup PowerMax 3",   color: "#8A6722",  group: "Glyphosate (Group 9)",               rate: "32 fl oz/A", total: "58.6 fl oz", perTank: ["44.4 fl oz", "14.2 fl oz"], restrictions: "Hooded sprayer only over corn — set rate to 0 unless drop nozzles confirmed", status: "warn", warning: "Glyphosate over non-RR corn requires hooded sprayer or drop nozzles. Confirm equipment." },
      { id: "p3", name: "Crop Oil Concentrate", color: "#B8893C",  group: "Adjuvant",                            rate: "1% v/v",     total: "0.33 gal",   perTank: ["0.25 gal", "0.08 gal"], restrictions: "—", status: "ok" },
    ],
    waterColor: "#6F8FA8",
    waterPerTank: ["22.9 gal", "7.3 gal"],
    waterTotal: "30.2 gal",
    checks: [
      { id: "wind", label: "Wind speed", value: "6 mph SW", ok: true, threshold: "≤10 mph" },
      { id: "temp", label: "Air temp", value: "68°F", ok: true, threshold: "60–85°F" },
      { id: "rain", label: "Rain forecast (6h)", value: "0% — clear", ok: true, threshold: "≤20%" },
      { id: "stage", label: "Crop stage gate", value: "V8 (pre-tassel)", ok: true, threshold: "before VT" },
      { id: "sprayer", label: "Sprayer state", value: "Tow Boom — clean", ok: true, threshold: "decon current" },
      { id: "phi", label: "Pre-harvest interval", value: "112 days to R6", ok: true, threshold: "atrazine ≥60 d" },
    ],
  },
  scoutNotes: [
    { date: "May 24", block: "Block A", pest: "Earworm (trap)", count: "8 moths / week", threshold: "≥6", action: "Flagged" },
    { date: "May 23", block: "Block D", pest: "Aphid (visual)", count: "2 / leaf", threshold: "≥10", action: "Below threshold" },
  ],
  // Plugin suggestions
  suggestions: [
    { id: "s1", crop: "Bloody Butcher Corn", title: "Side-dress N at V8–V10", source: "UMD Extension small-plot guideline", window: "May 27 – Jun 4", priority: "high" },
    { id: "s2", crop: "Cover crop (rye/vetch)", title: "Terminate before flowering", source: "Cover crop plugin", window: "May 27 – Jun 2", priority: "high" },
    { id: "s3", crop: "Brandywine Tomato", title: "Plant marigold border (companion)", source: "Companion plugin (marigold-tomato)", window: "On transplant", priority: "med" },
  ],
  kpis: {
    activePlantings: 6,
    sprayRecordsYTD: 14,
    nextHarvestDays: 1,
    pluginCount: 308,
  },
};
