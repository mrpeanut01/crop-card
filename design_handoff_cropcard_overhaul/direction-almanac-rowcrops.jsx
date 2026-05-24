/* Direction A — Almanac · Row-crop archetype screens
   Extends the plugin-driven crop archetype set with the row crops in
   play on Sherry's farm. Each screen is the visual proof that the
   plugin engine handles wildly different stage scales, harvest schemas
   and decision payloads without code branching.

     1. Corn (Bloody Butcher / Painted Mtn) — V/R stages + side-dress N + pollination window + grain moisture
     2. Bean (Cherokee Trail-of-Tears)      — climbing pole, dry-seed harvest (Three Sisters)
     3. Pumpkin (Seminole) / cucurbit       — vine run, male/female flower, fruit set, cure
     4. Tomato (Brandywine) / indeterminate — continuous weekly harvest, blight pressure
     5. Lettuce (4-cv mix) / cut-and-come-again — succession + bolt heat-trigger
     6. Cover crop (rye + vetch)            — biomass + termination decision + N credit

   Each screen uses A_TopBar, A_Card, A_Pill, A_Kicker, A_primaryBtn,
   A_ghostBtn from the Almanac chrome. Mock data is inlined as ROW_CROPS
   (engineering rebuilds against real plugin JSON anyway). */

const ROW_CROPS = {
  corn: {
    block: { label: "Block A", crop: "Bloody Butcher Corn", variety: "OP heirloom flour corn", acres: 1.1, planted: "May 12 '26", harvest: "Late Sep '26 (R6 black layer)" },
    stageScale: "V/R (Iowa State)",
    schemaKind: "grain-row-crop",
    currentStage: { id: "V4", label: "4 collared leaves", date: "May 26", next: "V6 — side-dress window opens" },
    stages: [
      { id: "VE",  label: "Emergence",          when: "May 18", done: true },
      { id: "V2",  label: "2 leaves",           when: "May 22", done: true },
      { id: "V4",  label: "4 leaves · NOW",     when: "May 26", current: true },
      { id: "V6",  label: "Side-dress N",       when: "Jun 4",  fertilityGate: true },
      { id: "V8",  label: "8 leaves",           when: "Jun 14" },
      { id: "VT",  label: "Tassel — pollen",    when: "Jul 12", pollination: true },
      { id: "R1",  label: "Silking",            when: "Jul 16", pollination: true },
      { id: "R3",  label: "Milk",               when: "Aug 6" },
      { id: "R5",  label: "Dent",               when: "Aug 28" },
      { id: "R6",  label: "Black layer",        when: "Sep 22", harvestGate: true },
    ],
    sideDress: {
      windowOpens: "Jun 4 (V6)",
      windowCloses: "Jun 18 (V10 — too tall to cultivate)",
      rate: "80 lb N/A (urea, broadcast + cultivate)",
      source: "UMD Extension small-plot guide",
      preplant: { rate: "60 lb N/A · urea", when: "May 10 ✓ applied" },
    },
    pollinationWindow: {
      heat: { gddTotal: 1450, gddNeeded: 1490, units: "GDD50 from emergence" },
      isolation: "880 ft from any other corn variety (OP seed-saving)",
      nearest: "Block G · Painted Mtn — 1,100 ft (safe)",
      crossRisk: "Same species — staggered tassel by 14 d using companion-bean shade. Pollination layer cleared.",
    },
    harvestSchema: {
      mode: "Ear pick + shell + dry",
      moistureFieldMax: 25,   // can pick at field-dry
      moistureStorageMax: 13.5,
      shelfYield: "bu × 56 lb/bu",
      target: { bu: 36, lb: 2016 },
    },
  },

  bean: {
    block: { label: "Block A", crop: "Cherokee Trail-of-Tears Bean", variety: "OP heirloom pole · dry seed", acres: 1.1, planted: "May 26 '26 (target)", harvest: "Oct 5 – Oct 18 '26 (dry pod)" },
    stageScale: "Bean BBCH",
    schemaKind: "dry-seed-legume",
    role: "Three-Sisters N-fixer / climber on corn",
    currentStage: { id: "Pre-plant", label: "Awaiting V4 corn", date: "May 26", next: "Drop bean seed 1 per corn hill" },
    stages: [
      { id: "Plant", label: "Drop 1 per corn hill", when: "May 26", current: true },
      { id: "VE",    label: "Cotyledon",            when: "Jun 5" },
      { id: "V1",    label: "Unifoliate",          when: "Jun 12" },
      { id: "V3",    label: "3rd trifoliate",      when: "Jun 26", climbGate: true },
      { id: "R1",    label: "First flower",        when: "Jul 18" },
      { id: "R3",    label: "Pod set",             when: "Aug 1" },
      { id: "R5",    label: "Seed fill",           when: "Aug 22" },
      { id: "R7",    label: "Pod yellowing",       when: "Sep 18" },
      { id: "R8",    label: "Dry pod · pick",      when: "Oct 5", harvestGate: true },
      { id: "R9",    label: "Field dry",           when: "Oct 18", harvestGate: true },
    ],
    threeSisters: {
      cornStage: "V4 → V6 (now)",
      offset: "+14 d after corn emergence (companion plugin)",
      hillSpacing: "1 bean per corn hill",
      pollinator: "Self-pollinated · low pollinator-gate risk",
    },
    harvestSchema: {
      mode: "Dry-pod hand-pick · thresh on tarp",
      moistureFieldMax: 18,
      moistureStorageMax: 13,
      yieldUnits: "lb dry seed",
      target: { lb: 38, seedsSaved: "~ 14,000 seeds → next-year supply + sale" },
    },
    pestScout: {
      window: "Jul 1 – Aug 30 · bi-weekly",
      threshold: "1 Mexican Bean Beetle / 6 plants → spotted-cucumber-beetle larva: action",
      product: "Pyganic + kaolin clay if needed (OMRI · matches Sherry's pesticide philosophy)",
    },
  },

  pumpkin: {
    block: { label: "Block A", crop: "Seminole Pumpkin", variety: "C. moschata · vine · landrace", acres: 1.1, planted: "Jun 2 '26 (target)", harvest: "Sep 28 – Oct 18 '26 + 14-d cure" },
    stageScale: "Cucurbit BBCH",
    schemaKind: "winter-squash",
    role: "Three-Sisters ground-cover / weed-suppress",
    currentStage: { id: "Pre-plant", label: "Awaiting V6 corn", date: "May 26", next: "Direct-seed perimeter when corn at V6" },
    stages: [
      { id: "Seed",  label: "Direct seed perim.", when: "Jun 2",   current: true },
      { id: "VE",    label: "Cotyledon",         when: "Jun 10" },
      { id: "V3",    label: "Vine run begins",   when: "Jun 28" },
      { id: "R1m",   label: "♂ flower first",    when: "Jul 22", flowerGate: true },
      { id: "R1f",   label: "♀ flower opens",    when: "Jul 30", flowerGate: true, pollinator: true },
      { id: "R2",    label: "Fruit set",         when: "Aug 5",  pollinator: true },
      { id: "R5",    label: "Rind hardens",      when: "Sep 14" },
      { id: "R6",    label: "Vine die-back",     when: "Sep 26" },
      { id: "Harv",  label: "Cut + cure",        when: "Sep 28", harvestGate: true },
      { id: "Cure",  label: "14-d cure @ 80°F",  when: "Oct 12", harvestGate: true },
    ],
    pollinatorGate: {
      need: "Open ♀ flowers require active bees on the day they open (one-day window)",
      pollinatorBlock: "No insecticide spraying within Block A or adjacent Block G during 6 am – 11 am Jul 22 – Aug 12",
      kernelRule: "Hard-locked: any insecticide tank-mix with a bee-toxic AI is blocked during this window for blocks within 200 ft of cucurbit ♀-flower",
    },
    pmRisk: {
      model: "Powdery-mildew NEWA forecast",
      currentRisk: "low (DSV 12)",
      threshold: "Action at DSV 20",
      product: "Stylet-oil or sulfur (organic-allowed) — Sherry's philosophy approves",
    },
    harvestSchema: {
      mode: "Cut stem · cure 10-14 d at 80°F · store at 50-55°F",
      yieldUnits: "fruit count + lb",
      target: { count: 80, lb: 320, perFruit: "4 lb avg" },
      ph2: "Cure required before storage; uncured fruit rots in 3 weeks.",
    },
  },

  tomato: {
    block: { label: "Block B", crop: "Brandywine Tomato", variety: "Sudduth's strain · pink beefsteak · indeterminate", acres: 0.3, planted: "May 28 '26 (transplant)", harvest: "Aug 5 – Sep 30 '26 (weekly)" },
    stageScale: "Tomato BBCH",
    schemaKind: "continuous-harvest-fruit",
    currentStage: { id: "Pre-transplant", label: "Hardened starts · 6 wk", date: "May 26", next: "Transplant after last-frost-safe (May 28)" },
    stages: [
      { id: "TP",    label: "Transplant",         when: "May 28", current: true },
      { id: "Est",   label: "Established · 14 d", when: "Jun 11" },
      { id: "FT1",   label: "First flower truss", when: "Jun 28" },
      { id: "FT3",   label: "3rd truss",          when: "Jul 18" },
      { id: "FS",    label: "First fruit set",    when: "Jul 8" },
      { id: "MG",    label: "Mature green",       when: "Aug 1" },
      { id: "BR",    label: "Breaker — pick",     when: "Aug 5", harvestGate: true },
      { id: "Cont",  label: "Continuous pick",    when: "Aug 5 – Sep 30", harvestGate: true },
      { id: "End",   label: "Frost-kill / cull",  when: "Oct 8" },
    ],
    harvestSchedule: [
      { week: "Aug 5",  est: 8,  status: "expected" },
      { week: "Aug 12", est: 16, status: "expected" },
      { week: "Aug 19", est: 28, status: "expected" },
      { week: "Aug 26", est: 36, status: "expected" },
      { week: "Sep 2",  est: 32, status: "expected" },
      { week: "Sep 9",  est: 28, status: "expected" },
      { week: "Sep 16", est: 22, status: "expected" },
      { week: "Sep 23", est: 12, status: "expected" },
      { week: "Sep 30", est: 4,  status: "expected" },
    ],
    blightPressure: {
      diseases: [
        { name: "Early blight (Alternaria)",     risk: "moderate", threshold: "Apply if 7-day rain ≥ 1.5\" + temp 75-85°F",  product: "Bonide Copper Fungicide (OMRI)" },
        { name: "Late blight (Phytophthora)",     risk: "low",      threshold: "USABlight reports + cool/wet 7-day forecast", product: "Cease (Bacillus subtilis) · prophylactic" },
        { name: "Septoria leaf spot",            risk: "moderate", threshold: "Lower-leaf yellowing + spots > 5 per leaf",     product: "Sanitation + copper" },
      ],
      companion: "French Marigold border (auto-companion) — root knot nematode + tomato hornworm deterrent",
    },
    harvestSchema: {
      mode: "Weekly hand-pick at breaker stage · CSA + farmers' market",
      yieldUnits: "lb",
      target: { lb: 180, weeks: 9, perWeek: "~ 20 lb avg" },
    },
  },

  lettuce: {
    block: { label: "Block D", crop: "Lettuce — 4-cv mix", variety: "Salanova + Red Sails + Buttercrunch + Tango", acres: 0.3, planted: "Mar 30 '26 (direct seed)", harvest: "May 21 – Jun 24 '26 (3 cuts)" },
    stageScale: "Lettuce BBCH",
    schemaKind: "cut-and-come-again",
    currentStage: { id: "Cut 1", label: "First cut complete", date: "May 26", next: "Regrow → 2nd cut May 27" },
    stages: [
      { id: "Seed", label: "Direct seed",          when: "Mar 30", done: true },
      { id: "VE",   label: "Cotyledon",           when: "Apr 8",  done: true },
      { id: "V4",   label: "4 true leaves",       when: "Apr 28", done: true },
      { id: "Hd",   label: "Heading (button)",    when: "May 18", done: true },
      { id: "C1",   label: "Cut 1 · 85 lb",       when: "May 21", done: true },
      { id: "C2",   label: "Cut 2 · 75 lb",       when: "May 27", current: true, harvestGate: true },
      { id: "C3",   label: "Cut 3 · 60 lb",       when: "Jun 10", harvestGate: true },
      { id: "Bolt", label: "Bolt + replant",      when: "Jun 24", boltGate: true },
    ],
    succession: {
      cadence: "14 d between sowings (leafy-green family rule per Phase 20)",
      blocks: [
        { id: "D1",  sown: "Mar 30 ✓", cuts: 3, status: "active" },
        { id: "D2",  sown: "Apr 13 ✓", cuts: 2, status: "active" },
        { id: "D3",  sown: "Apr 27 ✓", cuts: 1, status: "active" },
        { id: "D4",  sown: "May 11 ✓", cuts: 0, status: "establishing" },
        { id: "D5",  sown: "May 25 (today)", cuts: 0, status: "today" },
        { id: "D6",  sown: "Aug 1",  cuts: 0, status: "fall sown" },
      ],
    },
    boltTrigger: {
      heatModel: "3 consecutive days ≥ 80°F or 1 night ≥ 70°F",
      forecast: "May 28 high 82°F · May 29 high 85°F · ⚠ bolt risk",
      action: "Take Cut 2 May 27 (one day early) · replant cool-season variety in shade or shift to summer-tolerant crisphead",
    },
    harvestSchema: {
      mode: "Cut-and-come-again · 2-3 cuts before bolt",
      yieldUnits: "lb / cut",
      target: { lb: 220, cuts: 3, perCut: "85 / 75 / 60 lb declining" },
    },
  },

  cover: {
    block: { label: "Block C", crop: "Cereal Rye + Hairy Vetch", variety: "Aroostook rye + AU Merit vetch", acres: 1.2, planted: "Sep 28 '25 (drilled)", harvest: "Termination Apr 26 – May 15 '26" },
    stageScale: "Cover-crop biomass",
    schemaKind: "cover-crop-termination",
    role: "Biomass + N fix → cash crop bed prep",
    currentStage: { id: "Term", label: "Termination decision · NOW", date: "May 26", next: "Choice: roll-crimp · mow · burndown" },
    stages: [
      { id: "Est",  label: "Established · fall",    when: "Oct 12 '25", done: true },
      { id: "Dorm", label: "Winter dormant",        when: "Dec '25",    done: true },
      { id: "Grw",  label: "Spring growth",         when: "Mar '26",    done: true },
      { id: "Bm",   label: "Biomass peak",          when: "May 8 '26",  done: true },
      { id: "Pre",  label: "Rye boot · vetch flow", when: "May 20 '26", done: true, terminateGate: true },
      { id: "Now",  label: "Termination window",    when: "May 26 '26", current: true, terminateGate: true },
      { id: "Late", label: "Rye anthesis (too late)", when: "Jun 5 '26", terminateGate: true },
    ],
    biomass: {
      lastSampled: "May 20",
      yieldsDryMatter: 5800,           // lb DM / ac
      target: 5000,
      nCredit: 75,                     // lb N / ac from vetch
      ratio: { ryePct: 70, vetchPct: 30 },
      cnRatio: 28,                     // C:N · risk of N tie-up if > 30
    },
    terminationOptions: [
      { id: "roll", label: "Roll-crimp",   note: "Rye must be at anthesis (Z61). Currently at boot — too early. Wait 5-7 d.", recommend: false, gate: "wait" },
      { id: "mow",  label: "Mow",          note: "Suppress without kill. Vetch regrows. Use if cash crop tolerates partial cover.", recommend: false, gate: null },
      { id: "burn", label: "Burndown (glyphosate)", note: "Sherry's philosophy = no-glyphosate. Blocked at safety kernel.", recommend: false, gate: "blocked" },
      { id: "till", label: "Tillage incorporate", note: "Sherry's philosophy = reduced-till. Allowed once per season — uses your tillage budget.", recommend: true, gate: "tillage-budget" },
    ],
    nextCrop: {
      crop: "Block C · Summer fallow → garlic Oct '26",
      gap: "120 days fallow — terminate now; broadcast buckwheat smother in 2 weeks.",
    },
  },
};

/* ── Shared helpers ───────────────────────────────────────────── */
const _rcKic = () => ({ fontSize: 11, fontWeight: 600, color: "#7A7F75", letterSpacing: "0.12em", textTransform: "uppercase" });
const _rcMono = { fontFamily: "IBM Plex Mono, ui-monospace, monospace" };

function RCPluginBanner({ schemaKind, note }) {
  const A = window.A_tokens;
  return (
    <div style={{
      padding: "10px 14px", marginBottom: 14, background: "#EFF6E9",
      border: `1px solid #C9DBC0`, borderLeft: `3px solid ${A.forest}`, borderRadius: 8,
      fontSize: 12.5, color: A.forestDeep, display: "flex", alignItems: "center", gap: 10
    }}>
      <Icon.Info size={14} stroke={A.forest} />
      <span><strong>Plugin-driven schema:</strong> <span style={_rcMono}>schemaKind: "{schemaKind}"</span> · {note}</span>
    </div>
  );
}

function RCHeader({ block, currentStage, stageScale }) {
  const A = window.A_tokens;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 18 }}>
      <div>
        <div style={_rcKic()}>{block.label} · {block.acres} ac · stage scale: {stageScale} · current: {currentStage.id}</div>
        <h1 className="serif" style={{ margin: "6px 0 0", fontSize: 30, color: A.forestDeep, letterSpacing: "-0.02em", lineHeight: 1.05 }}>{block.crop}</h1>
        <div style={{ fontSize: 13, color: A.inkMuted, marginTop: 3 }}>{block.variety} · planted {block.planted} · harvest target {block.harvest}</div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={A_ghostBtn}><Icon.Wrench size={14} /> Edit block</button>
        <button style={A_primaryBtn}><Icon.Plus size={14} /> Record event</button>
      </div>
    </div>
  );
}

function RCStageTimeline({ stages, title, subtitle }) {
  const A = window.A_tokens;
  return (
    <A_Card padded={false} style={{ marginBottom: 14 }}>
      <div style={{ padding: "12px 18px 8px", borderBottom: `1px solid ${A.dividerSoft}` }}>
        <h3 className="serif" style={{ margin: 0, fontSize: 16, color: A.forestDeep }}>{title}</h3>
        {subtitle && <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 2 }}>{subtitle}</div>}
      </div>
      <div style={{ padding: "16px 22px", position: "relative" }}>
        <div style={{ position: "absolute", left: 22, right: 22, top: 38, height: 2, background: A.divider, borderRadius: 99 }} />
        <div style={{ position: "relative", display: "flex", justifyContent: "space-between" }}>
          {stages.map((s) => {
            // tone for the dot
            let bg = A.paper, bd = A.divider, sym = "", symColor = A.inkSoft;
            if (s.done) { bg = A.forest; bd = A.forest; sym = "✓"; symColor = A.cream; }
            else if (s.current) { bg = A.wheat; bd = A.wheat; sym = "●"; symColor = A.cream; }
            else if (s.harvestGate) { bg = "#E8D9B5"; bd = "#D9C18F"; sym = "★"; symColor = "#8A6722"; }
            else if (s.fertilityGate) { bg = "#DEE7EF"; bd = "#BDCDD9"; sym = "N"; symColor = "#3A586E"; }
            else if (s.pollination) { bg = "#F1D9CE"; bd = "#E2B69E"; sym = "♀"; symColor = "#8A341B"; }
            else if (s.flowerGate) { bg = "#F8E6CF"; bd = "#E5C9A3"; sym = "✿"; symColor = "#8A6722"; }
            else if (s.boltGate) { bg = "#F1D9CE"; bd = "#E2B69E"; sym = "↑"; symColor = "#8A341B"; }
            else if (s.terminateGate) { bg = "#F1D9CE"; bd = "#E2B69E"; sym = "✕"; symColor = "#8A341B"; }
            else if (s.climbGate) { bg = "#E5EEDF"; bd = "#C9DBC0"; sym = "↗"; symColor = A.forest; }
            return (
              <div key={s.id} style={{ flex: 1, textAlign: "center", position: "relative" }} title={`${s.label} (${s.id}) — ${s.when}`}>
                <div style={{
                  width: 22, height: 22, borderRadius: 99,
                  background: bg, border: `2px solid ${bd}`,
                  margin: "12px auto 8px", display: "grid", placeItems: "center",
                  fontSize: 10, fontWeight: 800, color: symColor,
                  position: "relative", zIndex: 1,
                }}>{sym}</div>
                <div style={{ ..._rcMono, fontSize: 10.5, color: s.current ? A.forestDeep : A.inkMuted, fontWeight: 700 }}>{s.id}</div>
                <div style={{ fontSize: 10.5, color: A.inkSoft, marginTop: 2, lineHeight: 1.3, padding: "0 4px" }}>{s.label}</div>
                <div style={{ ..._rcMono, fontSize: 9.5, color: A.inkMuted, marginTop: 2 }}>{s.when}</div>
              </div>
            );
          })}
        </div>
      </div>
    </A_Card>
  );
}

function RCShell({ data, schemaNote, children }) {
  const A = window.A_tokens;
  return (
    <div className="dir-a" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <A_TopBar active="plan" />
      <div style={{ flex: 1, overflow: "auto", padding: "22px 28px 28px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <RCHeader block={data.block} currentStage={data.currentStage} stageScale={data.stageScale} />
          <RCPluginBanner schemaKind={data.schemaKind} note={schemaNote} />
          <RCStageTimeline stages={data.stages} title={`Phenology · ${data.stageScale}`} subtitle={`${data.currentStage.label} (${data.currentStage.id}) · ${data.currentStage.date} · next: ${data.currentStage.next}`} />
          {children}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ 1 · CORN ════════════════════════════════ */
function ACornPlanScreen() {
  const A = window.A_tokens;
  const c = ROW_CROPS.corn;
  return (
    <RCShell data={c} schemaNote="V-stages + R-stages with pollination + side-dress + grain-moisture harvest fields. NOT bushels-only like wheat — corn ships as ear-count OR shelled lb.">
      {/* Side-dress N + Pollination */}
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 14, marginBottom: 14 }}>
        <A_Card padded={false}>
          <div style={{ padding: "13px 18px 10px", borderBottom: `1px solid ${A.dividerSoft}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon.Droplet size={15} stroke={A.sky} />
              <h3 className="serif" style={{ margin: 0, fontSize: 16, color: A.forestDeep }}>Side-dress N · window opens {c.sideDress.windowOpens}</h3>
              <A_Pill tone="sky">in 9 d</A_Pill>
            </div>
            <div style={{ fontSize: 12, color: A.inkMuted, marginTop: 4 }}>Crop plugin rule: corn side-dresses between V6 and V10. After V10 the canopy blocks cultivation.</div>
          </div>
          <div style={{ padding: "14px 18px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <div style={_rcKic()}>Pre-plant · DONE</div>
              <div style={{ marginTop: 6, fontSize: 13.5, color: A.ink, fontWeight: 600 }}>{c.sideDress.preplant.rate}</div>
              <div style={{ ..._rcMono, fontSize: 11.5, color: A.inkMuted, marginTop: 2 }}>{c.sideDress.preplant.when}</div>
            </div>
            <div>
              <div style={_rcKic()}>Side-dress · planned</div>
              <div style={{ marginTop: 6, fontSize: 13.5, color: A.forestDeep, fontWeight: 600 }}>{c.sideDress.rate}</div>
              <div style={{ ..._rcMono, fontSize: 11.5, color: A.inkMuted, marginTop: 2 }}>{c.sideDress.source}</div>
            </div>
          </div>
          <div style={{ padding: "10px 18px 14px", borderTop: `1px dashed ${A.dividerSoft}`, background: A.cream, fontSize: 11.5, color: A.inkSoft }}>
            <strong style={{ color: A.forestDeep }}>Hard close:</strong> {c.sideDress.windowCloses}. After this point, broadcast nitrogen risks burning the whorl. Switch to fertigation or fly-on.
          </div>
        </A_Card>
        <A_Card padded={false}>
          <div style={{ padding: "13px 18px 10px", borderBottom: `1px solid ${A.dividerSoft}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon.Sun size={15} stroke={A.wheat} />
              <h3 className="serif" style={{ margin: 0, fontSize: 16, color: A.forestDeep }}>Pollination window</h3>
              <A_Pill tone="wheat">Jul 12 – Jul 22</A_Pill>
            </div>
            <div style={{ fontSize: 12, color: A.inkMuted, marginTop: 4 }}>10-day overlap of tassel pollen + silk receptivity. Heat / drought / cross-pollination risks.</div>
          </div>
          <div style={{ padding: "14px 18px" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span className="serif" style={{ fontSize: 28, color: A.forestDeep, fontWeight: 600, letterSpacing: "-0.02em" }}>{c.pollinationWindow.heat.gddTotal}</span>
              <span style={{ fontSize: 12, color: A.inkSoft }}>/ {c.pollinationWindow.heat.gddNeeded} {c.pollinationWindow.heat.units}</span>
            </div>
            <div style={{ marginTop: 8, height: 6, background: A.cream, borderRadius: 99, overflow: "hidden", border: `1px solid ${A.divider}` }}>
              <div style={{ height: "100%", width: `${(c.pollinationWindow.heat.gddTotal / c.pollinationWindow.heat.gddNeeded * 100).toFixed(0)}%`, background: A.wheat }} />
            </div>
            <div style={{ marginTop: 12, padding: "8px 10px", background: "#EFF6E9", border: `1px solid #C9DBC0`, borderRadius: 6, fontSize: 11.5, color: A.forestDeep, lineHeight: 1.5 }}>
              <strong>OP seed-saving isolation:</strong> {c.pollinationWindow.isolation}<br />
              <span style={{ color: A.inkSoft }}>Nearest other corn: {c.pollinationWindow.nearest}</span>
            </div>
            <div style={{ marginTop: 8, fontSize: 11.5, color: A.inkSoft, lineHeight: 1.5 }}>{c.pollinationWindow.crossRisk}</div>
          </div>
        </A_Card>
      </div>

      {/* Harvest schema */}
      <A_Card padded={false}>
        <div style={{ padding: "13px 18px 10px", borderBottom: `1px solid ${A.dividerSoft}` }}>
          <h3 className="serif" style={{ margin: 0, fontSize: 16, color: A.forestDeep }}>Harvest schema · <span style={{ color: A.inkMuted, fontWeight: 400 }}>grain-row-crop</span></h3>
          <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 2 }}>{c.harvestSchema.mode}. Two-moisture rule: pick at ≤{c.harvestSchema.moistureFieldMax}%, dry to ≤{c.harvestSchema.moistureStorageMax}% for storage.</div>
        </div>
        <div style={{ padding: "16px 18px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", gap: 14, alignItems: "end" }}>
          <div>
            <div style={{ ..._rcKic(), marginBottom: 5 }}>Ears picked</div>
            <input placeholder="0" style={{ width: "100%", padding: "10px 12px", background: A.cream, border: `1px solid ${A.divider}`, borderRadius: 6, fontSize: 16, ..._rcMono, outline: "none" }} />
            <div style={{ fontSize: 11, color: A.inkMuted, marginTop: 4 }}>target {c.harvestSchema.target.bu} bu ({c.harvestSchema.target.lb} lb shelled)</div>
          </div>
          <div>
            <div style={{ ..._rcKic(), marginBottom: 5 }}>Field moisture %</div>
            <input placeholder="22" style={{ width: "100%", padding: "10px 12px", background: A.cream, border: `1px solid ${A.divider}`, borderRadius: 6, fontSize: 16, ..._rcMono, outline: "none" }} />
            <div style={{ fontSize: 11, color: A.wheat, marginTop: 4, fontWeight: 600 }}>pick ≤ {c.harvestSchema.moistureFieldMax}%</div>
          </div>
          <div>
            <div style={{ ..._rcKic(), marginBottom: 5 }}>Shelled lb</div>
            <input placeholder="0" style={{ width: "100%", padding: "10px 12px", background: A.cream, border: `1px solid ${A.divider}`, borderRadius: 6, fontSize: 16, ..._rcMono, outline: "none" }} />
            <div style={{ fontSize: 11, color: A.inkMuted, marginTop: 4 }}>after shelling</div>
          </div>
          <div>
            <div style={{ ..._rcKic(), marginBottom: 5 }}>Storage moisture %</div>
            <input placeholder="13" style={{ width: "100%", padding: "10px 12px", background: A.cream, border: `1px solid ${A.divider}`, borderRadius: 6, fontSize: 16, ..._rcMono, outline: "none" }} />
            <div style={{ fontSize: 11, color: A.forest, marginTop: 4, fontWeight: 600 }}>store ≤ {c.harvestSchema.moistureStorageMax}%</div>
          </div>
          <button style={{ ...A_primaryBtn, padding: "10px 16px", fontSize: 14, height: 42 }}>Record</button>
        </div>
      </A_Card>
    </RCShell>
  );
}

/* ═══════════════════ 2 · BEAN (Three Sisters) ═══════════════════ */
function ABeanPlanScreen() {
  const A = window.A_tokens;
  const b = ROW_CROPS.bean;
  return (
    <RCShell data={b} schemaNote="Dry-seed legume schema · self-pollinating, NO pollinator-gate, harvest at field-dry pod (R8-R9), thresh + winnow.">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        {/* Three Sisters timing */}
        <A_Card padded={false}>
          <div style={{ padding: "13px 18px 10px", borderBottom: `1px solid ${A.dividerSoft}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon.Sprout size={15} stroke={A.forest} />
              <h3 className="serif" style={{ margin: 0, fontSize: 16, color: A.forestDeep }}>Three-Sisters polyculture</h3>
              <A_Pill tone="forest">Companion plugin</A_Pill>
            </div>
            <div style={{ fontSize: 12, color: A.inkMuted, marginTop: 4 }}>Companion plugin gates the bean planting date on corn's stage — drop too early, corn can't carry the climber.</div>
          </div>
          <div style={{ padding: "14px 18px", display: "grid", gridTemplateColumns: "auto 1fr", gap: 12, rowGap: 9 }}>
            <span style={_rcKic()}>Corn stage</span><span style={{ fontSize: 13, color: A.ink, fontWeight: 600 }}>{b.threeSisters.cornStage}</span>
            <span style={_rcKic()}>Plant offset</span><span style={{ fontSize: 13, color: A.ink, ..._rcMono }}>{b.threeSisters.offset}</span>
            <span style={_rcKic()}>Spacing</span><span style={{ fontSize: 13, color: A.ink }}>{b.threeSisters.hillSpacing}</span>
            <span style={_rcKic()}>Pollinator</span><span style={{ fontSize: 13, color: A.ink }}>{b.threeSisters.pollinator}</span>
          </div>
        </A_Card>
        {/* Pest scout cadence */}
        <A_Card padded={false}>
          <div style={{ padding: "13px 18px 10px", borderBottom: `1px solid ${A.dividerSoft}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon.Eye size={15} stroke={A.rust} />
              <h3 className="serif" style={{ margin: 0, fontSize: 16, color: A.forestDeep }}>IPM scout cadence</h3>
              <A_Pill tone="rust">Bi-weekly Jul–Aug</A_Pill>
            </div>
            <div style={{ fontSize: 12, color: A.inkMuted, marginTop: 4 }}>Mexican Bean Beetle (MBB) is the dominant pest here. Scouting prevents an unnecessary spray.</div>
          </div>
          <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 9 }}>
            <div><span style={_rcKic()}>Window</span><div style={{ marginTop: 4, fontSize: 13.5, color: A.ink }}>{b.pestScout.window}</div></div>
            <div><span style={_rcKic()}>Action threshold</span><div style={{ marginTop: 4, fontSize: 13, color: A.ink, lineHeight: 1.45 }}>{b.pestScout.threshold}</div></div>
            <div><span style={_rcKic()}>Product (if needed)</span><div style={{ marginTop: 4, fontSize: 13, color: A.ink, lineHeight: 1.45 }}>{b.pestScout.product}</div></div>
          </div>
        </A_Card>
      </div>

      {/* Dry-seed harvest schema */}
      <A_Card padded={false}>
        <div style={{ padding: "13px 18px 10px", borderBottom: `1px solid ${A.dividerSoft}` }}>
          <h3 className="serif" style={{ margin: 0, fontSize: 16, color: A.forestDeep }}>Harvest schema · <span style={{ color: A.inkMuted, fontWeight: 400 }}>dry-seed-legume</span></h3>
          <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 2 }}>{b.harvestSchema.mode}. {b.harvestSchema.target.seedsSaved}.</div>
        </div>
        <div style={{ padding: "16px 18px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 14, alignItems: "end" }}>
          <div>
            <div style={{ ..._rcKic(), marginBottom: 5 }}>Dry pod lb</div>
            <input placeholder="0" style={{ width: "100%", padding: "10px 12px", background: A.cream, border: `1px solid ${A.divider}`, borderRadius: 6, fontSize: 16, ..._rcMono, outline: "none" }} />
            <div style={{ fontSize: 11, color: A.inkMuted, marginTop: 4 }}>field pick · before threshing</div>
          </div>
          <div>
            <div style={{ ..._rcKic(), marginBottom: 5 }}>Clean seed lb</div>
            <input placeholder="0" style={{ width: "100%", padding: "10px 12px", background: A.cream, border: `1px solid ${A.divider}`, borderRadius: 6, fontSize: 16, ..._rcMono, outline: "none" }} />
            <div style={{ fontSize: 11, color: A.forest, marginTop: 4, fontWeight: 600 }}>target {b.harvestSchema.target.lb} lb</div>
          </div>
          <div>
            <div style={{ ..._rcKic(), marginBottom: 5 }}>Storage moisture %</div>
            <input placeholder="12" style={{ width: "100%", padding: "10px 12px", background: A.cream, border: `1px solid ${A.divider}`, borderRadius: 6, fontSize: 16, ..._rcMono, outline: "none" }} />
            <div style={{ fontSize: 11, color: A.forest, marginTop: 4, fontWeight: 600 }}>store ≤ {b.harvestSchema.moistureStorageMax}%</div>
          </div>
          <button style={{ ...A_primaryBtn, padding: "10px 16px", fontSize: 14, height: 42 }}>Record</button>
        </div>
      </A_Card>
    </RCShell>
  );
}

/* ═══════════════════ 3 · PUMPKIN (cucurbit) ═══════════════════ */
function APumpkinPlanScreen() {
  const A = window.A_tokens;
  const p = ROW_CROPS.pumpkin;
  return (
    <RCShell data={p} schemaNote="Winter-squash schema · monoecious (sep ♂/♀ flowers) — triggers pollinator-gate at female-flower window. Cure requirement before storage.">
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 14, marginBottom: 14 }}>
        {/* Pollinator gate (safety kernel) */}
        <A_Card padded={false} style={{ borderColor: "#E2B69E", borderWidth: 1.5 }}>
          <div style={{ padding: "13px 18px 10px", borderBottom: `1px solid #E2B69E`, background: "#FBF1E5" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon.Lock size={15} stroke={A.rust} />
              <h3 className="serif" style={{ margin: 0, fontSize: 16, color: "#8A341B" }}>Pollinator gate · hard-locked</h3>
              <A_Pill tone="rust">Safety kernel</A_Pill>
            </div>
            <div style={{ fontSize: 11.5, color: "#8A341B", marginTop: 4, lineHeight: 1.5 }}>{p.pollinatorGate.kernelRule}</div>
          </div>
          <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 9 }}>
            <div><span style={_rcKic()}>Need</span><div style={{ marginTop: 4, fontSize: 13, color: A.ink, lineHeight: 1.45 }}>{p.pollinatorGate.need}</div></div>
            <div><span style={_rcKic()}>Block</span><div style={{ marginTop: 4, fontSize: 13, color: A.ink, lineHeight: 1.45 }}>{p.pollinatorGate.pollinatorBlock}</div></div>
          </div>
        </A_Card>

        {/* PM forecast */}
        <A_Card padded={false}>
          <div style={{ padding: "13px 18px 10px", borderBottom: `1px solid ${A.dividerSoft}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon.CloudRain size={15} stroke={A.sky} />
              <h3 className="serif" style={{ margin: 0, fontSize: 16, color: A.forestDeep }}>Powdery-mildew risk</h3>
              <A_Pill tone="forest">{p.pmRisk.currentRisk}</A_Pill>
            </div>
            <div style={{ fontSize: 12, color: A.inkMuted, marginTop: 4 }}>{p.pmRisk.model} · action {p.pmRisk.threshold}</div>
          </div>
          <div style={{ padding: "14px 18px" }}>
            <div style={{ fontSize: 13, color: A.inkSoft, lineHeight: 1.55 }}>{p.pmRisk.product}</div>
            <div style={{ marginTop: 10, height: 6, background: A.cream, borderRadius: 99, overflow: "hidden", border: `1px solid ${A.divider}` }}>
              <div style={{ height: "100%", width: "32%", background: A.forest }} />
            </div>
            <div style={{ marginTop: 6, ..._rcMono, fontSize: 11, color: A.inkMuted }}>DSV 12 / 20 (action threshold)</div>
          </div>
        </A_Card>
      </div>

      {/* Cure requirement + harvest */}
      <A_Card padded={false}>
        <div style={{ padding: "13px 18px 10px", borderBottom: `1px solid ${A.dividerSoft}` }}>
          <h3 className="serif" style={{ margin: 0, fontSize: 16, color: A.forestDeep }}>Harvest schema · <span style={{ color: A.inkMuted, fontWeight: 400 }}>winter-squash</span></h3>
          <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 2 }}>{p.harvestSchema.mode}. {p.harvestSchema.ph2}</div>
        </div>
        <div style={{ padding: "16px 18px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", gap: 14, alignItems: "end" }}>
          <div>
            <div style={{ ..._rcKic(), marginBottom: 5 }}>Fruit count</div>
            <input placeholder="0" style={{ width: "100%", padding: "10px 12px", background: A.cream, border: `1px solid ${A.divider}`, borderRadius: 6, fontSize: 16, ..._rcMono, outline: "none" }} />
            <div style={{ fontSize: 11, color: A.inkMuted, marginTop: 4 }}>target {p.harvestSchema.target.count} fruit</div>
          </div>
          <div>
            <div style={{ ..._rcKic(), marginBottom: 5 }}>Total lb</div>
            <input placeholder="0" style={{ width: "100%", padding: "10px 12px", background: A.cream, border: `1px solid ${A.divider}`, borderRadius: 6, fontSize: 16, ..._rcMono, outline: "none" }} />
            <div style={{ fontSize: 11, color: A.inkMuted, marginTop: 4 }}>{p.harvestSchema.target.perFruit}</div>
          </div>
          <div>
            <div style={{ ..._rcKic(), marginBottom: 5 }}>Cure start</div>
            <input placeholder="YYYY-MM-DD" style={{ width: "100%", padding: "10px 12px", background: A.cream, border: `1px solid ${A.divider}`, borderRadius: 6, fontSize: 14, ..._rcMono, outline: "none" }} />
            <div style={{ fontSize: 11, color: A.wheat, marginTop: 4, fontWeight: 600 }}>+ 14 d at 80°F</div>
          </div>
          <div>
            <div style={{ ..._rcKic(), marginBottom: 5 }}>Storage start</div>
            <input placeholder="YYYY-MM-DD" style={{ width: "100%", padding: "10px 12px", background: A.cream, border: `1px solid ${A.divider}`, borderRadius: 6, fontSize: 14, ..._rcMono, outline: "none" }} />
            <div style={{ fontSize: 11, color: A.forest, marginTop: 4, fontWeight: 600 }}>50-55°F · 60% RH</div>
          </div>
          <button style={{ ...A_primaryBtn, padding: "10px 16px", fontSize: 14, height: 42 }}>Record</button>
        </div>
      </A_Card>
    </RCShell>
  );
}

/* ═══════════════════ 4 · TOMATO (indeterminate) ═══════════════ */
function ATomatoPlanScreen() {
  const A = window.A_tokens;
  const t = ROW_CROPS.tomato;
  return (
    <RCShell data={t} schemaNote="Continuous-harvest fruit schema · NOT a single harvest event — picks every 7-10 d for 9+ weeks. Disease pressure is the dominant constraint.">
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14, marginBottom: 14 }}>
        {/* Weekly pick schedule */}
        <A_Card padded={false}>
          <div style={{ padding: "13px 18px 10px", borderBottom: `1px solid ${A.dividerSoft}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon.Calendar size={15} stroke={A.forest} />
              <h3 className="serif" style={{ margin: 0, fontSize: 16, color: A.forestDeep }}>Weekly pick schedule</h3>
              <A_Pill tone="forest">9 picks · target {t.harvestSchema.target.lb} lb</A_Pill>
            </div>
            <div style={{ fontSize: 12, color: A.inkMuted, marginTop: 4 }}>Each pick is a separate harvest event — generates a row in <span style={_rcMono}>harvest_events</span> with PHI auto-check against last spray.</div>
          </div>
          <div style={{ padding: "14px 18px", display: "flex", alignItems: "flex-end", gap: 6, height: 130 }}>
            {t.harvestSchedule.map((h, i) => (
              <div key={h.week} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <span style={{ ..._rcMono, fontSize: 10.5, color: A.ink, fontWeight: 600 }}>{h.est}</span>
                <div style={{
                  width: "100%",
                  height: `${(h.est / 36 * 80)}%`,
                  background: A.forest, opacity: 0.85,
                  borderRadius: "3px 3px 0 0"
                }} />
                <span style={{ ..._rcMono, fontSize: 9.5, color: A.inkMuted, transform: "rotate(-25deg)", transformOrigin: "center top", marginTop: 4, whiteSpace: "nowrap" }}>{h.week}</span>
              </div>
            ))}
          </div>
        </A_Card>

        {/* Blight pressure */}
        <A_Card padded={false}>
          <div style={{ padding: "13px 18px 10px", borderBottom: `1px solid ${A.dividerSoft}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon.Alert size={15} stroke={A.rust} />
              <h3 className="serif" style={{ margin: 0, fontSize: 16, color: A.forestDeep }}>Blight pressure</h3>
            </div>
            <div style={{ fontSize: 12, color: A.inkMuted, marginTop: 4 }}>{t.blightPressure.companion}</div>
          </div>
          <div style={{ padding: "12px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
            {t.blightPressure.diseases.map((d) => {
              const riskTone = d.risk === "high" ? "rust" : d.risk === "moderate" ? "wheat" : "forest";
              return (
                <div key={d.name} style={{ paddingBottom: 9, borderBottom: `1px dashed ${A.dividerSoft}` }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                    <span style={{ fontSize: 12.5, color: A.ink, fontWeight: 600 }}>{d.name}</span>
                    <A_Pill tone={riskTone}>{d.risk}</A_Pill>
                  </div>
                  <div style={{ fontSize: 11.5, color: A.inkSoft, marginTop: 3, lineHeight: 1.4 }}>{d.threshold}</div>
                  <div style={{ fontSize: 11, color: A.inkMuted, marginTop: 2, ..._rcMono }}>{d.product}</div>
                </div>
              );
            })}
          </div>
        </A_Card>
      </div>

      {/* Pick recorder */}
      <A_Card padded={false}>
        <div style={{ padding: "13px 18px 10px", borderBottom: `1px solid ${A.dividerSoft}` }}>
          <h3 className="serif" style={{ margin: 0, fontSize: 16, color: A.forestDeep }}>Pick this week · <span style={{ color: A.inkMuted, fontWeight: 400 }}>continuous-harvest-fruit</span></h3>
          <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 2 }}>{t.harvestSchema.mode}. Recorder PHI-checks against the most recent spray on this block.</div>
        </div>
        <div style={{ padding: "16px 18px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", gap: 14, alignItems: "end" }}>
          <div>
            <div style={{ ..._rcKic(), marginBottom: 5 }}>Pick week</div>
            <select defaultValue="Aug 5" style={{ width: "100%", padding: "10px 12px", background: A.cream, border: `1px solid ${A.divider}`, borderRadius: 6, fontSize: 14, fontFamily: "inherit", outline: "none" }}>
              {t.harvestSchedule.map((h) => <option key={h.week}>{h.week}</option>)}
            </select>
          </div>
          <div>
            <div style={{ ..._rcKic(), marginBottom: 5 }}>Lb picked</div>
            <input placeholder="0" style={{ width: "100%", padding: "10px 12px", background: A.cream, border: `1px solid ${A.divider}`, borderRadius: 6, fontSize: 16, ..._rcMono, outline: "none" }} />
          </div>
          <div>
            <div style={{ ..._rcKic(), marginBottom: 5 }}>Grade</div>
            <select defaultValue="#1" style={{ width: "100%", padding: "10px 12px", background: A.cream, border: `1px solid ${A.divider}`, borderRadius: 6, fontSize: 14, fontFamily: "inherit", outline: "none" }}>
              <option>#1 (market)</option><option>#2 (CSA)</option><option>sauce/cull</option>
            </select>
          </div>
          <div>
            <div style={{ ..._rcKic(), marginBottom: 5 }}>Destination</div>
            <select defaultValue="market" style={{ width: "100%", padding: "10px 12px", background: A.cream, border: `1px solid ${A.divider}`, borderRadius: 6, fontSize: 14, fontFamily: "inherit", outline: "none" }}>
              <option>Farmers' market</option><option>CSA</option><option>Restaurant</option><option>Process</option>
            </select>
          </div>
          <button style={{ ...A_primaryBtn, padding: "10px 16px", fontSize: 14, height: 42 }}>Record</button>
        </div>
      </A_Card>
    </RCShell>
  );
}

/* ═══════════════════ 5 · LETTUCE (cut-and-come-again) ═══════════════ */
function ALettucePlanScreen() {
  const A = window.A_tokens;
  const l = ROW_CROPS.lettuce;
  return (
    <RCShell data={l} schemaNote="Cut-and-come-again leafy schema · multiple cuts off the same planting until BOLT (heat-triggered). Succession planted on a family-keyed 14-day interval (Phase 20).">
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 14, marginBottom: 14 }}>
        {/* Succession ladder */}
        <A_Card padded={false}>
          <div style={{ padding: "13px 18px 10px", borderBottom: `1px solid ${A.dividerSoft}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon.Layers size={15} stroke={A.forest} />
              <h3 className="serif" style={{ margin: 0, fontSize: 16, color: A.forestDeep }}>Succession ladder</h3>
              <A_Pill tone="forest">{l.succession.cadence}</A_Pill>
            </div>
            <div style={{ fontSize: 12, color: A.inkMuted, marginTop: 4 }}>Phase 20 succession engine — leafy-green family auto-spaces sowings every 14 d.</div>
          </div>
          <div style={{ padding: "10px 18px 16px" }}>
            {l.succession.blocks.map((b) => {
              const tone = b.status === "today" ? A.wheat : b.status === "fall sown" ? A.inkMuted : A.forest;
              return (
                <div key={b.id} style={{ display: "grid", gridTemplateColumns: "40px 1fr auto auto", gap: 14, padding: "9px 0", borderBottom: `1px dashed ${A.dividerSoft}`, alignItems: "center" }}>
                  <span style={{ ..._rcMono, fontSize: 12, color: A.forestDeep, fontWeight: 700 }}>{b.id}</span>
                  <span style={{ fontSize: 12.5, color: A.ink, ..._rcMono }}>{b.sown}</span>
                  <span style={{ fontSize: 11, color: tone, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{b.status}</span>
                  <span style={{ ..._rcMono, fontSize: 11.5, color: A.inkSoft }}>{b.cuts} cut{b.cuts === 1 ? "" : "s"}</span>
                </div>
              );
            })}
          </div>
        </A_Card>

        {/* Bolt-trigger card */}
        <A_Card padded={false} style={{ borderColor: "#E2B69E", borderWidth: 1.5 }}>
          <div style={{ padding: "13px 18px 10px", borderBottom: `1px solid #E2B69E`, background: "#FBF1E5" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon.Thermometer size={15} stroke={A.rust} />
              <h3 className="serif" style={{ margin: 0, fontSize: 16, color: "#8A341B" }}>Bolt risk · alert</h3>
              <A_Pill tone="rust">Heat coming</A_Pill>
            </div>
            <div style={{ fontSize: 11.5, color: "#8A341B", marginTop: 4 }}>{l.boltTrigger.heatModel}</div>
          </div>
          <div style={{ padding: "14px 18px" }}>
            <div style={{ fontSize: 13, color: A.ink, lineHeight: 1.5 }}>{l.boltTrigger.forecast}</div>
            <div style={{ marginTop: 12, padding: "10px 12px", background: "#EFF6E9", border: `1px solid #C9DBC0`, borderRadius: 6, fontSize: 12, color: A.forestDeep, lineHeight: 1.5 }}>
              <strong>Recommended:</strong> {l.boltTrigger.action}
            </div>
          </div>
        </A_Card>
      </div>

      {/* Per-cut harvest */}
      <A_Card padded={false}>
        <div style={{ padding: "13px 18px 10px", borderBottom: `1px solid ${A.dividerSoft}` }}>
          <h3 className="serif" style={{ margin: 0, fontSize: 16, color: A.forestDeep }}>Per-cut harvest · <span style={{ color: A.inkMuted, fontWeight: 400 }}>cut-and-come-again</span></h3>
          <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 2 }}>{l.harvestSchema.mode}. Each cut is logged separately; declining-yield curve is expected.</div>
        </div>
        <div style={{ padding: "16px 18px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", gap: 14, alignItems: "end" }}>
          <div>
            <div style={{ ..._rcKic(), marginBottom: 5 }}>Cut #</div>
            <select defaultValue="2" style={{ width: "100%", padding: "10px 12px", background: A.cream, border: `1px solid ${A.divider}`, borderRadius: 6, fontSize: 14, fontFamily: "inherit", outline: "none" }}>
              <option value="1">Cut 1 · 85 lb (done)</option>
              <option value="2">Cut 2 · target 75 lb</option>
              <option value="3">Cut 3 · target 60 lb</option>
            </select>
          </div>
          <div>
            <div style={{ ..._rcKic(), marginBottom: 5 }}>Lb harvested</div>
            <input placeholder="75" style={{ width: "100%", padding: "10px 12px", background: A.cream, border: `1px solid ${A.divider}`, borderRadius: 6, fontSize: 16, ..._rcMono, outline: "none" }} />
            <div style={{ fontSize: 11, color: A.inkMuted, marginTop: 4 }}>fresh weight</div>
          </div>
          <div>
            <div style={{ ..._rcKic(), marginBottom: 5 }}>Regrow days est.</div>
            <input placeholder="14" style={{ width: "100%", padding: "10px 12px", background: A.cream, border: `1px solid ${A.divider}`, borderRadius: 6, fontSize: 16, ..._rcMono, outline: "none" }} />
            <div style={{ fontSize: 11, color: A.wheat, marginTop: 4, fontWeight: 600 }}>shorter if hot</div>
          </div>
          <div>
            <div style={{ ..._rcKic(), marginBottom: 5 }}>Quality grade</div>
            <select defaultValue="A" style={{ width: "100%", padding: "10px 12px", background: A.cream, border: `1px solid ${A.divider}`, borderRadius: 6, fontSize: 14, fontFamily: "inherit", outline: "none" }}>
              <option>A · market</option><option>B · CSA</option><option>C · animal feed</option>
            </select>
          </div>
          <button style={{ ...A_primaryBtn, padding: "10px 16px", fontSize: 14, height: 42 }}>Record</button>
        </div>
      </A_Card>
    </RCShell>
  );
}

/* ═══════════════════ 6 · COVER CROP (termination) ═══════════════ */
function ACoverCropPlanScreen() {
  const A = window.A_tokens;
  const c = ROW_CROPS.cover;
  return (
    <RCShell data={c} schemaNote="Cover-crop schema · NOT a harvested crop — the decision payload is termination method, not yield. Biomass + C:N + N-credit shape next-crop nutrition.">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        {/* Biomass card */}
        <A_Card padded={false}>
          <div style={{ padding: "13px 18px 10px", borderBottom: `1px solid ${A.dividerSoft}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon.Leaf size={15} stroke={A.forest} />
              <h3 className="serif" style={{ margin: 0, fontSize: 16, color: A.forestDeep }}>Biomass · {c.biomass.lastSampled}</h3>
              <A_Pill tone="forest">Above target</A_Pill>
            </div>
            <div style={{ fontSize: 12, color: A.inkMuted, marginTop: 4 }}>Rye {c.biomass.ratio.ryePct}% / vetch {c.biomass.ratio.vetchPct}% by dry weight. C:N {c.biomass.cnRatio} — borderline N tie-up if &gt; 30.</div>
          </div>
          <div style={{ padding: "14px 18px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <div style={_rcKic()}>Dry matter</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 4 }}>
                <span className="serif" style={{ fontSize: 26, color: A.forestDeep, fontWeight: 600, letterSpacing: "-0.02em" }}>{c.biomass.yieldsDryMatter.toLocaleString()}</span>
                <span style={{ fontSize: 12, color: A.inkSoft }}>lb DM/ac</span>
              </div>
              <div style={{ ..._rcMono, fontSize: 11, color: A.inkMuted, marginTop: 2 }}>target {c.biomass.target.toLocaleString()}</div>
            </div>
            <div>
              <div style={_rcKic()}>N credit (vetch)</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 4 }}>
                <span className="serif" style={{ fontSize: 26, color: A.forestDeep, fontWeight: 600, letterSpacing: "-0.02em" }}>{c.biomass.nCredit}</span>
                <span style={{ fontSize: 12, color: A.inkSoft }}>lb N/ac</span>
              </div>
              <div style={{ ..._rcMono, fontSize: 11, color: A.forest, marginTop: 2 }}>≈ 1 side-dress saved</div>
            </div>
          </div>
        </A_Card>

        {/* Next crop */}
        <A_Card padded={false}>
          <div style={{ padding: "13px 18px 10px", borderBottom: `1px solid ${A.dividerSoft}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon.ArrowRight size={15} stroke={A.sky} />
              <h3 className="serif" style={{ margin: 0, fontSize: 16, color: A.forestDeep }}>Next crop in this block</h3>
            </div>
            <div style={{ fontSize: 12, color: A.inkMuted, marginTop: 4 }}>{c.nextCrop.crop}</div>
          </div>
          <div style={{ padding: "14px 18px" }}>
            <div style={{ fontSize: 13, color: A.ink, lineHeight: 1.55 }}>{c.nextCrop.gap}</div>
          </div>
        </A_Card>
      </div>

      {/* Termination decision — 4 options with kernel gates */}
      <A_Card padded={false}>
        <div style={{ padding: "13px 18px 10px", borderBottom: `1px solid ${A.dividerSoft}` }}>
          <h3 className="serif" style={{ margin: 0, fontSize: 16, color: A.forestDeep }}>Termination decision · <span style={{ color: A.inkMuted, fontWeight: 400 }}>cover-crop-termination</span></h3>
          <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 2 }}>Schema renders 4 options; safety kernel + season-setup philosophy gate which are available.</div>
        </div>
        <div style={{ padding: "12px 18px 14px", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {c.terminationOptions.map((o) => {
            const blocked = o.gate === "blocked";
            const wait = o.gate === "wait";
            const recommend = o.recommend;
            const border = recommend ? `1.5px solid ${A.forest}` : blocked ? `1px solid #E2B69E` : `1px solid ${A.divider}`;
            const bg = recommend ? "#EFF6E9" : blocked ? "#FBF1E5" : wait ? "#FBF5E6" : A.paper;
            return (
              <div key={o.id} style={{
                padding: "12px 14px", background: bg, border, borderRadius: 8,
                display: "flex", flexDirection: "column", gap: 6
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                  <span style={{ fontSize: 13.5, color: A.ink, fontWeight: 700 }}>{o.label}</span>
                  {recommend && <span style={{ fontSize: 9.5, color: A.forest, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>★ Recommend</span>}
                  {blocked && <Icon.Lock size={12} stroke={A.rust} />}
                  {wait && <span style={{ fontSize: 9.5, color: A.wheat, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>wait</span>}
                </div>
                <div style={{ fontSize: 11.5, color: A.inkSoft, lineHeight: 1.5 }}>{o.note}</div>
                <button style={{
                  marginTop: "auto",
                  background: recommend ? A.forest : "transparent",
                  color: recommend ? A.cream : (blocked ? A.rust : A.inkSoft),
                  border: recommend ? "none" : `1px solid ${A.divider}`,
                  padding: "5px 10px", borderRadius: 6,
                  fontSize: 12, fontWeight: 600, cursor: blocked ? "not-allowed" : "pointer",
                  opacity: blocked ? 0.6 : 1, fontFamily: "inherit"
                }}>{blocked ? "Blocked by philosophy" : (wait ? "Re-check in 5-7 d" : "Choose")}</button>
              </div>
            );
          })}
        </div>
      </A_Card>
    </RCShell>
  );
}

window.A_CornPlanScreen      = ACornPlanScreen;
window.A_BeanPlanScreen      = ABeanPlanScreen;
window.A_PumpkinPlanScreen   = APumpkinPlanScreen;
window.A_TomatoPlanScreen    = ATomatoPlanScreen;
window.A_LettucePlanScreen   = ALettucePlanScreen;
window.A_CoverCropPlanScreen = ACoverCropPlanScreen;
