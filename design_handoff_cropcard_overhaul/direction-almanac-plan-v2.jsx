/* Direction A — Almanac · PLAN v2
   Handles blocks with multiple plantings (Three Sisters, companion borders,
   undersown clover, cover-crop mixes). Map moved off the page and reachable
   via "View on map" overlay so Plan can stay focused on planting + tasks.
*/

function APlanV2Screen({ initialBlockId = "a", initialPlantingIdx = 0, mapOpen = false }) {
  const m = MOCK;
  const A = window.A_tokens;
  const [selected, setSelected] = React.useState(initialBlockId);
  const [pIdx, setPIdx] = React.useState(initialPlantingIdx);
  const [showMap, setShowMap] = React.useState(mapOpen);

  const block = m.blocks.find((b) => b.id === selected);
  const plantings = block.plantings || [];
  const planting = plantings[Math.min(pIdx, plantings.length - 1)] || plantings[0];
  const isPoly = plantings.length > 1;

  // Reset planting index when block changes
  React.useEffect(() => { setPIdx(0); }, [selected]);

  return (
    <div className="dir-a" style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      <A_TopBar active="plan" />

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "280px 1fr", overflow: "hidden" }}>

        {/* ── Left rail: block list (now shows planting counts) ── */}
        <div style={{ borderRight: `1px solid ${A.divider}`, background: A.paper, overflow: "auto" }}>
          <div style={{ padding: "20px 18px 14px", borderBottom: `1px solid ${A.dividerSoft}` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <A_Kicker>Blocks · {m.blocks.length}</A_Kicker>
              <button title="New block" style={{ ...A_iconBtn, width: 28, height: 28 }}><Icon.Plus size={14} /></button>
            </div>
            <div style={{ marginTop: 10, position: "relative" }}>
              <Icon.Search size={13} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: A.inkMuted }} />
              <input placeholder="Filter blocks…" style={{
                width: "100%", padding: "7px 10px 7px 30px", fontSize: 13,
                background: A.cream, border: `1px solid ${A.divider}`, borderRadius: 6, color: A.ink,
                outline: "none", fontFamily: "inherit",
              }} />
            </div>
          </div>
          {m.blocks.map((b) => {
            const sel = b.id === selected;
            const count = (b.plantings || []).length;
            const poly = count > 1;
            return (
              <button key={b.id} onClick={() => setSelected(b.id)} style={{
                width: "100%", textAlign: "left", padding: "12px 16px",
                display: "flex", alignItems: "flex-start", gap: 10,
                background: sel ? "#EFE6CC" : "transparent",
                border: "none", borderLeft: sel ? `3px solid ${A.forest}` : "3px solid transparent",
                borderBottom: `1px solid ${A.dividerSoft}`,
              }}>
                {/* Color stack — multi-bar if polyculture */}
                <div style={{ width: 10, display: "flex", flexDirection: "column", gap: 2 }}>
                  {(b.plantings || [{ color: b.color }]).slice(0, 3).map((p, i) => (
                    <div key={i} style={{ width: 10, height: poly ? 9 : 28, borderRadius: 2, background: p.color }} />
                  ))}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span className="serif" style={{ fontSize: 15, color: A.ink }}>{b.label}</span>
                    <span className="mono" style={{ fontSize: 11, color: A.inkMuted }}>{b.acres} ac</span>
                  </div>
                  <div style={{ fontSize: 12, color: A.inkSoft, marginTop: 1, lineHeight: 1.35 }}>
                    {b.crop}
                  </div>
                  {poly && (
                    <div style={{ fontSize: 10.5, color: A.forest, marginTop: 4, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                      <Icon.Layers size={10} /> {count} plantings
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* ── Main detail area ── */}
        <div style={{ overflow: "auto", padding: "22px 28px 32px", background: A.cream }}>

          {/* Workflow strip — connects Plan v2 back to the planning wizard */}
          <APlanWorkflowStrip block={block} />

          {/* Block header */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 18, gap: 16 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <A_Kicker>Block · {block.acres} ac · {isPoly ? `${plantings.length} plantings` : "single planting"}</A_Kicker>
              <h1 className="serif" style={{ margin: "6px 0 0", fontSize: 30, color: A.forestDeep, letterSpacing: "-0.02em", lineHeight: 1.1 }}>
                {block.label} <span style={{ color: A.inkMuted, fontWeight: 400 }}>—</span> {block.crop}
              </h1>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                {isPoly && <A_Pill tone="forest"><Icon.Layers size={10} /> Polyculture</A_Pill>}
                <A_Pill tone="neutral">{block.acres} ac</A_Pill>
                <A_Pill tone="wheat">Harvest window {block.harvest}</A_Pill>
                <A_Pill tone={block.status === "terminating" ? "rust" : block.status === "planned" ? "sky" : "forest"}>{block.status}</A_Pill>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <button onClick={() => setShowMap(true)} style={A_ghostBtn} title="View this block on the field map">
                <Icon.Map size={14} /> View on map
              </button>
              <button style={A_ghostBtn} title="Open the season-plan chat with this block in context">
                <Icon.Sprout size={14} /> Refine with AI
              </button>
              <button style={A_ghostBtn}><Icon.Wrench size={14} /> Edit block</button>
              <button style={A_primaryBtn}><Icon.Plus size={14} /> Add planting</button>
            </div>
          </div>

          {/* ── Plantings tab strip (only when poly) ── */}
          {isPoly && (
            <div style={{ display: "flex", gap: 8, marginBottom: 14, borderBottom: `1px solid ${A.divider}`, paddingBottom: 0 }}>
              <button onClick={() => setPIdx(-1)} style={tabBtnA(pIdx === -1, A)}>
                All plantings <span style={{ ...countPillA(A), background: pIdx === -1 ? A.forest : A.dividerSoft, color: pIdx === -1 ? A.cream : A.inkSoft }}>{plantings.length}</span>
              </button>
              {plantings.map((p, i) => (
                <button key={p.id} onClick={() => setPIdx(i)} style={tabBtnA(pIdx === i, A)}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, display: "inline-block", marginRight: 6 }} />
                  {p.crop.split(" ").slice(0, 3).join(" ")}
                </button>
              ))}
            </div>
          )}

          {/* ── Plantings grid (cards) ── */}
          {pIdx === -1 || !isPoly ? (
            <div style={{ display: "grid", gridTemplateColumns: isPoly ? "repeat(auto-fit, minmax(310px, 1fr))" : "1fr", gap: 14, marginBottom: 18 }}>
              {(isPoly ? plantings : [planting]).map((p) => {
                const companionRefs = (p.companions || []).map((cid) => plantings.find((x) => x.id === cid)).filter(Boolean);
                return (
                  <div key={p.id} style={{
                    background: A.paper, border: `1px solid ${A.cardBorder}`, borderRadius: 10, overflow: "hidden",
                  }}>
                    <div style={{ height: 4, background: p.color }} />
                    <div style={{ padding: "16px 18px 14px" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="serif" style={{ fontSize: 17, color: A.ink, letterSpacing: "-0.01em", lineHeight: 1.2 }}>{p.crop}</div>
                          <div style={{ fontSize: 12, color: A.inkMuted, marginTop: 3, fontStyle: "italic" }}>{p.variety}</div>
                        </div>
                        <A_Pill tone={p.status === "active" ? "forest" : p.status === "planned" ? "sky" : "rust"}>{p.status}</A_Pill>
                      </div>

                      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 14px" }}>
                        {[
                          ["Role", p.role],
                          ["Stage", p.stage],
                          ["Planted", p.planted],
                          ["Harvest", p.harvest],
                          ["Area", p.area],
                        ].map(([k, v]) => (
                          <div key={k} style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 10, color: A.inkMuted, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>{k}</div>
                            <div className="mono" style={{ fontSize: 12, color: A.ink, marginTop: 2, lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis" }} title={v}>{v}</div>
                          </div>
                        ))}
                      </div>

                      {companionRefs.length > 0 && (
                        <div style={{ marginTop: 12, padding: "8px 10px", background: "#EFE6CC", border: `1px dashed #D9C18F`, borderRadius: 6 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#8A6722", fontWeight: 600 }}>
                            <Icon.Layers size={11} /> Companions in this block
                          </div>
                          <div style={{ marginTop: 5, display: "flex", gap: 5, flexWrap: "wrap" }}>
                            {companionRefs.map((c) => (
                              <button key={c.id} onClick={() => setPIdx(plantings.findIndex((x) => x.id === c.id))} style={{
                                display: "inline-flex", alignItems: "center", gap: 5,
                                padding: "2px 8px", background: A.paper, border: `1px solid ${A.divider}`,
                                borderRadius: 99, fontSize: 11, color: A.ink, cursor: "pointer",
                              }}>
                                <span style={{ width: 6, height: 6, borderRadius: 99, background: c.color }} />
                                {c.crop.split(" ").slice(0, 2).join(" ")}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div style={{ marginTop: 10, fontSize: 11.5, color: A.inkMuted, display: "flex", alignItems: "center", gap: 5 }}>
                        <Icon.Info size={12} /> {p.source}
                      </div>

                      {/* Provenance footer — links back to wizard step that produced it */}
                      <APlantingProvenance plantingId={p.id} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* Single-planting deep view */
            <A_Card style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                <div style={{ width: 6, alignSelf: "stretch", borderRadius: 3, background: planting.color }} />
                <div style={{ flex: 1 }}>
                  <div className="serif" style={{ fontSize: 21, color: A.ink, letterSpacing: "-0.01em" }}>{planting.crop}</div>
                  <div style={{ fontSize: 13, color: A.inkMuted, fontStyle: "italic", marginTop: 3 }}>{planting.variety} · {planting.role}</div>
                  <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14 }}>
                    {[
                      ["Stage", planting.stage],
                      ["Planted", planting.planted],
                      ["Harvest", planting.harvest],
                      ["Area", planting.area],
                      ["Status", planting.status],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <div style={{ fontSize: 10.5, color: A.inkMuted, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>{k}</div>
                        <div className="mono" style={{ fontSize: 13, color: A.ink, marginTop: 3 }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </A_Card>
          )}

          {/* ── Combined season timeline — one row per planting ── */}
          <A_Card style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <h3 className="serif" style={{ margin: 0, fontSize: 17, color: A.forestDeep }}>Season · {plantings.length > 1 ? "all plantings overlaid" : "timeline"}</h3>
              <div style={{ fontSize: 11.5, color: A.inkMuted }}>2026 · Apr → Oct</div>
            </div>

            {/* Axis */}
            <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12, marginBottom: 6 }}>
              <div />
              <div style={{ position: "relative", height: 18 }}>
                {["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"].map((mo, i) => (
                  <span key={mo} style={{
                    position: "absolute", left: `${(i / 7) * 100}%`, top: 0,
                    fontSize: 10.5, color: A.inkMuted, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase",
                  }}>{mo}</span>
                ))}
                {/* TODAY label sits at the axis; vertical line is per-row, scoped to the tracks */}
                <span style={{ position: "absolute", left: "21%", top: 0, transform: "translateX(-50%)", background: A.rust, color: A.cream, fontSize: 9.5, fontWeight: 700, padding: "1px 5px", borderRadius: 3, letterSpacing: "0.05em", zIndex: 2 }}>TODAY</span>
              </div>
            </div>

            {/* Rows */}
            {plantings.map((p, i) => {
              // crude window mapping for the demo
              const windows = ({
                a1: [{ s: 8, e: 64, label: "V → R6 grain fill", tone: p.color }, { s: 64, e: 72, label: "harvest", tone: A.wheat }],
                a2: [{ s: 21, e: 60, label: "sow → vine → pod fill", tone: p.color }, { s: 60, e: 68, label: "harvest", tone: A.wheat }],
                a3: [{ s: 28, e: 72, label: "sow → vine → fruit", tone: p.color }, { s: 72, e: 80, label: "harvest", tone: A.wheat }],
                b1: [{ s: 22, e: 55, label: "transplant → fruit set", tone: p.color }, { s: 55, e: 78, label: "harvest", tone: A.wheat }],
                b2: [{ s: 22, e: 80, label: "season-long bloom", tone: p.color }],
                c1: [{ s: 0, e: 22, label: "overwintered", tone: p.color }, { s: 22, e: 24, label: "terminate", tone: A.rust }],
                c2: [{ s: 0, e: 22, label: "overwintered", tone: p.color }, { s: 22, e: 24, label: "terminate", tone: A.rust }],
                d1: [{ s: 0, e: 22, label: "head", tone: p.color }, { s: 22, e: 32, label: "cut & come again", tone: A.wheat }],
                e1: [{ s: 8, e: 60, label: "bine growth", tone: p.color }, { s: 60, e: 72, label: "cone harvest", tone: A.wheat }],
                f1: [{ s: 4, e: 60, label: "leaf → fruit set", tone: p.color }, { s: 78, e: 92, label: "harvest", tone: A.wheat }],
                f2: [{ s: 0, e: 100, label: "year-round groundcover", tone: p.color }],
              })[p.id] || [{ s: 10, e: 70, label: "season", tone: p.color }];

              return (
                <div key={p.id} style={{
                  display: "grid", gridTemplateColumns: "120px 1fr", gap: 12, alignItems: "center", padding: "8px 0",
                  borderTop: i === 0 ? "none" : `1px dashed ${A.dividerSoft}`,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: A.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }} title={p.crop}>
                      {p.crop.split(" ").slice(0, 3).join(" ")}
                    </span>
                  </div>
                  <div style={{ position: "relative", height: 22, background: A.cream, borderRadius: 4, border: `1px solid ${A.dividerSoft}`, overflow: "hidden" }}>
                    {/* Per-row today marker — scoped to this track only */}
                    <div style={{ position: "absolute", left: "21%", top: 0, bottom: 0, width: 1, borderLeft: `2px solid ${A.rust}`, opacity: 0.5, zIndex: 0, pointerEvents: "none" }} />
                    {windows.map((w, j) => (
                      <div key={j} title={w.label} style={{
                        position: "absolute", left: `${w.s}%`, width: `${Math.max(1, w.e - w.s)}%`, top: 2, bottom: 2,
                        background: w.tone, opacity: 0.85, borderRadius: 3,
                        display: "flex", alignItems: "center", padding: "0 6px",
                        color: "white", fontSize: 9.5, fontWeight: 600, letterSpacing: "0.02em", overflow: "hidden", whiteSpace: "nowrap",
                        zIndex: 1,
                      }}>{w.label}</div>
                    ))}
                  </div>
                </div>
              );
            })}
          </A_Card>

          {/* ── Scheduled tasks (filtered by planting if selected) ── */}
          <A_Card style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <h3 className="serif" style={{ margin: 0, fontSize: 17, color: A.forestDeep }}>
                Scheduled tasks {isPoly && pIdx >= 0 ? `· ${planting.crop.split(" ").slice(0, 2).join(" ")}` : "· next 30 days"}
              </h3>
              <button style={{ ...A_ghostBtn, padding: "6px 10px", fontSize: 12.5 }}><Icon.Plus size={13} /> Task</button>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
              <thead>
                <tr style={{ color: A.inkMuted, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  <th style={tdStA}>Date</th>
                  <th style={tdStA}>Task</th>
                  <th style={tdStA}>Planting</th>
                  <th style={tdStA}>Source</th>
                  <th style={tdStA}>Status</th>
                  <th style={{ ...tdStA, textAlign: "right" }}></th>
                </tr>
              </thead>
              <tbody>
                {planTasksFor(block, planting, isPoly && pIdx >= 0).map((row, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${A.dividerSoft}` }}>
                    <td style={{ ...tdTdA, fontFamily: "IBM Plex Mono", color: A.inkSoft }}>{row.date}</td>
                    <td style={tdTdA}>{row.task}</td>
                    <td style={tdTdA}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5 }}>
                        <span style={{ width: 7, height: 7, borderRadius: 2, background: row.color }} />
                        {row.planting}
                      </span>
                    </td>
                    <td style={{ ...tdTdA, color: A.inkMuted, fontSize: 12.5 }}>{row.source}</td>
                    <td style={tdTdA}>
                      <A_Pill tone={row.status === "window-open" ? "wheat" : row.status === "today" ? "rust" : "neutral"}>{row.status}</A_Pill>
                    </td>
                    <td style={{ ...tdTdA, textAlign: "right" }}>
                      <Icon.ChevronRight size={14} style={{ color: A.inkMuted }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </A_Card>

        </div>
      </div>

      {/* ── Map overlay ── */}
      {showMap && (
        <div onClick={() => setShowMap(false)} style={{
          position: "absolute", inset: 0, background: "rgba(26,31,26,0.55)", zIndex: 10,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
          backdropFilter: "blur(2px)",
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: "min(960px, 100%)", background: A.paper, borderRadius: 12, overflow: "hidden",
            border: `1px solid ${A.divider}`, boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          }}>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${A.dividerSoft}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <A_Kicker>Field map</A_Kicker>
                <h3 className="serif" style={{ margin: "4px 0 0", fontSize: 19, color: A.forestDeep }}>{MOCK.farm} · {block.label} highlighted</h3>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <a href="#" style={{ ...A_ghostBtn, padding: "8px 12px", fontSize: 13 }}>
                  <Icon.ArrowRight size={13} /> Open full Map page
                </a>
                <button onClick={() => setShowMap(false)} style={{ ...A_iconBtn, width: 32, height: 32 }} title="Close"><Icon.X size={15} /></button>
              </div>
            </div>
            <div style={{ padding: 18 }}>
              <div style={{ position: "relative", aspectRatio: "2.4 / 1", background: "linear-gradient(180deg, #E6E1CB 0%, #DAD3B5 100%)", borderRadius: 8, border: `1px solid ${A.divider}`, overflow: "hidden" }}>
                {/* drive */}
                <div style={{ position: "absolute", top: "80%", left: 0, right: 0, height: 14, background: "#C2A78A", opacity: 0.5 }} />
                {m.blocks.map((b) => (
                  <button key={b.id} onClick={() => { setSelected(b.id); setShowMap(false); }} title={`${b.label} — ${b.crop}`} style={{
                    position: "absolute", left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%`,
                    background: b.color, opacity: b.id === selected ? 1 : 0.55,
                    borderRadius: 4, border: b.id === selected ? `3px solid ${A.ink}` : `1px solid rgba(0,0,0,0.15)`,
                    color: "white", display: "flex", flexDirection: "column", alignItems: "flex-start",
                    justifyContent: "flex-start", padding: "6px 8px", cursor: "pointer",
                    fontFamily: "IBM Plex Sans", fontWeight: 700,
                  }}>
                    <span style={{ fontSize: 12 }}>{b.label}</span>
                    <span style={{ fontSize: 9.5, fontWeight: 500, opacity: 0.9, marginTop: 1 }}>{(b.plantings || []).length || 1}× plantings</span>
                  </button>
                ))}
                <div style={{ position: "absolute", top: 10, left: 10, background: A.paper, padding: "4px 9px", borderRadius: 4, fontSize: 10, color: A.inkSoft, fontFamily: "IBM Plex Mono", fontWeight: 600, display: "flex", alignItems: "center", gap: 4, border: `1px solid ${A.divider}` }}>
                  <Icon.Compass size={11} /> N
                </div>
              </div>
              <div style={{ marginTop: 12, fontSize: 12.5, color: A.inkMuted, display: "flex", alignItems: "center", gap: 6 }}>
                <Icon.Info size={13} /> Click any block to jump there in Plan. The dedicated Map page has soil zones, irrigation, and pesticide-buffer overlays.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function tabBtnA(active, A) {
  return {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px 10px",
    background: "transparent", border: "none",
    color: active ? A.forestDeep : A.inkSoft, fontSize: 13, fontWeight: active ? 700 : 500,
    borderBottom: active ? `2.5px solid ${A.forest}` : "2.5px solid transparent",
    marginBottom: -1, cursor: "pointer", fontFamily: "inherit",
  };
}
function countPillA(A) {
  return {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    minWidth: 18, height: 18, padding: "0 5px", borderRadius: 99, fontSize: 10.5,
    fontWeight: 700, marginLeft: 2, fontFamily: "IBM Plex Mono",
  };
}
const tdStA = { textAlign: "left", padding: "8px 10px 8px 0", fontWeight: 600 };
const tdTdA = { padding: "12px 10px 12px 0", verticalAlign: "top", color: "#1A1F1A" };

// Lightweight task generator using the planting context
function planTasksFor(block, planting, scoped) {
  const all = {
    a: [
      { date: "May 26", task: "Sow climbing beans into corn hills", planting: "Cherokee Bean", color: "#7a3a4d", source: "Companion plugin", status: "today", pid: "a2" },
      { date: "May 27", task: "Side-dress N — 80 lb/A (skip bean hills)", planting: "Bloody Butcher Corn", color: "#c9961f", source: "Crop plugin · corn-bb", status: "scheduled", pid: "a1" },
      { date: "May 31", task: "Earworm trap check (weekly)", planting: "Bloody Butcher Corn", color: "#c9961f", source: "Recurring", status: "scheduled", pid: "a1" },
      { date: "Jun 2",  task: "Direct-sow Seminole pumpkin perimeter", planting: "Seminole Pumpkin", color: "#a85a1f", source: "Companion plugin · 3-sisters", status: "scheduled", pid: "a3" },
      { date: "Jun 12", task: "Spray window — Group 2 post-emerge (no bean overspray)", planting: "Bloody Butcher Corn", color: "#c9961f", source: "Safety kernel", status: "window-open", pid: "a1" },
    ],
    b: [
      { date: "May 28", task: "Transplant tomatoes — 24″ spacing", planting: "Brandywine Tomato", color: "#a23a3a", source: "Owner plan", status: "scheduled", pid: "b1" },
      { date: "May 28", task: "Plant marigold perimeter — 12″ spacing", planting: "French Marigold", color: "#d99a3a", source: "Companion plugin", status: "scheduled", pid: "b2" },
      { date: "Jun 10", task: "Stake & string tomatoes", planting: "Brandywine Tomato", color: "#a23a3a", source: "Crop plugin", status: "scheduled", pid: "b1" },
    ],
    c: [
      { date: "May 27", task: "Burndown — terminate cover before rye flowers", planting: "Cereal Rye", color: "#6b7e3a", source: "Safety kernel", status: "window-open", pid: "c1" },
    ],
    d: [
      { date: "May 27", task: "Begin first cut & come again harvest", planting: "Lettuce Mix", color: "#4a8b54", source: "Harvest engine", status: "today", pid: "d1" },
    ],
    e: [
      { date: "Jun 15", task: "First-cone scout — assess burr development", planting: "Cascade Hops", color: "#8a6b3a", source: "Crop plugin", status: "scheduled", pid: "e1" },
    ],
    f: [
      { date: "Jun 5",  task: "Codling-moth degree-day trap reset", planting: "Apple Goldrush", color: "#c9461f", source: "Crop plugin · orchard", status: "scheduled", pid: "f1" },
      { date: "Jun 8",  task: "Mow clover understory — 6″ height", planting: "White Clover", color: "#4d8e36", source: "Companion plugin", status: "scheduled", pid: "f2" },
    ],
  }[block.id] || [];
  return scoped ? all.filter((t) => t.pid === planting.id) : all;
}

window.A_PlanV2Screen = APlanV2Screen;

/* ── Workflow strip ───────────────────────────────────────────────
   Compact horizontal trail of the 5 wizard steps. Sits above the
   block header in Plan v2. Click a step → opens that wizard step
   (in this prototype, just a hover hint). Shows stale state when
   the active block has been edited since the last commit.
*/
function APlanWorkflowStrip({ block }) {
  const A = window.A_tokens;
  const sp = MOCK.seasonPlan;
  const stateConfig = {
    "done":        { bg: A.forest,     fg: A.cream,    bd: A.forest,     ico: "Check" },
    "in-progress": { bg: A.wheat,      fg: A.cream,    bd: A.wheat,      ico: "ChevronRight" },
    "stale":       { bg: "#F1D9CE",    fg: "#8A341B",  bd: "#E2B69E",    ico: "Alert" },
    "pending":     { bg: A.paper,      fg: A.inkMuted, bd: A.divider,    ico: null },
  };

  return (
    <div style={{
      background: A.paper, border: `1px solid ${A.divider}`, borderRadius: 10,
      padding: "14px 18px 12px", marginBottom: 16,
      display: "flex", alignItems: "center", gap: 14,
    }}>
      {/* Left label */}
      <div style={{ flexShrink: 0, paddingRight: 10, borderRight: `1px solid ${A.dividerSoft}` }}>
        <div style={{ fontSize: 10.5, color: A.inkMuted, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700 }}>
          Season {sp.year} plan
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
          <Icon.Sprout size={13} stroke={A.forest} />
          <span style={{ fontSize: 12.5, color: A.forestDeep, fontWeight: 600 }}>Workflow</span>
        </div>
      </div>

      {/* Trail */}
      <div style={{ flex: 1, display: "flex", alignItems: "center" }}>
        {sp.steps.map((s, i, arr) => {
          const c = stateConfig[s.state];
          const G = c.ico ? Icon[c.ico] : null;
          const isLast = i === arr.length - 1;
          return (
            <React.Fragment key={s.id}>
              <button title={s.note + (s.when ? ` — ${s.when}` : "")} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "5px 10px 5px 5px", borderRadius: 99,
                background: "transparent", border: "none", cursor: "pointer",
                fontFamily: "inherit",
              }}>
                <span style={{
                  width: 22, height: 22, borderRadius: 99,
                  background: c.bg, border: `1.5px solid ${c.bd}`, color: c.fg,
                  display: "grid", placeItems: "center", flexShrink: 0,
                  fontSize: 10, fontWeight: 700,
                }}>
                  {G ? <G size={11} /> : (i + 1)}
                </span>
                <div style={{ textAlign: "left", minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: A.ink, fontWeight: 600, lineHeight: 1.2 }}>{s.label}</div>
                  <div style={{ fontSize: 10.5, color: s.state === "stale" ? "#8A341B" : A.inkMuted, lineHeight: 1.3, marginTop: 1 }}>
                    {s.state === "done" && `✓ ${s.when}`}
                    {s.state === "in-progress" && `${s.when} · in progress`}
                    {s.state === "stale" && `Stale · refresh`}
                    {s.state === "pending" && `Pending`}
                  </div>
                </div>
              </button>
              {!isLast && (
                <div style={{
                  flex: 1, height: 2, background: stateConfig[arr[i + 1].state].bg === A.paper ? A.dividerSoft : (s.state === "done" ? A.forest : A.dividerSoft),
                  margin: "0 4px", borderRadius: 99, opacity: s.state === "done" ? 0.4 : 0.25,
                }} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* CTA */}
      <button style={{
        ...A_primaryBtn, padding: "8px 14px", fontSize: 12.5, flexShrink: 0,
        background: A.forest,
      }} title="Re-run any step or chat with the planning assistant">
        <Icon.ArrowRight size={13} /> Open wizard
      </button>
    </div>
  );
}

/* ── Per-planting provenance footer ──────────────────────────────
   Tells the user where this planting came from (AI plan,
   companion auto-add, manual, perennial, carry-forward) and
   gives one-tap access to refine it via the wizard.
*/
function APlantingProvenance({ plantingId }) {
  const A = window.A_tokens;
  const prov = (MOCK.plantingProvenance || {})[plantingId];
  if (!prov) return null;

  const tone = ({
    "AI plan":       { color: A.forest,   bg: "#E5EEDF", bd: "#C9DBC0", icon: "Sprout" },
    "Companion AI":  { color: A.wheat,    bg: A.wheatSoft, bd: "#D9C18F", icon: "Layers" },
    "Carry-forward": { color: A.sky,      bg: "#DEE7EF", bd: "#BDCDD9", icon: "ArrowRight" },
    "Manual":        { color: A.inkSoft,  bg: A.dividerSoft, bd: A.divider, icon: "User" },
    "Perennial":     { color: A.rust,     bg: "#F1D9CE", bd: "#E2B69E", icon: "Sprout" },
  })[prov.source] || { color: A.inkSoft, bg: A.dividerSoft, bd: A.divider, icon: "Info" };
  const G = Icon[tone.icon];

  return (
    <div style={{
      marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${A.dividerSoft}`,
      display: "flex", alignItems: "center", gap: 8,
    }}>
      <div title={prov.note || `${prov.source} · seeded ${prov.seededAt}`} style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "2px 8px", background: tone.bg, border: `1px solid ${tone.bd}`,
        borderRadius: 99, fontSize: 10.5, fontWeight: 700, color: tone.color, letterSpacing: "0.02em", textTransform: "uppercase",
      }}>
        <G size={10} /> {prov.source}
      </div>
      <span style={{ fontSize: 11, color: A.inkMuted }}>
        {prov.seededAt}
        {prov.edits > 0 && ` · refined ${prov.edits}× (last ${prov.lastEdit})`}
      </span>
      <button title="Open the planning wizard scoped to this planting" style={{
        marginLeft: "auto", background: "transparent", border: "none", color: A.forest,
        fontSize: 11.5, fontWeight: 600, padding: 0, display: "flex", alignItems: "center", gap: 3, cursor: "pointer",
        fontFamily: "inherit",
      }}>
        Refine <Icon.ChevronRight size={11} />
      </button>
    </div>
  );
}

window.APlanWorkflowStrip = APlanWorkflowStrip;
window.APlantingProvenance = APlantingProvenance;
