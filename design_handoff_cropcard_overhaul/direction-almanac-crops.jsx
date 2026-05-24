/* Direction A — Almanac · Crop archetype screens
   Validates the plugin-driven stage/harvest/phenology abstractions by
   rendering 4 representative scenarios:
     1. Wheat Plan v2     — Zadoks stages + FHB forecast + moisture harvest
     2. Grape Harvest     — Brix/pH/TA capture with sample trend
     3. Hay flow          — Mow → Ted → Rake → Bale sequence + weather GO/NO-GO
     4. Tree-fruit harvest — Goldrush multi-pick (5 picks Aug → Nov)
*/

const _kicS = () => ({ fontSize: 11, fontWeight: 600, color: "#7A7F75", letterSpacing: "0.12em", textTransform: "uppercase" });
const _monoS = { fontFamily: "IBM Plex Mono, ui-monospace, monospace" };

/* ═══════════════════ WHEAT (small grain) ═════════════════════ */
function AWheatPlanScreen() {
  const A = window.A_tokens;
  const w = MOCK.cropScenarios.wheat;

  return (
    <div className="dir-a" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <A_TopBar active="plan" />
      <div style={{ flex: 1, overflow: "auto", padding: "24px 28px 32px" }}>
        <div style={{ maxWidth: 1180, margin: "0 auto" }}>

          {/* Header */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 22 }}>
            <div>
              <div style={_kicS()}>{w.block.label} · {w.block.acres} ac · small grain · stage scale: {w.stageScale}</div>
              <h1 className="serif" style={{ margin: "6px 0 0", fontSize: 30, color: A.forestDeep, letterSpacing: "-0.02em", lineHeight: 1.05 }}>{w.block.crop}</h1>
              <div style={{ fontSize: 13, color: A.inkMuted, marginTop: 3 }}>{w.block.variety} · planted {w.block.planted} · harvest target {w.block.harvest}</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={A_ghostBtn}><Icon.Wrench size={14} /> Edit block</button>
              <button style={A_primaryBtn}><Icon.Plus size={14} /> Record event</button>
            </div>
          </div>

          {/* Plugin-driven schema info banner */}
          <div style={{ padding: "10px 14px", marginBottom: 14, background: "#EFF6E9", border: `1px solid #C9DBC0`, borderLeft: `3px solid ${A.forest}`, borderRadius: 8, fontSize: 12.5, color: A.forestDeep, display: "flex", alignItems: "center", gap: 10 }}>
            <Icon.Info size={14} stroke={A.forest} />
            <span><strong>Plugin-driven schema:</strong> the <span style={_monoS}>wheat-hrw</span> plugin tells the app to use the <strong>Zadoks scale</strong> (Z11–Z99) instead of V-stages, and to render the harvest form with <strong>bushels + moisture + test weight</strong> fields. Same shell — different schema.</span>
          </div>

          {/* Stage timeline */}
          <A_Card padded={false} style={{ marginBottom: 14 }}>
            <div style={{ padding: "14px 18px 10px", borderBottom: `1px solid ${A.dividerSoft}` }}>
              <h3 className="serif" style={{ margin: 0, fontSize: 17, color: A.forestDeep }}>Zadoks growth stages</h3>
              <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 2 }}>{w.currentStage.label} ({w.currentStage.id}) · {w.currentStage.date} · next: {w.currentStage.next}</div>
            </div>
            <div style={{ padding: "16px 22px", position: "relative" }}>
              <div style={{ position: "absolute", left: 22, right: 22, top: 38, height: 2, background: A.divider, borderRadius: 99 }} />
              <div style={{ position: "relative", display: "flex", justifyContent: "space-between" }}>
                {w.stages.map((s) => (
                  <div key={s.id} style={{ flex: 1, textAlign: "center", position: "relative" }} title={`${s.label} (${s.id}) — ${s.when}`}>
                    <div style={{
                      width: 20, height: 20, borderRadius: 99,
                      background: s.done ? A.forest : (s.current ? A.wheat : (s.fhbGate ? "#F1D9CE" : (s.harvestGate ? "#E8D9B5" : A.paper))),
                      border: `2px solid ${s.done ? A.forest : (s.current ? A.wheat : A.divider)}`,
                      margin: "12px auto 8px", display: "grid", placeItems: "center", fontSize: 9, fontWeight: 800,
                      color: (s.done || s.current) ? A.cream : (s.fhbGate ? "#8A341B" : A.inkSoft),
                      position: "relative", zIndex: 1,
                    }}>{s.done ? "✓" : s.current ? "●" : (s.fhbGate ? "⚠" : (s.harvestGate ? "★" : ""))}</div>
                    <div style={{ ..._monoS, fontSize: 10.5, color: s.current ? A.forestDeep : A.inkMuted, fontWeight: 700 }}>{s.id}</div>
                    <div style={{ fontSize: 10.5, color: A.inkSoft, marginTop: 2, lineHeight: 1.3, padding: "0 4px" }}>{s.label}</div>
                    <div style={{ ..._monoS, fontSize: 9.5, color: A.inkMuted, marginTop: 2 }}>{s.when}</div>
                  </div>
                ))}
              </div>
            </div>
          </A_Card>

          {/* Two-col: FHB gate + vernalization */}
          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 14, marginBottom: 14 }}>
            <A_Card padded={false}>
              <div style={{ padding: "14px 18px 12px", borderBottom: `1px solid ${A.dividerSoft}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Icon.CloudRain size={15} stroke={A.wheat} />
                  <h3 className="serif" style={{ margin: 0, fontSize: 16, color: A.forestDeep }}>Fusarium Head Blight forecast</h3>
                  <A_Pill tone="wheat">Window opens {w.fhbForecast.windowOpens}</A_Pill>
                </div>
                <div style={{ fontSize: 12, color: A.inkMuted, marginTop: 4 }}>{w.fhbForecast.modelName} · spray timing critical at Z61–Z69 (flowering)</div>
              </div>
              <div style={{ padding: "14px 18px", display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 18 }}>
                <div>
                  <div style={{ fontSize: 10.5, color: A.inkMuted, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Current risk</div>
                  <div className="serif" style={{ fontSize: 32, color: A.forestDeep, marginTop: 4, lineHeight: 1 }}>Low</div>
                  <div style={{ fontSize: 12, color: A.inkSoft, marginTop: 6, lineHeight: 1.5 }}>{w.fhbForecast.nextSpray}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, color: A.inkMuted, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Risk curve · by Zadoks</div>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 60 }}>
                    {w.fhbForecast.history.map((h) => {
                      const heightMap = { low: 18, mod: 50, high: 92 };
                      const colorMap = { low: A.forest, mod: A.wheat, high: A.rust };
                      return (
                        <div key={h.day} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }} title={`${h.day}: ${h.risk}`}>
                          <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "flex-end" }}>
                            <div style={{ width: "100%", height: `${heightMap[h.risk]}%`, background: colorMap[h.risk], opacity: 0.85, borderRadius: "3px 3px 0 0" }} />
                          </div>
                          <span style={{ ..._monoS, fontSize: 9, color: A.inkMuted }}>{h.day.split(" ")[0]}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </A_Card>

            <A_Card padded={false}>
              <div style={{ padding: "14px 18px 12px", borderBottom: `1px solid ${A.dividerSoft}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Icon.Thermometer size={15} stroke={A.sky} />
                  <h3 className="serif" style={{ margin: 0, fontSize: 16, color: A.forestDeep }}>Vernalization</h3>
                  <A_Pill tone="forest">Complete</A_Pill>
                </div>
                <div style={{ fontSize: 12, color: A.inkMuted, marginTop: 4 }}>Winter wheat needs cold to flower</div>
              </div>
              <div style={{ padding: "14px 18px" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span className="serif" style={{ fontSize: 28, color: A.forestDeep, fontWeight: 600, letterSpacing: "-0.02em" }}>{w.vernalizationStatus.daysAccum}</span>
                  <span style={{ fontSize: 12, color: A.inkSoft }}>/ {w.vernalizationStatus.daysNeeded} cold days</span>
                </div>
                <div style={{ marginTop: 8, height: 6, background: A.cream, borderRadius: 99, overflow: "hidden", border: `1px solid ${A.divider}` }}>
                  <div style={{ height: "100%", width: "100%", background: A.forest }} />
                </div>
                <div style={{ marginTop: 8, fontSize: 11.5, color: A.inkSoft, lineHeight: 1.5 }}>{w.vernalizationStatus.note}</div>
              </div>
            </A_Card>
          </div>

          {/* Harvest schema preview — bushels + moisture + test weight */}
          <A_Card padded={false}>
            <div style={{ padding: "14px 18px 10px", borderBottom: `1px solid ${A.dividerSoft}` }}>
              <h3 className="serif" style={{ margin: 0, fontSize: 16, color: A.forestDeep }}>Harvest schema preview · <span style={{ color: A.inkMuted, fontWeight: 400 }}>small-grain</span></h3>
              <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 2 }}>Form auto-renders these fields because the plugin declares <span style={_monoS}>schemaKind: "small-grain"</span>. No lb field — wheat is bushels.</div>
            </div>
            <div style={{ padding: "16px 18px", display: "grid", gridTemplateColumns: "repeat(3, 1fr) auto", gap: 14, alignItems: "end" }}>
              <div>
                <div style={{ fontSize: 10.5, color: A.inkMuted, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>Bushels harvested</div>
                <input placeholder="0" style={{ width: "100%", padding: "10px 12px", background: A.cream, border: `1px solid ${A.divider}`, borderRadius: 6, fontSize: 16, fontFamily: "IBM Plex Mono", outline: "none" }} />
                <div style={{ fontSize: 11, color: A.inkMuted, marginTop: 4 }}>at <span style={_monoS}>{w.harvest.testWeightTarget} lb/bu</span> standard</div>
              </div>
              <div>
                <div style={{ fontSize: 10.5, color: A.inkMuted, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>Moisture %</div>
                <input placeholder="13.5" style={{ width: "100%", padding: "10px 12px", background: A.cream, border: `1px solid ${A.divider}`, borderRadius: 6, fontSize: 16, fontFamily: "IBM Plex Mono", outline: "none" }} />
                <div style={{ fontSize: 11, color: A.wheat, marginTop: 4, fontWeight: 600 }}>Target ≤ {w.harvest.moistureTarget}% · max {w.harvest.moistureMax}%</div>
              </div>
              <div>
                <div style={{ fontSize: 10.5, color: A.inkMuted, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>Test weight (lb/bu)</div>
                <input placeholder="60" style={{ width: "100%", padding: "10px 12px", background: A.cream, border: `1px solid ${A.divider}`, borderRadius: 6, fontSize: 16, fontFamily: "IBM Plex Mono", outline: "none" }} />
                <div style={{ fontSize: 11, color: A.inkMuted, marginTop: 4 }}>Standard for HRW ≥ 60</div>
              </div>
              <button style={{ ...A_primaryBtn, padding: "10px 16px", fontSize: 14, height: 42 }}>Record</button>
            </div>
            {/* Sampled spots */}
            <div style={{ padding: "10px 18px 14px", borderTop: `1px dashed ${A.dividerSoft}`, background: A.cream }}>
              <div style={{ fontSize: 10.5, color: A.inkMuted, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Pre-harvest moisture samples · {w.harvest.readings.length}</div>
              {w.harvest.readings.map((r, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 14, padding: "5px 0", fontSize: 12.5, alignItems: "center" }}>
                  <span style={{ color: A.ink }}>{r.spot}</span>
                  <span style={{ ..._monoS, color: A.ink, fontWeight: 600 }}>{r.bu} bu</span>
                  <span style={{ ..._monoS, color: r.moisture > w.harvest.moistureTarget ? A.wheat : A.forest, fontWeight: 600 }}>{r.moisture}%</span>
                  <span style={{ ..._monoS, color: A.inkSoft }}>tw {r.testWeight}</span>
                </div>
              ))}
            </div>
          </A_Card>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ GRAPE HARVEST ═══════════════════════════ */
function AGrapeHarvestScreen() {
  const A = window.A_tokens;
  const g = MOCK.cropScenarios.grape;
  const latest = g.samples[g.samples.length - 1];
  const inTarget = (val, t) => val >= t.min && val <= t.max;
  const brixOk = inTarget(latest.brix, g.qualityTargets.brix);
  const phOk = inTarget(latest.ph, g.qualityTargets.ph);
  const taOk = inTarget(latest.ta, g.qualityTargets.ta);

  return (
    <div className="dir-a" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <A_TopBar active="harvest" />
      <div style={{ flex: 1, overflow: "auto", padding: "24px 28px 32px" }}>
        <div style={{ maxWidth: 1180, margin: "0 auto" }}>

          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 22 }}>
            <div>
              <div style={_kicS()}>{g.block.label} · {g.block.acres} ac · vine fruit · stage scale: {g.stageScale}</div>
              <h1 className="serif" style={{ margin: "6px 0 0", fontSize: 30, color: A.forestDeep, letterSpacing: "-0.02em", lineHeight: 1.05 }}>{g.block.crop} · harvest decision</h1>
              <div style={{ fontSize: 13, color: A.inkMuted, marginTop: 3 }}>{g.block.variety} · trellis: <span style={_monoS}>{g.trellisSystem}</span> · current stage <span style={_monoS}>{g.currentStage.id}</span> {g.currentStage.label}</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={A_ghostBtn}><Icon.FileText size={14} /> Send to crush schedule</button>
              <button style={A_primaryBtn}><Icon.Plus size={14} /> Record sample</button>
            </div>
          </div>

          <div style={{ padding: "10px 14px", marginBottom: 14, background: "#EFF6E9", border: `1px solid #C9DBC0`, borderLeft: `3px solid ${A.forest}`, borderRadius: 8, fontSize: 12.5, color: A.forestDeep, display: "flex", alignItems: "center", gap: 10 }}>
            <Icon.Info size={14} stroke={A.forest} />
            <span><strong>Harvest schema:</strong> grape plugin declares <span style={_monoS}>brix-ph-ta-tons</span>. Form swaps in <strong>Brix / pH / TA</strong> fields with target bands. Same harvest shell, different schema.</span>
          </div>

          {/* Pick recommendation hero */}
          <A_Card style={{ marginBottom: 14 }} padded={false}>
            <div style={{ padding: "16px 22px 14px", background: "linear-gradient(180deg, #EFE6CC 0%, #F8F3E8 100%)", borderBottom: `1px solid ${A.dividerSoft}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <A_Pill tone="forest"><Icon.Check size={10} /> In target band</A_Pill>
                <span style={{ ..._monoS, fontSize: 11, color: A.inkMuted }}>last sample {latest.date}</span>
              </div>
              <h2 className="serif" style={{ margin: 0, fontSize: 26, color: A.forestDeep, letterSpacing: "-0.015em" }}>
                Pick window: {g.pickRecommendation.date}
              </h2>
              <p style={{ margin: "8px 0 0", color: A.inkSoft, fontSize: 13.5, lineHeight: 1.55, maxWidth: 760 }}>
                {g.pickRecommendation.reasoning}
              </p>
            </div>

            {/* Three quality numbers */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1.2fr", padding: "0", borderBottom: `1px solid ${A.dividerSoft}` }}>
              {[
                ["Brix",  latest.brix,  g.qualityTargets.brix,  "°",  brixOk],
                ["pH",    latest.ph,    g.qualityTargets.ph,    "",   phOk],
                ["TA",    latest.ta,    g.qualityTargets.ta,    " g/L", taOk],
              ].map(([k, v, t, unit, ok]) => (
                <div key={k} style={{ padding: "18px 22px", borderRight: `1px solid ${A.dividerSoft}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11, color: A.inkMuted, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700 }}>{k}</span>
                    {ok ? <Icon.Check size={11} stroke={A.forest} /> : <Icon.Alert size={11} stroke={A.wheat} />}
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 6 }}>
                    <span className="serif" style={{ fontSize: 32, color: ok ? A.forestDeep : A.wheat, fontWeight: 600, lineHeight: 1, letterSpacing: "-0.02em" }}>{v}</span>
                    <span style={{ fontSize: 13, color: A.inkSoft }}>{unit}</span>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 11, color: A.inkMuted, ..._monoS }}>
                    target {t.target}{unit} · band {t.min}–{t.max}
                  </div>
                  {/* Mini scale */}
                  <div style={{ marginTop: 8, position: "relative", height: 6, background: A.cream, borderRadius: 99, border: `1px solid ${A.divider}` }}>
                    <div style={{ position: "absolute", left: `${((v - t.min) / (t.max - t.min)) * 100}%`, top: -2, width: 3, height: 10, background: ok ? A.forest : A.wheat, borderRadius: 2 }} />
                  </div>
                </div>
              ))}
              {/* Action */}
              <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 8 }}>
                <button style={{ ...A_primaryBtn, padding: "10px 14px", fontSize: 13.5, justifyContent: "center" }}>
                  <Icon.Check size={14} /> Schedule pick · Oct 8
                </button>
                <button style={{ ...A_ghostBtn, padding: "8px 12px", fontSize: 12.5, justifyContent: "center" }}>
                  <Icon.Plus size={12} /> Sample one more time
                </button>
              </div>
            </div>
          </A_Card>

          {/* Sample trend */}
          <A_Card padded={false}>
            <div style={{ padding: "14px 18px 10px", borderBottom: `1px solid ${A.dividerSoft}` }}>
              <h3 className="serif" style={{ margin: 0, fontSize: 16, color: A.forestDeep }}>Sample trend · {g.samples.length} weekly samples</h3>
              <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 2 }}>Numbers climb through veraison; pick when band-aligned + weather window clear</div>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: A.cream, color: A.inkMuted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
                  <th style={{ textAlign: "left", padding: "10px 16px" }}>Sample date</th>
                  <th style={{ textAlign: "right", padding: "10px 8px" }}>Brix °</th>
                  <th style={{ textAlign: "right", padding: "10px 8px" }}>pH</th>
                  <th style={{ textAlign: "right", padding: "10px 8px" }}>TA g/L</th>
                  <th style={{ textAlign: "left", padding: "10px 16px" }}>Note</th>
                </tr>
              </thead>
              <tbody>
                {g.samples.map((s, i) => {
                  const isLatest = i === g.samples.length - 1;
                  return (
                    <tr key={s.date} style={{ borderTop: `1px solid ${A.dividerSoft}`, background: isLatest ? "#EFF6E9" : "transparent" }}>
                      <td style={{ padding: "11px 16px", ..._monoS, color: isLatest ? A.forestDeep : A.inkSoft, fontWeight: isLatest ? 700 : 500 }}>{s.date}{isLatest && " · latest"}</td>
                      <td style={{ padding: "11px 8px", textAlign: "right", ..._monoS, color: A.ink, fontWeight: 600 }}>{s.brix}</td>
                      <td style={{ padding: "11px 8px", textAlign: "right", ..._monoS, color: A.ink, fontWeight: 600 }}>{s.ph}</td>
                      <td style={{ padding: "11px 8px", textAlign: "right", ..._monoS, color: A.ink, fontWeight: 600 }}>{s.ta}</td>
                      <td style={{ padding: "11px 16px", color: A.inkSoft, fontSize: 12 }}>{s.note}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ padding: "10px 16px", background: A.cream, borderTop: `1px solid ${A.dividerSoft}`, fontSize: 11.5, color: A.inkMuted, display: "flex", alignItems: "center", gap: 6 }}>
              <Icon.Layers size={12} /> Spray program YTD: {g.sprayProgram.sprays} sprays · FRAC groups {g.sprayProgram.frac.join(", ")} · last: {g.sprayProgram.lastSpray}
            </div>
          </A_Card>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ HAY FLOW ════════════════════════════════ */
function AHayFlowScreen() {
  const A = window.A_tokens;
  const hay = MOCK.cropScenarios.hay;
  const seq = hay.sequence;
  const dec = hay.currentDecision;

  return (
    <div className="dir-a" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <A_TopBar active="harvest" />
      <div style={{ flex: 1, overflow: "auto", padding: "24px 28px 32px" }}>
        <div style={{ maxWidth: 1180, margin: "0 auto" }}>

          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 22 }}>
            <div>
              <div style={_kicS()}>{hay.block.label} · {hay.block.acres} ac · forage</div>
              <h1 className="serif" style={{ margin: "6px 0 0", fontSize: 30, color: A.forestDeep, letterSpacing: "-0.02em", lineHeight: 1.05 }}>
                Cut #{hay.cutNumber} of {hay.cutsPlanned} · {hay.block.crop}
              </h1>
              <div style={{ fontSize: 13, color: A.inkMuted, marginTop: 3 }}>Cut 1 baled May 7 — {hay.cutsThisSeason[0].totalBales} bales at {hay.cutsThisSeason[0].moisture}% moisture · RFV {hay.cutsThisSeason[0].quality.split(" ")[1]}</div>
            </div>
          </div>

          {/* Weather GO/NO-GO hero */}
          <A_Card style={{ marginBottom: 14, borderColor: A.forest, borderLeft: `4px solid ${A.forest}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
              <div style={{ width: 56, height: 56, borderRadius: 12, background: A.forest, color: A.cream, display: "grid", placeItems: "center", flexShrink: 0 }}>
                <Icon.Sun size={28} />
              </div>
              <div style={{ flex: 1 }}>
                <div className="serif" style={{ fontSize: 32, color: A.forestDeep, letterSpacing: "-0.02em", lineHeight: 1 }}>
                  GO. Cut this afternoon.
                </div>
                <div style={{ fontSize: 13.5, color: A.inkSoft, marginTop: 5, lineHeight: 1.5, maxWidth: 720 }}>
                  {dec.reasoning}
                </div>
              </div>
              <button style={{ ...A_primaryBtn, padding: "12px 18px", fontSize: 14.5 }}>
                <Icon.Tractor size={15} /> Start cut #2
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginTop: 4 }}>
              {dec.forecast.map((d, i) => {
                const G = Icon[d.cond];
                return (
                  <div key={i} style={{
                    padding: "10px 12px", borderRadius: 8,
                    background: d.hayOk ? "#EFF6E9" : "#FBF1E5",
                    border: `1px solid ${d.hayOk ? "#C9DBC0" : "#E2B69E"}`,
                    textAlign: "center",
                  }}>
                    <div style={{ fontSize: 11, color: A.inkMuted, fontWeight: 700 }}>{d.day}</div>
                    <G size={22} stroke={d.hayOk ? A.forest : A.wheat} style={{ marginTop: 6 }} />
                    <div style={{ ..._monoS, fontSize: 13, color: A.ink, marginTop: 6, fontWeight: 600 }}>{d.high}° / {d.low}°</div>
                    <div style={{ ..._monoS, fontSize: 11, color: d.rain >= 30 ? A.rust : A.inkMuted, marginTop: 2 }}>{d.rain}% rain</div>
                    <div style={{ fontSize: 10.5, color: d.hayOk ? A.forest : A.rust, fontWeight: 700, marginTop: 4, letterSpacing: "0.05em" }}>{d.hayOk ? "HAY OK" : "NO HAY"}</div>
                  </div>
                );
              })}
            </div>
          </A_Card>

          {/* Sequence steps */}
          <A_Card padded={false}>
            <div style={{ padding: "14px 18px 10px", borderBottom: `1px solid ${A.dividerSoft}` }}>
              <h3 className="serif" style={{ margin: 0, fontSize: 16, color: A.forestDeep }}>Cut sequence — Mow → Ted → Rake → Bale</h3>
              <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 2 }}>Tap each step as you complete it. Moisture meter reading captured at every step.</div>
            </div>
            <div style={{ padding: "18px 22px", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, position: "relative" }}>
              {/* Connector line */}
              <div style={{ position: "absolute", left: "calc(22px + 12.5%)", right: "calc(22px + 12.5%)", top: 60, height: 2, background: A.divider, borderRadius: 99 }} />
              {seq.map((s, i) => {
                const G = Icon[s.icon];
                const isReady = s.status === "ready";
                return (
                  <div key={s.id} style={{ textAlign: "center", position: "relative", zIndex: 1 }}>
                    <div style={{
                      width: 48, height: 48, borderRadius: 12,
                      background: isReady ? A.forest : (s.status === "done" ? A.forest : A.paper),
                      color: (isReady || s.status === "done") ? A.cream : A.inkMuted,
                      border: `2px solid ${isReady ? A.forest : A.divider}`,
                      margin: "0 auto", display: "grid", placeItems: "center",
                    }}>
                      <G size={20} />
                    </div>
                    <div className="serif" style={{ fontSize: 16, color: isReady ? A.forestDeep : A.ink, marginTop: 10, fontWeight: 600 }}>
                      {s.label} {i + 1 < 4 && <span style={{ color: A.inkMuted, fontWeight: 400 }}>→</span>}
                    </div>
                    <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 4, padding: "0 14px", lineHeight: 1.4 }}>{s.note}</div>
                    {isReady && (
                      <button style={{ ...A_primaryBtn, marginTop: 10, padding: "7px 14px", fontSize: 12.5 }}>
                        Mark complete + log moisture
                      </button>
                    )}
                    {s.status === "pending" && (
                      <div style={{ marginTop: 10, fontSize: 11, color: A.inkMuted, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                        Pending
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </A_Card>

          {/* This year's cuts */}
          <A_Card padded={false} style={{ marginTop: 14 }}>
            <div style={{ padding: "14px 18px 10px", borderBottom: `1px solid ${A.dividerSoft}` }}>
              <h3 className="serif" style={{ margin: 0, fontSize: 16, color: A.forestDeep }}>Season cuts · {hay.cutsThisSeason.length} of {hay.cutsPlanned}</h3>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: A.cream, color: A.inkMuted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
                  <th style={{ textAlign: "left", padding: "9px 16px" }}>Cut</th>
                  <th style={{ textAlign: "left", padding: "9px 8px" }}>Mowed</th>
                  <th style={{ textAlign: "left", padding: "9px 8px" }}>Baled</th>
                  <th style={{ textAlign: "right", padding: "9px 8px" }}>Bales</th>
                  <th style={{ textAlign: "right", padding: "9px 8px" }}>Moisture</th>
                  <th style={{ textAlign: "left", padding: "9px 16px" }}>Quality</th>
                </tr>
              </thead>
              <tbody>
                {hay.cutsThisSeason.map((c) => (
                  <tr key={c.num} style={{ borderTop: `1px solid ${A.dividerSoft}`, background: c.current ? "#FBF5E6" : "transparent" }}>
                    <td style={{ padding: "11px 16px", color: A.ink, fontWeight: 600 }}>#{c.num} {c.current && <A_Pill tone="wheat">In progress</A_Pill>}</td>
                    <td style={{ padding: "11px 8px", ..._monoS, color: A.inkSoft }}>{c.mowedOn || "—"}</td>
                    <td style={{ padding: "11px 8px", ..._monoS, color: A.inkSoft }}>{c.baledOn || "—"}</td>
                    <td style={{ padding: "11px 8px", textAlign: "right", ..._monoS, color: A.ink, fontWeight: 600 }}>{c.totalBales ?? "—"}</td>
                    <td style={{ padding: "11px 8px", textAlign: "right", ..._monoS, color: A.ink }}>{c.moisture ? `${c.moisture}%` : "—"}</td>
                    <td style={{ padding: "11px 16px", color: A.inkSoft }}>{c.quality || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </A_Card>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ TREE-FRUIT MULTI-PICK ═══════════════════ */
function ATreeFruitHarvestScreen() {
  const A = window.A_tokens;
  const tf = MOCK.cropScenarios.treeFruit;
  const cumulative = tf.picks.reduce((sum, p) => sum + p.qtyLb, 0);
  const completedCumulative = tf.picks.filter((p) => p.num <= tf.lastPick.num).reduce((sum, p) => sum + p.qtyLb, 0);

  return (
    <div className="dir-a" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <A_TopBar active="harvest" />
      <div style={{ flex: 1, overflow: "auto", padding: "24px 28px 32px" }}>
        <div style={{ maxWidth: 1180, margin: "0 auto" }}>

          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 22 }}>
            <div>
              <div style={_kicS()}>{tf.block.label} · {tf.block.acres} ac · tree fruit · planted {tf.block.planted}</div>
              <h1 className="serif" style={{ margin: "6px 0 0", fontSize: 30, color: A.forestDeep, letterSpacing: "-0.02em", lineHeight: 1.05 }}>
                {tf.block.crop} · multi-pick season
              </h1>
              <div style={{ fontSize: 13, color: A.inkMuted, marginTop: 3 }}>{tf.block.variety} · bloom {tf.bloomDate} · expected total ~{tf.expectedYieldLb} lb</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={A_ghostBtn}><Icon.FileText size={14} /> Export pick log</button>
              <button style={A_primaryBtn}><Icon.Plus size={14} /> Start Pick #{tf.lastPick.num + 1}</button>
            </div>
          </div>

          <div style={{ padding: "10px 14px", marginBottom: 14, background: "#EFF6E9", border: `1px solid #C9DBC0`, borderLeft: `3px solid ${A.forest}`, borderRadius: 8, fontSize: 12.5, color: A.forestDeep, display: "flex", alignItems: "center", gap: 10 }}>
            <Icon.Info size={14} stroke={A.forest} />
            <span><strong>Multi-pick model:</strong> tree fruit declares <span style={_monoS}>schemaKind: "picks[]"</span>. Each pick is its own event with quantity + grade + reasoning. Plan timeline shows them as sub-bars; records page exports per-pick rows.</span>
          </div>

          {/* Progress hero */}
          <A_Card style={{ marginBottom: 14 }} padded={false}>
            <div style={{ padding: "18px 22px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", borderBottom: `1px solid ${A.dividerSoft}`, gap: 0 }}>
              <div>
                <div style={{ fontSize: 11, color: A.inkMuted, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Picks complete</div>
                <div className="serif" style={{ fontSize: 32, color: A.forestDeep, lineHeight: 1, marginTop: 4, fontWeight: 600 }}>{tf.lastPick.num} <span style={{ color: A.inkMuted, fontSize: 18 }}>/ {tf.picks.length}</span></div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: A.inkMuted, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Harvested so far</div>
                <div className="serif" style={{ fontSize: 32, color: A.forestDeep, lineHeight: 1, marginTop: 4, fontWeight: 600 }}>{completedCumulative} <span style={{ color: A.inkMuted, fontSize: 16 }}>lb</span></div>
                <div style={{ fontSize: 11, color: A.inkMuted, marginTop: 3 }}>{Math.round((completedCumulative / cumulative) * 100)}% of forecast</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: A.inkMuted, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Remaining forecast</div>
                <div className="serif" style={{ fontSize: 32, color: A.wheat, lineHeight: 1, marginTop: 4, fontWeight: 600 }}>{cumulative - completedCumulative} <span style={{ color: A.inkMuted, fontSize: 16 }}>lb</span></div>
                <div style={{ fontSize: 11, color: A.inkMuted, marginTop: 3 }}>across {tf.picks.length - tf.lastPick.num} picks</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: A.inkMuted, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Today</div>
                <div className="serif" style={{ fontSize: 32, color: A.ink, lineHeight: 1, marginTop: 4, fontWeight: 600 }}>{tf.currentDate}</div>
                <div style={{ fontSize: 11, color: A.inkMuted, marginTop: 3 }}>Next pick: Oct 22 (tail)</div>
              </div>
            </div>

            {/* Pick timeline */}
            <div style={{ padding: "20px 22px 22px" }}>
              <div style={{ fontSize: 10.5, color: A.inkMuted, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>Pick timeline · Sep → Nov</div>
              <div style={{ position: "relative", height: 64, background: A.cream, border: `1px solid ${A.dividerSoft}`, borderRadius: 6 }}>
                {/* axis */}
                {["Sep 1", "Sep 15", "Oct 1", "Oct 15", "Nov 1", "Nov 15"].map((d, i) => (
                  <span key={d} style={{ position: "absolute", left: `${(i / 5) * 100}%`, top: 4, ..._monoS, fontSize: 10, color: A.inkMuted, transform: "translateX(-4px)" }}>{d}</span>
                ))}
                {/* today */}
                <div style={{ position: "absolute", left: "62%", top: 20, bottom: 0, borderLeft: `2px solid ${A.rust}` }} />
                <span style={{ position: "absolute", left: "62%", top: 20, transform: "translateX(-50%)", background: A.rust, color: A.cream, fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3 }}>OCT 18</span>
                {/* pick dots */}
                {tf.picks.map((p) => {
                  // Map dates to %: Sep 1 = 0%, Nov 15 = 100% (75 day range)
                  const dayMap = { "Sep 8": 9, "Sep 28": 36, "Oct 10": 52, "Oct 22": 68, "Nov 1": 81 };
                  const left = dayMap[p.date];
                  const isDone = p.num <= tf.lastPick.num;
                  return (
                    <div key={p.num} title={`Pick #${p.num} · ${p.date} · ${p.qtyLb} lb · ${p.grade}`} style={{
                      position: "absolute", left: `${left}%`, top: 42, transform: "translateX(-50%)",
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                    }}>
                      <div style={{
                        width: 16, height: 16, borderRadius: 99,
                        background: isDone ? A.forest : A.paper,
                        border: `2px solid ${isDone ? A.forest : A.wheat}`,
                        color: A.cream, display: "grid", placeItems: "center", fontSize: 9, fontWeight: 800,
                      }}>{isDone ? "✓" : p.num}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </A_Card>

          {/* Picks table */}
          <A_Card padded={false}>
            <div style={{ padding: "14px 18px 10px", borderBottom: `1px solid ${A.dividerSoft}` }}>
              <h3 className="serif" style={{ margin: 0, fontSize: 16, color: A.forestDeep }}>All {tf.picks.length} picks · planned + completed</h3>
              <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 2 }}>Each row is its own event in Records · grade splits and reasoning capture the harvest philosophy</div>
            </div>
            {tf.picks.map((p, i) => {
              const isDone = p.num <= tf.lastPick.num;
              const isNext = p.num === tf.lastPick.num + 1;
              return (
                <div key={p.num} style={{
                  display: "grid", gridTemplateColumns: "60px 100px 1fr 110px 130px auto", gap: 14,
                  padding: "13px 18px", borderTop: i === 0 ? "none" : `1px solid ${A.dividerSoft}`,
                  background: isNext ? "#FBF5E6" : (isDone ? "transparent" : A.cream),
                  alignItems: "center",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                      width: 24, height: 24, borderRadius: 99,
                      background: isDone ? A.forest : (isNext ? A.wheat : A.dividerSoft),
                      color: (isDone || isNext) ? A.cream : A.inkSoft,
                      display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700,
                    }}>{isDone ? "✓" : p.num}</span>
                  </div>
                  <div style={{ ..._monoS, fontSize: 12.5, color: isDone ? A.inkSoft : (isNext ? A.wheat : A.inkMuted), fontWeight: 600 }}>{p.date}</div>
                  <div>
                    <div style={{ fontSize: 13.5, color: A.ink, fontWeight: 600 }}>Pick #{p.num} — {p.type}</div>
                    <div style={{ fontSize: 12, color: A.inkMuted, marginTop: 3, lineHeight: 1.45 }}>{p.reasoning}</div>
                  </div>
                  <div style={{ ..._monoS, textAlign: "right", fontSize: 15, color: A.ink, fontWeight: 700 }}>{p.qtyLb} <span style={{ fontSize: 11, color: A.inkMuted, fontWeight: 500 }}>lb</span></div>
                  <div><A_Pill tone={p.grade.includes("Cider") ? "rust" : (p.grade.includes("Fancy") ? "forest" : "neutral")}>{p.grade}</A_Pill></div>
                  <div>
                    {isDone && <A_Pill tone="neutral"><Icon.Lock size={9} /> Recorded</A_Pill>}
                    {isNext && <button style={{ ...A_primaryBtn, padding: "6px 11px", fontSize: 12 }}><Icon.Plus size={11} /> Record</button>}
                    {!isDone && !isNext && <span style={{ ..._monoS, fontSize: 11, color: A.inkMuted }}>planned</span>}
                  </div>
                </div>
              );
            })}
            <div style={{ padding: "12px 18px", borderTop: `1px solid ${A.divider}`, background: A.cream, display: "grid", gridTemplateColumns: "60px 100px 1fr 110px 130px auto", gap: 14, alignItems: "center" }}>
              <div />
              <div style={{ ..._monoS, fontSize: 11.5, color: A.inkMuted, fontWeight: 700 }}>SEASON TOTAL</div>
              <div style={{ fontSize: 12.5, color: A.inkSoft }}>{tf.picks.length} picks · drop / storage / peak / tail / cider split</div>
              <div style={{ ..._monoS, textAlign: "right", fontSize: 17, color: A.forestDeep, fontWeight: 700 }}>{cumulative} <span style={{ fontSize: 11, color: A.inkMuted, fontWeight: 500 }}>lb</span></div>
              <div style={{ ..._monoS, fontSize: 11, color: A.inkMuted }}>forecast {tf.expectedYieldLb} lb</div>
              <div />
            </div>
          </A_Card>
        </div>
      </div>
    </div>
  );
}

window.A_WheatPlanScreen = AWheatPlanScreen;
window.A_GrapeHarvestScreen = AGrapeHarvestScreen;
window.A_HayFlowScreen = AHayFlowScreen;
window.A_TreeFruitHarvestScreen = ATreeFruitHarvestScreen;
