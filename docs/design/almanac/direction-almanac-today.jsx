/* Direction A — "Almanac"
   Editorial, premium agricultural. Serif display (Source Serif 4),
   IBM Plex Sans body, IBM Plex Mono for data. Warm cream paper,
   deep forest green, wheat-gold accent. Reads like a refined farm
   almanac more than a SaaS tool. */

const A = {
  // Tokens
  cream: "#F8F3E8",
  paper: "#FDFAF2",
  ink: "#1A1F1A",
  inkSoft: "#4A4F46",
  inkMuted: "#7A7F75",
  forest: "#2C5237",
  forestDeep: "#1F3A28",
  wheat: "#B8893C",
  wheatSoft: "#E8D9B5",
  rust: "#A64A2A",
  sky: "#6F8FA8",
  divider: "#D9CFB7",
  dividerSoft: "#E9DFCC",
  cardBorder: "#D9CFB7"
};

const almanacBase = `
.dir-a, .dir-a * { font-family: "IBM Plex Sans", system-ui, sans-serif; box-sizing: border-box; }
.dir-a { background: ${A.cream}; color: ${A.ink}; width: 100%; height: 100%; min-height: 820px; }
.dir-a .serif { font-family: "Source Serif 4", "Source Serif Pro", Georgia, serif; font-weight: 500; letter-spacing: -0.01em; }
.dir-a .mono { font-family: "IBM Plex Mono", ui-monospace, monospace; }
.dir-a button { font: inherit; cursor: pointer; }
.dir-a a { color: inherit; text-decoration: none; }
`;

/* ── Shared chrome ────────────────────────────────────────────── */
function ATopBar({ active }) {
  const items = [
  { id: "today", label: "Today", icon: "Sun" },
  { id: "plan", label: "Plan", icon: "Sprout" },
  { id: "spray", label: "Spray", icon: "Spray" },
  { id: "scout", label: "Scout", icon: "Eye" },
  { id: "harvest", label: "Harvest", icon: "Harvest" },
  { id: "stock", label: "Stock", icon: "Box" },
  { id: "records", label: "Records", icon: "FileText" }];

  return (
    <div style={{ background: A.paper, borderBottom: `1px solid ${A.divider}` }}>
      <div style={{ display: "flex", alignItems: "center", padding: "14px 28px", gap: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: A.forest, display: "grid", placeItems: "center", color: A.cream }}>
            <Icon.Leaf size={16} />
          </div>
          <div className="serif" style={{ fontSize: 20, color: A.forestDeep, letterSpacing: "-0.015em" }}>CropCard</div>
          <div style={{ width: 1, height: 18, background: A.divider, margin: "0 6px" }} />
          <div style={{ fontSize: 12, color: A.inkMuted, fontFeatureSettings: "'tnum'" }}>{MOCK.farm}</div>
        </div>
        <nav style={{ display: "flex", gap: 2, marginLeft: 18 }}>
          {items.map((it) => {
            const isActive = active === it.id;
            const Glyph = Icon[it.icon];
            return (
              <a key={it.id} title={it.label} style={{
                display: "flex", alignItems: "center", gap: 7, padding: "8px 12px",
                borderRadius: 6, color: isActive ? A.forestDeep : A.inkSoft,
                background: isActive ? "transparent" : "transparent",
                fontWeight: isActive ? 600 : 500, fontSize: 13.5,
                borderBottom: isActive ? `2px solid ${A.forest}` : "2px solid transparent",
                marginBottom: -1
              }}>
                <Glyph size={15} />
                <span>{it.label}</span>
              </a>);

          })}
        </nav>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <button title="Search" style={iconBtnA}><Icon.Search size={16} /></button>
          <button title="Alerts — 2 active" style={{ ...iconBtnA, position: "relative" }}>
            <Icon.Bell size={16} />
            <span style={{ position: "absolute", top: 4, right: 4, width: 6, height: 6, borderRadius: 99, background: A.rust }} />
          </button>
          <button title="Settings" style={iconBtnA}><Icon.Settings size={16} /></button>
          <div style={{ width: 32, height: 32, borderRadius: 99, background: A.wheat, color: A.cream, display: "grid", placeItems: "center", fontWeight: 600, fontSize: 13 }}>{MOCK.user.initial}</div>
        </div>
      </div>
    </div>);

}

const iconBtnA = {
  width: 32, height: 32, borderRadius: 6, border: `1px solid ${A.divider}`,
  background: A.paper, color: A.inkSoft, display: "grid", placeItems: "center"
};

function APill({ children, tone = "neutral", style = {} }) {
  const tones = {
    neutral: { bg: A.dividerSoft, fg: A.inkSoft, bd: A.divider },
    forest: { bg: "#E5EEDF", fg: A.forestDeep, bd: "#C9DBC0" },
    wheat: { bg: A.wheatSoft, fg: "#8A6722", bd: "#D9C18F" },
    rust: { bg: "#F1D9CE", fg: "#8A341B", bd: "#E2B69E" },
    sky: { bg: "#DEE7EF", fg: "#3A586E", bd: "#BDCDD9" }
  };
  const t = tones[tone];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px",
      borderRadius: 99, background: t.bg, color: t.fg, border: `1px solid ${t.bd}`,
      fontSize: 11, fontWeight: 600, letterSpacing: "0.02em", textTransform: "uppercase",
      ...style
    }}>{children}</span>);

}

function ACard({ children, style = {}, padded = true }) {
  return (
    <div style={{
      background: A.paper, border: `1px solid ${A.cardBorder}`, borderRadius: 10,
      padding: padded ? 22 : 0, ...style
    }}>{children}</div>);

}

function AKicker({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 600, color: A.inkMuted, letterSpacing: "0.12em", textTransform: "uppercase" }}>{children}</div>;
}

/* ── Today ────────────────────────────────────────────────────── */

/* Render the scope strip for the hero "do this now" card. Supports:
   - 1 block, 1 planting       → "Block A · 0.8 ac" + 1 chip
   - 1 block, N plantings      → "Block A · 0.8 ac" + N chips + polyculture badge
   - 1 block, subset of N      → adds "Three Sisters · scouting Corn only"
   - M blocks (any plantings)  → "2 blocks · 2.0 ac" + chips grouped per block
*/
function AScopeStrip({ action }) {
  const blocks = action.scopes.map((s) => {
    const b = MOCK.blocks.find((x) => x.id === s.blockId);
    const plantings = (b.plantings || []).filter((p) => s.plantingIds.includes(p.id));
    const allInBlock = (b.plantings || []).length;
    return { b, plantings, allInBlock, isSubsetOfPoly: allInBlock > 1 && plantings.length < allInBlock };
  });
  const totalAcres = blocks.reduce((sum, x) => sum + x.b.acres, 0);
  const totalPlantings = blocks.reduce((sum, x) => sum + x.plantings.length, 0);
  const blockLabel = blocks.length === 1
    ? `${blocks[0].b.label} · ${blocks[0].b.acres} ac`
    : `${blocks.length} blocks · ${totalAcres.toFixed(1)} ac`;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", padding: "16px 26px 14px", gap: 18, background: "#F4ECD8" }}>
      {/* Scope (blocks) */}
      <div>
        <div style={scopeLabelA}>{blocks.length === 1 ? "Block" : "Blocks"}</div>
        <div className="mono" style={scopeValueA}>{blockLabel}</div>
      </div>
      {/* Targets (plantings) */}
      <div style={{ gridColumn: "span 2" }}>
        <div style={scopeLabelA}>{totalPlantings === 1 ? "Target" : "Targets"} · {totalPlantings}</div>
        <div style={{ marginTop: 5, display: "flex", flexWrap: "wrap", gap: 5 }}>
          {blocks.map((g) => g.plantings.map((p) => (
            <span key={p.id} title={`${p.crop} — ${p.variety}${g.b.plantings.length > 1 ? ` (in ${g.b.label} polyculture)` : ""}`} style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "2px 7px", background: A.paper, border: `1px solid ${A.divider}`,
              borderRadius: 99, fontSize: 11.5, color: A.ink, fontWeight: 500,
            }}>
              <span style={{ width: 7, height: 7, borderRadius: 2, background: p.color }} />
              {p.crop.split(" ").slice(0, 3).join(" ")}
              {blocks.length > 1 && (
                <span style={{ color: A.inkMuted, fontSize: 10, fontFamily: "IBM Plex Mono" }}>· {g.b.label.replace("Block ", "")}</span>
              )}
            </span>
          )))}
        </div>
        {/* Polyculture subset hint */}
        {blocks.some((g) => g.isSubsetOfPoly) && (
          <div style={{ marginTop: 6, fontSize: 11, color: "#8A6722", display: "flex", alignItems: "center", gap: 4 }}>
            <Icon.Layers size={11} />
            {blocks.filter((g) => g.isSubsetOfPoly).map((g) =>
              `${g.b.label} is a polyculture (${g.allInBlock} plantings) — scouting ${g.plantings.length}.`
            ).join(" ")}
          </div>
        )}
      </div>
      {/* Stage */}
      <div>
        <div style={scopeLabelA}>Stage</div>
        <div className="mono" style={scopeValueA}>{action.stageSummary}</div>
      </div>
    </div>
  );
}

const scopeLabelA = { fontSize: 10.5, color: "#7A7F75", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600 };
const scopeValueA = { fontSize: 13.5, color: "#1A1F1A", marginTop: 3 };

function ATodayScreen({ action, aiEnabled }) {
  const m = MOCK;
  const todayAction = action || m.todayAction;
  const aiOn = aiEnabled !== undefined ? aiEnabled : (m.aiEnabled !== false);
  const Provenance = window.A_Provenance;
  const ProvLegend = window.A_ProvenanceLegend;
  return (
    <div className="dir-a" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ATopBar active="today" />

      {/* Decon banner — calmer than current red bar, but still salient */}
      <div style={{ background: "#F1D9CE", borderBottom: `1px solid #E2B69E`, padding: "10px 28px", display: "flex", alignItems: "center", gap: 12, color: "#6E2A13", fontSize: 13.5 }}>
        <Icon.Alert size={16} />
        <span><strong>Backpack Sprayer 1</strong> needs decontamination before next use — last load: 2,4-D.</span>
        <a style={{ marginLeft: "auto", color: "#6E2A13", fontWeight: 600, textDecoration: "underline" }}>Run decon wizard →</a>
      </div>

      <div style={{ flex: 1, padding: "28px 28px 32px", overflow: "auto" }}>
        <div style={{ maxWidth: 1180, margin: "0 auto" }}>

          {/* Header — greeting + weather strip */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 22 }}>
            <div>
              <AKicker>{m.date.display}</AKicker>
              <h1 className="serif" style={{ margin: "6px 0 0", fontSize: 38, lineHeight: 1.05, color: A.forestDeep, letterSpacing: "-0.02em" }}>
                Good morning, Sherry.
              </h1>
              <div style={{ marginTop: 6, color: A.inkSoft, fontSize: 14.5 }}>
                One thing to do today. <span style={{ color: A.inkMuted }}>·</span> 5 items this week.
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 22, color: A.inkSoft, fontSize: 13.5 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><Icon.Sun size={16} /><span className="mono" style={{ fontWeight: "500" }}>68°F</span></div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><Icon.Wind size={16} /><span className="mono" style={{ fontWeight: "500" }}>6 mph SW</span></div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><Icon.CloudRain size={16} /><span className="mono" style={{ fontWeight: "500" }}>0.4 in tue→wed</span></div>
            </div>
          </div>

          {/* Grid: hero (2/3) + side stack */}
          <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 18 }}>

            {/* Hero "do this now" card */}
            <ACard style={{ position: "relative", overflow: "hidden", padding: 0 }}>
              <div style={{ padding: "24px 26px 22px", borderBottom: `1px solid ${A.dividerSoft}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                  <APill tone="wheat">Today · do this first</APill>
                  <APill tone="forest">Scout</APill>
                  <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                    {Provenance && <Provenance source="data" detail="your trap log" compact />}
                    {Provenance && <Provenance source="plugin" detail="corn-bb earworm rule" compact />}
                  </div>
                </div>
                <h2 className="serif" style={{ margin: 0, fontSize: 26, color: A.ink, letterSpacing: "-0.015em" }}>
                  Scout Block A for corn earworm.
                </h2>
                <p style={{ margin: "10px 0 0", color: A.inkSoft, fontSize: 14.5, lineHeight: 1.55, maxWidth: 620 }}>
                  Trap caught <strong>8 moths</strong> since Sunday — threshold is 6. Check 12 plants for tip damage in the
                  Bloody Butcher corn before Thursday's spray window opens.
                </p>
                <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center" }}>
                  <button style={primaryBtnA}>Start scouting <Icon.ArrowRight size={15} /></button>
                  <button style={ghostBtnA}>Skip — note why</button>
                  {aiOn && (
                    <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: A.inkMuted }}>
                      <Icon.Sparkle size={12} stroke={A.wheat} />
                      <span>Ask Claude · "Why 12 plants? What's tip damage look like?"</span>
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", padding: "14px 26px", gap: 18, background: "#F4ECD8" }}>
                {[
                ["Block", "A · 0.8 ac"],
                ["Crop", "Bloody Butcher Corn"],
                ["Stage", "V8 · pre-tassel"],
                ["Window closes", "Thu 10pm"]].
                map(([k, v]) =>
                <div key={k}>
                    <div style={{ fontSize: 10.5, color: A.inkMuted, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600 }}>{k}</div>
                    <div className="mono" style={{ fontSize: 13.5, color: A.ink, marginTop: 3 }}>{v}</div>
                  </div>
                )}
              </div>
            </ACard>

            {/* Quick actions */}
            <ACard padded={false}>
              <div style={{ padding: "20px 22px 12px" }}>
                <AKicker>Quick actions</AKicker>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 1, background: A.dividerSoft }}>
                {[
                ["Spray", "Spray"],
                ["Record harvest", "Harvest"],
                ["Log scout note", "Eye"]].
                map(([label, ico]) => {
                  const G = Icon[ico];
                  return (
                    <button key={label} style={{
                      background: A.paper, border: "none", padding: "16px 18px",
                      display: "flex", alignItems: "center", gap: 12,
                      color: A.forestDeep, fontSize: 14, fontWeight: 500, textAlign: "left"
                    }}>
                      <div style={{ width: 32, height: 32, borderRadius: 6, background: "#E5EEDF", display: "grid", placeItems: "center", color: A.forest }}>
                        <G size={16} />
                      </div>
                      {label}
                      <Icon.ChevronRight size={14} style={{ marginLeft: "auto", color: A.inkMuted }} />
                    </button>);

                })}
              </div>
            </ACard>
          </div>

          {/* Week strip + side panels */}
          <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 18, marginTop: 18 }}>

            <ACard>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <h3 className="serif" style={{ margin: 0, fontSize: 18, color: A.forestDeep, letterSpacing: "-0.01em" }}>This week</h3>
                <div style={{ display: "flex", gap: 4 }}>
                  {["Week", "Month", "Season"].map((l, i) =>
                  <button key={l} style={{
                    padding: "5px 12px", borderRadius: 99, border: `1px solid ${i === 0 ? A.forest : A.divider}`,
                    background: i === 0 ? A.forest : "transparent", color: i === 0 ? A.cream : A.inkSoft,
                    fontSize: 12, fontWeight: 500
                  }}>{l}</button>
                  )}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
                {["Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Mon"].map((d, i) => {
                  const day = 26 + i;
                  const items = i === 0 ? [{ t: "Scout earworm", k: "scout" }] : m.upcoming.filter((_, j) => j === i - 1);
                  const isToday = i === 0;
                  return (
                    <div key={d} style={{
                      background: isToday ? "#E5EEDF" : A.cream, border: `1px solid ${isToday ? "#C9DBC0" : A.dividerSoft}`,
                      borderRadius: 8, padding: 10, minHeight: 130, display: "flex", flexDirection: "column", gap: 8
                    }}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 11, color: A.inkMuted, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>{d}</span>
                        <span className="serif" style={{ fontSize: 18, color: isToday ? A.forestDeep : A.inkSoft }}>{day}</span>
                      </div>
                      {items.map((it, k) =>
                      <div key={k} style={{
                        padding: "6px 8px", background: A.paper, borderLeft: `3px solid ${kindColorA(it.k || it.kind)}`,
                        borderRadius: "0 4px 4px 0", fontSize: 11.5, color: A.ink, lineHeight: 1.3
                      }}>{it.t || it.title}</div>
                      )}
                    </div>);

                })}
              </div>
            </ACard>

            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <ACard>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <span title={aiOn ? "When AI is on, the top section ranks these by your fertility + scout history. Without a key, you see the same items in plugin-default order." : "AI key not set — listed in plugin-default order. Add a key in Settings → AI to get personalised ranking."}>
                    <AKicker>
                      {aiOn ? "Recommended · ranked by Claude" : "Recommended · plugin defaults"}
                    </AKicker>
                  </span>
                  <a style={{ fontSize: 12, color: A.forest, fontWeight: 600 }}>See all 3 →</a>
                </div>
                {Provenance && (
                  <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                    <Provenance source={aiOn ? "ai" : "fallback"} confidence={aiOn ? 0.86 : undefined} detail={aiOn ? undefined : "AI off — using plugin order"} />
                    <Provenance source="plugin" detail="crop guides + companion library" compact />
                  </div>
                )}
                {m.suggestions.slice(0, 2).map((s) =>
                <div key={s.id} style={{ padding: "10px 0", borderTop: `1px dashed ${A.dividerSoft}` }}>
                    <div style={{ fontSize: 13.5, color: A.ink, fontWeight: 500 }}>{s.title}</div>
                    <div style={{ fontSize: 12, color: A.inkMuted, marginTop: 2 }}>{s.crop} · <span className="mono">{s.window}</span></div>
                    <button style={{ marginTop: 6, background: "transparent", color: A.forest, border: "none", padding: 0, fontSize: 12.5, fontWeight: 600 }}>+ Schedule task</button>
                  </div>
                )}
              </ACard>
              <ACard>
                <AKicker>Season at a glance</AKicker>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 12 }}>
                  {[
                  ["6", "active plantings"], ["14", "sprays YTD"],
                  ["1", "day to harvest"], ["308", "plugins loaded"]].
                  map(([n, l]) =>
                  <div key={l}>
                      <div className="serif" style={{ fontSize: 28, color: A.forestDeep, letterSpacing: "-0.02em", lineHeight: 1 }}>{n}</div>
                      <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 4 }}>{l}</div>
                    </div>
                  )}
                </div>
              </ACard>
            </div>
          </div>

        </div>
      </div>
    </div>);

}

const primaryBtnA = {
  display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 18px",
  borderRadius: 6, background: A.forest, color: A.cream, border: "none",
  fontSize: 14, fontWeight: 600, letterSpacing: "0.01em"
};
const ghostBtnA = {
  display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 16px",
  borderRadius: 6, background: "transparent", color: A.forestDeep, border: `1px solid ${A.divider}`,
  fontSize: 14, fontWeight: 500
};

function kindColorA(k) {
  return {
    scout: A.sky, spray: A.rust, fertility: A.wheat,
    planting: A.forest, harvest: "#8A6722", task: A.inkMuted
  }[k] || A.divider;
}

window.A_TodayScreen = ATodayScreen;
window.A_tokens = A;
window.A_baseCss = almanacBase;
window.A_TopBar = ATopBar;
window.A_Card = ACard;
window.A_Pill = APill;
window.A_Kicker = AKicker;
window.A_primaryBtn = primaryBtnA;
window.A_ghostBtn = ghostBtnA;
window.A_iconBtn = iconBtnA;
window.A_kindColor = kindColorA;