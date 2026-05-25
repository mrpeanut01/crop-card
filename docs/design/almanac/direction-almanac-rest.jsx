/* Almanac — Plan + Spray screens */

function APlanScreen() {
  const m = MOCK;
  const [selected, setSelected] = React.useState("a");
  const block = m.blocks.find((b) => b.id === selected);
  const A = window.A_tokens;

  return (
    <div className="dir-a" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <A_TopBar active="plan" />

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "300px 1fr 320px", gap: 0, overflow: "hidden" }}>

        {/* Left rail: block list */}
        <div style={{ borderRight: `1px solid ${A.divider}`, background: A.paper, overflow: "auto" }}>
          <div style={{ padding: "20px 20px 14px", borderBottom: `1px solid ${A.dividerSoft}` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <A_Kicker>Blocks · 6</A_Kicker>
              <button title="New block" style={{ ...A_iconBtn, width: 28, height: 28 }}><Icon.Plus size={14} /></button>
            </div>
            <div style={{ marginTop: 10, position: "relative" }}>
              <Icon.Search size={14} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: A.inkMuted }} />
              <input placeholder="Filter blocks…" style={{
                width: "100%", padding: "7px 10px 7px 30px", fontSize: 13,
                background: A.cream, border: `1px solid ${A.divider}`, borderRadius: 6, color: A.ink, outline: "none",
                fontFamily: "inherit",
              }} />
            </div>
          </div>
          <div>
            {m.blocks.map((b) => {
              const sel = b.id === selected;
              return (
                <button key={b.id} onClick={() => setSelected(b.id)} style={{
                  width: "100%", textAlign: "left", padding: "14px 18px", display: "flex", alignItems: "center", gap: 12,
                  background: sel ? "#EFE6CC" : "transparent", border: "none",
                  borderLeft: sel ? `3px solid ${A.forest}` : "3px solid transparent",
                  borderBottom: `1px solid ${A.dividerSoft}`,
                }}>
                  <div style={{ width: 10, height: 28, borderRadius: 2, background: b.color }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span className="serif" style={{ fontSize: 15, color: A.ink }}>{b.label}</span>
                      <span className="mono" style={{ fontSize: 11, color: A.inkMuted }}>{b.acres} ac</span>
                    </div>
                    <div style={{ fontSize: 12, color: A.inkSoft, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.crop}</div>
                  </div>
                  <A_Pill tone={b.status === "active" ? "forest" : b.status === "planned" ? "sky" : b.status === "terminating" ? "rust" : "neutral"}>{b.stage}</A_Pill>
                </button>
              );
            })}
          </div>
        </div>

        {/* Main: block detail + season timeline */}
        <div style={{ overflow: "auto", padding: "24px 28px 36px", background: A.cream }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 18 }}>
            <div>
              <A_Kicker>Block · {block.acres} ac · planted {block.planted}</A_Kicker>
              <h1 className="serif" style={{ margin: "6px 0 0", fontSize: 32, color: A.forestDeep, letterSpacing: "-0.02em" }}>
                {block.label} — {block.crop}
              </h1>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <A_Pill tone="forest">{block.stage}</A_Pill>
                <A_Pill tone="neutral">{block.variety}</A_Pill>
                <A_Pill tone="wheat">harvest {block.harvest}</A_Pill>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={A_ghostBtn}><Icon.Wrench size={14} /> Edit</button>
              <button style={A_primaryBtn}><Icon.Plus size={14} /> Add planting</button>
            </div>
          </div>

          {/* Season timeline — Gantt-ish */}
          <A_Card style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <h3 className="serif" style={{ margin: 0, fontSize: 17, color: A.forestDeep }}>Season · 2026</h3>
              <div style={{ fontSize: 12, color: A.inkMuted }}>Apr ─ Oct</div>
            </div>
            <div style={{ position: "relative", height: 70, background: A.cream, borderRadius: 6, border: `1px solid ${A.dividerSoft}`, overflow: "hidden" }}>
              {/* month gridlines */}
              {["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"].map((mo, i) => (
                <div key={mo} style={{
                  position: "absolute", left: `${(i / 7) * 100}%`, top: 0, bottom: 0,
                  borderLeft: i === 0 ? "none" : `1px solid ${A.dividerSoft}`,
                  width: `${100 / 7}%`, padding: "4px 8px",
                }}>
                  <span style={{ fontSize: 10.5, color: A.inkMuted, fontWeight: 600, letterSpacing: "0.06em" }}>{mo.toUpperCase()}</span>
                </div>
              ))}
              {/* today marker */}
              <div style={{ position: "absolute", left: "21%", top: 24, bottom: 0, borderLeft: `2px solid ${A.rust}` }} />
              <div style={{ position: "absolute", left: "21%", top: 22, transform: "translateX(-50%)", background: A.rust, color: A.cream, fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 3 }}>TODAY</div>
              {/* spans */}
              <div style={{ position: "absolute", left: "5%", top: 38, height: 22, width: "65%", background: A.forest, opacity: 0.85, borderRadius: 4, display: "flex", alignItems: "center", padding: "0 10px", color: A.cream, fontSize: 11.5, fontWeight: 500 }}>
                Vegetative ─ Reproductive ─ Maturity
              </div>
              <div style={{ position: "absolute", left: "70%", top: 38, height: 22, width: "10%", background: A.wheat, borderRadius: 4, display: "flex", alignItems: "center", padding: "0 10px", color: A.cream, fontSize: 11.5, fontWeight: 600 }}>
                Harvest
              </div>
            </div>
          </A_Card>

          {/* Scheduled tasks */}
          <A_Card style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <h3 className="serif" style={{ margin: 0, fontSize: 17, color: A.forestDeep }}>Scheduled tasks · next 30 days</h3>
              <button style={{ ...A_ghostBtn, padding: "6px 10px", fontSize: 12.5 }}><Icon.Plus size={13} /> Task</button>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
              <thead>
                <tr style={{ color: A.inkMuted, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  <th style={tableThA}>Date</th>
                  <th style={tableThA}>Task</th>
                  <th style={tableThA}>Source</th>
                  <th style={tableThA}>Status</th>
                  <th style={{ ...tableThA, textAlign: "right" }}></th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["May 27", "Side-dress nitrogen — 80 lb N/A", "Crop plugin (corn-bb)", "scheduled"],
                  ["May 31", "Scout — corn earworm trap check", "Recurring", "scheduled"],
                  ["Jun 4",  "Cultivate inter-row", "Owner", "scheduled"],
                  ["Jun 12", "Spray window — Group 2 post-emerge", "Safety kernel", "window-open"],
                ].map((row, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${A.dividerSoft}` }}>
                    <td style={{ ...tableTdA, fontFamily: "IBM Plex Mono, monospace", color: A.inkSoft }}>{row[0]}</td>
                    <td style={tableTdA}>{row[1]}</td>
                    <td style={{ ...tableTdA, color: A.inkMuted, fontSize: 12.5 }}>{row[2]}</td>
                    <td style={tableTdA}>
                      <A_Pill tone={row[3] === "window-open" ? "wheat" : "neutral"}>{row[3]}</A_Pill>
                    </td>
                    <td style={{ ...tableTdA, textAlign: "right" }}>
                      <Icon.ChevronRight size={14} style={{ color: A.inkMuted }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </A_Card>

          {/* Recent activity */}
          <A_Card>
            <h3 className="serif" style={{ margin: "0 0 12px", fontSize: 17, color: A.forestDeep }}>Recent activity</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {[
                ["May 24", "Scout note", "8 earworm moths in pheromone trap (week)", "Sherry"],
                ["May 18", "Spray recorded", "Atrazine 1.5 qt/A + COC — V4 burndown", "Marco"],
                ["May 12", "Planting", "Direct-seeded 12,000 kernels @ 28k pop/A", "Marco"],
              ].map((r, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "84px 1fr auto", gap: 14, padding: "10px 0", borderTop: i === 0 ? "none" : `1px solid ${A.dividerSoft}` }}>
                  <div className="mono" style={{ color: A.inkMuted, fontSize: 12.5 }}>{r[0]}</div>
                  <div>
                    <div style={{ fontSize: 13.5, color: A.ink }}><strong style={{ fontWeight: 600 }}>{r[1]}.</strong> {r[2]}</div>
                  </div>
                  <div style={{ color: A.inkMuted, fontSize: 12 }}>{r[3]}</div>
                </div>
              ))}
            </div>
          </A_Card>
        </div>

        {/* Right rail: companion suggestions + map glance */}
        <div style={{ borderLeft: `1px solid ${A.divider}`, background: A.paper, padding: "22px 18px", overflow: "auto" }}>
          <A_Kicker>Field map</A_Kicker>
          <div style={{ marginTop: 10, aspectRatio: "1.1", background: A.cream, border: `1px solid ${A.divider}`, borderRadius: 8, position: "relative", overflow: "hidden" }}>
            {/* simple block layout */}
            {m.blocks.map((b) => (
              <div key={b.id} onClick={() => setSelected(b.id)} style={{
                position: "absolute", left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%`,
                background: b.color, opacity: b.id === selected ? 1 : 0.55,
                borderRadius: 4, border: b.id === selected ? `2px solid ${A.ink}` : `1px solid rgba(0,0,0,0.1)`,
                display: "flex", alignItems: "center", justifyContent: "center", color: "white",
                fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", cursor: "pointer",
              }} title={`${b.label} — ${b.crop}`}>
                {b.label.replace("Block ", "")}
              </div>
            ))}
          </div>

          <div style={{ marginTop: 22 }}>
            <A_Kicker>Suggestions for {block.label}</A_Kicker>
            <div style={{ marginTop: 10 }}>
              {m.suggestions.slice(0, 3).map((s) => (
                <div key={s.id} style={{ padding: "12px 0", borderTop: `1px dashed ${A.dividerSoft}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <A_Pill tone={s.priority === "high" ? "wheat" : "neutral"}>{s.priority}</A_Pill>
                  </div>
                  <div style={{ fontSize: 13, color: A.ink, fontWeight: 500, lineHeight: 1.4 }}>{s.title}</div>
                  <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 3 }}>{s.source}</div>
                  <div className="mono" style={{ fontSize: 11.5, color: A.inkSoft, marginTop: 3 }}>{s.window}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const tableThA = {
  textAlign: "left", padding: "8px 10px 8px 0", fontWeight: 600,
};
const tableTdA = {
  padding: "12px 10px 12px 0", verticalAlign: "top", color: "#1A1F1A",
};

/* ── Spray ────────────────────────────────────────────────────── */
function ASprayScreen() {
  const m = MOCK;
  const sp = m.sprayPlan;
  const A = window.A_tokens;
  // Multi-block: resolve each block reference; show primary block info if single.
  const targetBlocks = sp.blocks.map((b) => ({ ...b, full: m.blocks.find((x) => x.id === b.id) }));
  const primaryBlock = targetBlocks[0].full;
  const totalAc = targetBlocks.reduce((s, b) => s + b.area, 0);
  const sprayer = m.sprayers.find((s) => s.id === sp.sprayer);
  const allChecksOk = sp.checks.every((c) => c.ok);
  const hasWarning = sp.products.some((p) => p.status === "warn");
  const primaryTargets = sp.targets.filter((t) => t.primary);
  const otherTargets = sp.targets.filter((t) => !t.primary);

  return (
    <div className="dir-a" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <A_TopBar active="spray" />

      <div style={{ flex: 1, overflow: "auto", padding: "24px 28px 32px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>

          {/* Stepper */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 22 }}>
            {[
              ["Block & crop", true],
              ["Sprayer & tank", true],
              ["Mix", true],
              ["Safety check", false],
              ["Confirm & record", false],
            ].map(([label, done], i, arr) => (
              <React.Fragment key={label}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: 99,
                    background: done ? A.forest : (i === 3 ? A.wheat : A.paper),
                    border: `1px solid ${done ? A.forest : (i === 3 ? A.wheat : A.divider)}`,
                    color: (done || i === 3) ? A.cream : A.inkMuted,
                    display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700,
                  }}>{done ? "✓" : i + 1}</div>
                  <span style={{ fontSize: 13, color: (done || i === 3) ? A.ink : A.inkMuted, fontWeight: i === 3 ? 600 : 500 }}>{label}</span>
                </div>
                {i < arr.length - 1 && <div style={{ flex: 1, height: 1, background: A.divider }} />}
              </React.Fragment>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 18 }}>

            {/* LEFT: the "recipe" */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Context strip — block(s), crop, stage, target(s) */}
              <A_Card padded={false}>
                <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr 1.3fr", borderBottom: `1px solid ${A.dividerSoft}` }}>
                  {/* BLOCKS — supports 1 or N */}
                  <div style={{ padding: "16px 18px", borderRight: `1px solid ${A.dividerSoft}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, color: A.inkMuted, fontSize: 10.5, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                      <Icon.Field size={12} /> {targetBlocks.length === 1 ? "Block" : `Blocks · ${targetBlocks.length}`}
                    </div>
                    {targetBlocks.length === 1 ? (
                      <div style={{ fontSize: 14, color: A.ink, marginTop: 4 }}>{primaryBlock.label} · <span className="mono">{totalAc.toFixed(1)} ac</span></div>
                    ) : (
                      <>
                        <div style={{ fontSize: 14, color: A.ink, marginTop: 4, fontWeight: 500 }}>{totalAc.toFixed(1)} ac combined</div>
                        <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {targetBlocks.map((b) => (
                            <span key={b.id} title={`${b.full.label} — ${b.full.crop} — ${b.area} ac — stage ${b.stage}`} style={{
                              display: "inline-flex", alignItems: "center", gap: 4,
                              padding: "1px 7px", background: A.paper, border: `1px solid ${A.divider}`,
                              borderRadius: 99, fontSize: 11, color: A.ink,
                            }}>
                              <span style={{ width: 6, height: 6, borderRadius: 2, background: b.full.color }} />
                              {b.full.label.replace("Block ", "")} <span style={{ color: A.inkMuted, fontFamily: "IBM Plex Mono", fontSize: 10 }}>{b.area}ac</span>
                            </span>
                          ))}
                          <button title="Add another compatible block to this spray" style={{
                            padding: "1px 7px", background: "transparent", border: `1px dashed ${A.divider}`,
                            borderRadius: 99, fontSize: 11, color: A.forest, fontWeight: 600, cursor: "pointer",
                            display: "inline-flex", alignItems: "center", gap: 3,
                          }}><Icon.Plus size={9} /> Add block</button>
                        </div>
                      </>
                    )}
                  </div>
                  {/* CROP */}
                  <div style={{ padding: "16px 18px", borderRight: `1px solid ${A.dividerSoft}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, color: A.inkMuted, fontSize: 10.5, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                      <Icon.Sprout size={12} /> Crop
                    </div>
                    <div style={{ fontSize: 14, color: A.ink, marginTop: 4 }}>{sp.crop}</div>
                    <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 2 }}>Bloody Butcher · Painted Mtn</div>
                  </div>
                  {/* STAGE */}
                  <div style={{ padding: "16px 18px", borderRight: `1px solid ${A.dividerSoft}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, color: A.inkMuted, fontSize: 10.5, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                      <Icon.Layers size={12} /> Stage
                    </div>
                    <div style={{ fontSize: 14, color: A.ink, marginTop: 4 }}>{sp.stage}</div>
                    <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 2 }}>both pre-VT, atrazine OK</div>
                  </div>
                  {/* TARGETS — weed species with overflow */}
                  <div style={{ padding: "16px 18px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, color: A.inkMuted, fontSize: 10.5, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                      <Icon.Compass size={12} /> Target weeds · {sp.targets.length}
                    </div>
                    <div style={{ marginTop: 5, display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {primaryTargets.map((w) => (
                        <span key={w.name} title={`${w.name} — pressure: ${w.pressure}`} style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          padding: "1px 7px", background: w.pressure === "heavy" ? "#F1D9CE" : A.wheatSoft,
                          border: `1px solid ${w.pressure === "heavy" ? "#E2B69E" : "#D9C18F"}`,
                          borderRadius: 99, fontSize: 11, color: w.pressure === "heavy" ? "#8A341B" : "#8A6722", fontWeight: 500,
                        }}>
                          {w.name.split(" ")[0]}
                        </span>
                      ))}
                      <button title={otherTargets.map((t) => `${t.name} — ${t.pressure}`).join(" \u2022 ")} style={{
                        padding: "1px 7px", background: A.paper, border: `1px dashed ${A.divider}`,
                        borderRadius: 99, fontSize: 11, color: A.inkSoft, fontWeight: 500, cursor: "pointer",
                      }}>+ {otherTargets.length} more</button>
                    </div>
                  </div>
                </div>
                {/* Compatibility banner */}
                <div style={{ padding: "10px 18px", display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: A.forestDeep, background: "#EFF6E9" }}>
                  <Icon.CheckCircle size={15} stroke={A.forest} />
                  <span><strong>{sp.blockCompatibility.label}.</strong> <span title={sp.blockCompatibility.reason} style={{ color: A.inkSoft, cursor: "help", textDecoration: "underline dotted" }}>Why is this allowed?</span></span>
                  <a style={{ marginLeft: "auto", color: A.forest, fontWeight: 600 }}>Change selection →</a>
                </div>
              </A_Card>

              {/* Tank mix builder */}
              <A_Card>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div>
                    <h3 className="serif" style={{ margin: 0, fontSize: 18, color: A.forestDeep }}>Tank mix</h3>
                    <div style={{ fontSize: 12.5, color: A.inkMuted, marginTop: 2 }}>{sprayer.label} · {sp.tankSize} gal tank · calibrated {sp.gpa} GPA · covers <span className="mono">{sp.area} ac</span></div>
                  </div>
                  <button style={{ ...A_ghostBtn, padding: "7px 12px", fontSize: 13 }}>
                    <Icon.Plus size={14} /> Add product
                  </button>
                </div>

                <div style={{ background: A.cream, borderRadius: 8, border: `1px solid ${A.dividerSoft}`, overflow: "hidden" }}>
                  {sp.products.map((p, i) => (
                    <div key={p.id} style={{
                      padding: "14px 16px",
                      borderTop: i === 0 ? "none" : `1px solid ${A.dividerSoft}`,
                      background: p.status === "warn" ? "#FBF1E5" : "transparent",
                    }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 14, alignItems: "center" }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ width: 12, height: 12, borderRadius: 3, background: p.color, flexShrink: 0 }} />
                            <span style={{ fontSize: 14.5, color: A.ink, fontWeight: 600 }}>{p.name}</span>
                            {p.status === "warn" && <A_Pill tone="wheat">Caution</A_Pill>}
                            {p.status === "ok" && <A_Pill tone="forest">OK</A_Pill>}
                          </div>
                          <div style={{ fontSize: 12.5, color: A.inkMuted, marginTop: 3 }}>{p.group}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div className="mono" style={{ fontSize: 13.5, color: A.ink }}>{p.rate}</div>
                          <div className="mono" style={{ fontSize: 11.5, color: A.inkMuted }}>{p.total} total · split across {sp.tanks.length} tanks</div>
                        </div>
                        <button style={{ ...A_iconBtn, width: 30, height: 30 }} title="Remove"><Icon.X size={14} /></button>
                      </div>
                      {p.warning && (
                        <div style={{ marginTop: 10, padding: "10px 12px", background: "#FBE4D2", border: `1px solid #E2B69E`, borderRadius: 6, fontSize: 12.5, color: "#6E2A13", display: "flex", gap: 8, alignItems: "flex-start" }}>
                          <Icon.Alert size={14} />
                          <span>{p.warning}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 22, paddingTop: 14, borderTop: `1px dashed ${A.divider}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: A.sky, letterSpacing: "0.12em", textTransform: "uppercase" }}>+ Carrier</span>
                    <span style={{ fontSize: 11.5, color: A.inkMuted }}>fills the rest of the tank</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "#E4ECF1", borderRadius: 6, border: `1px solid #B9CBD7` }}>
                    <div style={{ width: 30, height: 30, borderRadius: 6, background: "#FFFFFF", display: "grid", placeItems: "center", color: A.sky, border: `1px solid #B9CBD7`, flexShrink: 0 }}>
                      <Icon.Droplet size={15} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13.5, color: A.ink, fontWeight: 600 }}>Water</div>
                      <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 1 }}>Clean well water · 7.0 pH · not a product</div>
                    </div>
                    <div className="mono" style={{ fontSize: 14, color: A.ink, fontWeight: 600 }}>22.4 gal</div>
                  </div>
                </div>
              </A_Card>

              {/* Safety pre-flight */}
              <A_Card>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <h3 className="serif" style={{ margin: 0, fontSize: 18, color: A.forestDeep }}>Pre-spray check</h3>
                  <A_Pill tone={hasWarning ? "wheat" : "forest"}>
                    {hasWarning ? "1 caution · review" : `${sp.checks.length}/6 passed`}
                  </A_Pill>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {sp.checks.map((c) => (
                    <div key={c.id} style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                      background: c.ok ? "#EFF6E9" : "#FBE4D2",
                      border: `1px solid ${c.ok ? "#C9DBC0" : "#E2B69E"}`, borderRadius: 6,
                    }}>
                      <div style={{ color: c.ok ? A.forest : A.rust, display: "grid", placeItems: "center" }}>
                        {c.ok ? <Icon.CheckCircle size={18} /> : <Icon.Alert size={18} />}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, color: A.ink, fontWeight: 500 }}>{c.label}</div>
                        <div className="mono" style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 2 }}>{c.value} · {c.threshold}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </A_Card>
            </div>

            {/* RIGHT: confirm panel + multi-tank breakdown */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <A_Card style={{ position: "sticky", top: 24 }} padded={false}>
                <div style={{ padding: "18px 20px 16px", borderBottom: `1px solid ${A.dividerSoft}` }}>
                  <A_Kicker>Ready to record</A_Kicker>
                  <h3 className="serif" style={{ margin: "8px 0 0", fontSize: 22, color: A.forestDeep, letterSpacing: "-0.01em" }}>
                    {sp.tanks.length} tanks · {sp.products.length} products
                  </h3>
                  <div style={{ fontSize: 13, color: A.inkSoft, marginTop: 4 }}>
                    on {targetBlocks.length === 1 ? primaryBlock.label : `${targetBlocks.length} corn blocks`} — <span className="mono">{totalAc.toFixed(1)} ac</span> at <span className="mono">{sp.gpa} GPA</span>
                  </div>
                </div>

                {/* Multi-tank visual — colored layers tied to product palette */}
                <div style={{ padding: "18px 20px", background: "#FBF5E6", borderBottom: `1px solid ${A.dividerSoft}` }}>
                  <div style={{ display: "flex", justifyContent: "center", gap: 22, alignItems: "flex-end" }}>
                    {sp.tanks.map((t) => {
                      const fillPct = t.fill / sp.tankSize; // 0..1
                      const tankH = 140, tankW = 64;
                      const fillH = Math.max(8, fillPct * (tankH - 16));
                      const fillY = tankH - 6 - fillH;
                      // Sequence of layered bands within the fill — proportional to products + water
                      const layers = [
                        { color: sp.waterColor, share: 0.92 },
                        { color: sp.products[2].color, share: 0.01 },
                        { color: sp.products[1].color, share: 0.025 },
                        { color: sp.products[0].color, share: 0.045 },
                      ];
                      let yCursor = fillY;
                      return (
                        <div key={t.idx} style={{ width: tankW + 36, textAlign: "center" }}>
                          <div style={{ fontSize: 10.5, fontWeight: 700, color: A.inkMuted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>
                            Tank {t.idx}
                          </div>
                          <svg viewBox={`0 0 ${tankW + 36} ${tankH + 4}`} width={tankW + 36} height={tankH + 4}>
                            {/* tank silhouette */}
                            <rect x="18" y="8" width={tankW} height={tankH - 12} rx="9" fill={A.paper} stroke={A.divider} strokeWidth="1.5" />
                            <rect x="32" y="0" width={tankW - 28} height="10" rx="2" fill={A.paper} stroke={A.divider} strokeWidth="1.5" />
                            {/* fill */}
                            <clipPath id={`clip-${t.idx}`}>
                              <rect x="18" y="8" width={tankW} height={tankH - 12} rx="9" />
                            </clipPath>
                            <g clipPath={`url(#clip-${t.idx})`}>
                              {layers.map((L, i) => {
                                const h = fillH * L.share;
                                const y = yCursor;
                                yCursor += h;
                                return <rect key={i} x="18" y={y} width={tankW} height={h + 1} fill={L.color} opacity={i === 0 ? 0.85 : 1} />;
                              })}
                            </g>
                            {/* gallon label */}
                            <text x={tankW / 2 + 18} y={tankH - 4 - fillH / 2 + 4} textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700" fontFamily="IBM Plex Mono">{t.fill} gal</text>
                            {/* fill markers on side */}
                            <line x1={tankW + 18} y1={fillY} x2={tankW + 22} y2={fillY} stroke={A.inkMuted} strokeWidth="1" />
                            <text x={tankW + 25} y={fillY + 3} fontSize="8.5" fill={A.inkMuted} fontFamily="IBM Plex Mono">{t.fill}g</text>
                            <line x1={tankW + 18} y1={8} x2={tankW + 22} y2={8} stroke={A.inkMuted} strokeWidth="1" strokeDasharray="2 2" />
                            <text x={tankW + 25} y={11} fontSize="8.5" fill={A.inkMuted} fontFamily="IBM Plex Mono">25g</text>
                          </svg>
                          <div style={{ fontSize: 11, color: A.inkSoft, marginTop: -2 }}>
                            {fillPct >= 0.99 ? "Full" : `${Math.round(fillPct * 100)}% of 25 gal`}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 10, fontSize: 11.5, color: A.inkSoft, textAlign: "center", lineHeight: 1.5 }}>
                    <span className="mono">{sp.totalGal} gal total</span> · spread the rates evenly across both tanks. Mix Tank 2 partial at the truck.
                  </div>
                </div>

                {/* Per-tank ingredient table with color key */}
                <div style={{ padding: "14px 20px" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                    <thead>
                      <tr style={{ color: A.inkMuted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
                        <th style={{ textAlign: "left", padding: "4px 0", fontWeight: 700 }}>Ingredient</th>
                        <th style={{ textAlign: "right", padding: "4px 6px", fontWeight: 700 }}>Tank 1</th>
                        <th style={{ textAlign: "right", padding: "4px 0", fontWeight: 700 }}>Tank 2</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sp.products.map((p) => (
                        <tr key={p.id} style={{ borderTop: `1px dashed ${A.dividerSoft}` }}>
                          <td style={{ padding: "7px 0", color: A.ink }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                              <span style={{ width: 10, height: 10, borderRadius: 2, background: p.color, flexShrink: 0 }} />
                              <span style={{ fontWeight: 500 }}>{p.name.split(" ").slice(0, 2).join(" ")}</span>
                            </span>
                          </td>
                          <td className="mono" style={{ padding: "7px 6px", textAlign: "right", color: A.ink }}>{p.perTank[0]}</td>
                          <td className="mono" style={{ padding: "7px 0", textAlign: "right", color: A.ink }}>{p.perTank[1]}</td>
                        </tr>
                      ))}
                      <tr style={{ borderTop: `1px dashed ${A.dividerSoft}` }}>
                        <td style={{ padding: "7px 0", color: A.ink }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                            <span style={{ width: 10, height: 10, borderRadius: 2, background: sp.waterColor, flexShrink: 0 }} />
                            <span style={{ fontWeight: 500 }}>Water · carrier</span>
                          </span>
                        </td>
                        <td className="mono" style={{ padding: "7px 6px", textAlign: "right", color: A.ink }}>{sp.waterPerTank[0]}</td>
                        <td className="mono" style={{ padding: "7px 0", textAlign: "right", color: A.ink }}>{sp.waterPerTank[1]}</td>
                      </tr>
                      <tr style={{ borderTop: `1px solid ${A.divider}`, background: "#F4ECD8" }}>
                        <td style={{ padding: "8px 0", color: A.inkSoft, fontWeight: 600, fontSize: 11.5 }}>Total fill</td>
                        <td className="mono" style={{ padding: "8px 6px", textAlign: "right", color: A.forestDeep, fontWeight: 700 }}>{sp.tanks[0].fill} gal</td>
                        <td className="mono" style={{ padding: "8px 0", textAlign: "right", color: A.forestDeep, fontWeight: 700 }}>{sp.tanks[1].fill} gal</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Confirm */}
                <div style={{ padding: "0 20px 20px" }}>
                  <button style={{
                    width: "100%", padding: "14px",
                    background: hasWarning ? A.wheat : A.forest, color: A.cream,
                    border: "none", borderRadius: 6, fontSize: 15, fontWeight: 600,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  }}>
                    {hasWarning ? <><Icon.Alert size={16} /> Acknowledge & continue</> : <><Icon.Check size={16} /> Confirm & record both tanks</>}
                  </button>
                  <button style={{ ...A_ghostBtn, width: "100%", marginTop: 8, justifyContent: "center" }}>
                    Save as draft
                  </button>
                  <div style={{ marginTop: 12, padding: "10px 12px", background: A.cream, border: `1px solid ${A.dividerSoft}`, borderRadius: 6, fontSize: 11.5, color: A.inkMuted, display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <Icon.Lock size={13} style={{ marginTop: 2, flexShrink: 0 }} />
                    <span>One record per spray event; both tanks roll up. Locks 48 h after submit per FR-09.</span>
                  </div>
                </div>
              </A_Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.A_PlanScreen = APlanScreen;
window.A_SprayScreen = ASprayScreen;
