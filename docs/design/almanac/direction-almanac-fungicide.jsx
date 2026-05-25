/* Direction A — Almanac · Fungicide variant of the Spray flow.
   Same shell + IPM gate replaced with:
     • Disease pressure gate (leaf-wet hrs, model output)
     • Rain/dew gate (post-application persistence)
     • FRAC resistance rotation check
*/

function AFungicideScreen() {
  const A = window.A_tokens;
  const m = MOCK;
  const sp = m.fungicidePlan;
  const targetBlocks = sp.blocks.map((b) => ({ ...b, full: m.blocks.find((x) => x.id === b.id) }));
  const primaryBlock = targetBlocks[0].full;
  const sprayer = m.sprayers.find((s) => s.id === sp.sprayer);
  const primaryTargets = sp.targets.filter((t) => t.primary);
  const otherTargets = sp.targets.filter((t) => !t.primary);

  return (
    <div className="dir-a" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <A_TopBar active="spray" />

      <div style={{ flex: 1, overflow: "auto", padding: "24px 28px 32px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>

          {/* Type ribbon */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <A_Pill tone="sky">Fungicide</A_Pill>
            <span style={{ fontSize: 12.5, color: A.inkMuted }}>same shell · disease forecast + rain/dew + FRAC rotation gates</span>
          </div>

          {/* Stepper with extra Disease gate step */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 22 }}>
            {[
              ["Block & crop", true],
              ["Sprayer & tank", true],
              ["Mix", true],
              ["Pre-check", true],
              ["Disease + FRAC", false, true],
              ["Confirm & record", false],
            ].map(([label, done, current], i, arr) => (
              <React.Fragment key={label}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: 99,
                    background: done ? A.forest : (current ? A.sky : A.paper),
                    border: `1px solid ${done ? A.forest : (current ? A.sky : A.divider)}`,
                    color: (done || current) ? A.cream : A.inkMuted,
                    display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700,
                  }}>{done ? "✓" : i + 1}</div>
                  <span style={{ fontSize: 13, color: (done || current) ? A.ink : A.inkMuted, fontWeight: current ? 700 : 500 }}>{label}</span>
                  {label === "Disease + FRAC" && <span title="Fungicide-only step. Verifies a disease model triggered AND that FRAC rotation respects last spray." style={{ color: A.inkMuted, marginLeft: -3 }}><Icon.Info size={12} /></span>}
                </div>
                {i < arr.length - 1 && <div style={{ flex: 1, height: 1, background: A.divider }} />}
              </React.Fragment>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 18 }}>

            {/* LEFT */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

              {/* Context strip */}
              <A_Card padded={false}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1.4fr", borderBottom: `1px solid ${A.dividerSoft}` }}>
                  <div style={{ padding: "16px 18px", borderRight: `1px solid ${A.dividerSoft}` }}>
                    <div style={kicLabel(A)}><Icon.Field size={12} /> Block</div>
                    <div style={{ fontSize: 14, color: A.ink, marginTop: 4 }}>{primaryBlock.label} · <span className="mono">{sp.area} ac</span></div>
                  </div>
                  <div style={{ padding: "16px 18px", borderRight: `1px solid ${A.dividerSoft}` }}>
                    <div style={kicLabel(A)}><Icon.Sprout size={12} /> Crop</div>
                    <div style={{ fontSize: 14, color: A.ink, marginTop: 4 }}>{sp.crop}</div>
                    <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 2 }}>scab-susceptible</div>
                  </div>
                  <div style={{ padding: "16px 18px", borderRight: `1px solid ${A.dividerSoft}` }}>
                    <div style={kicLabel(A)}><Icon.Layers size={12} /> Stage</div>
                    <div style={{ fontSize: 14, color: A.ink, marginTop: 4 }}>{sp.stage}</div>
                    <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 2 }}>primary scab window</div>
                  </div>
                  <div style={{ padding: "16px 18px" }}>
                    <div style={kicLabel(A)}><Icon.Compass size={12} /> Diseases · {sp.targets.length} monitored</div>
                    <div style={{ marginTop: 5, display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {primaryTargets.map((p) => (
                        <span key={p.name} title={`${p.name} — ${p.count} (action ${p.threshold})`} style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          padding: "1px 7px",
                          background: p.pressure === "above" ? "#DEE7EF" : A.dividerSoft,
                          border: `1px solid ${p.pressure === "above" ? "#BDCDD9" : A.divider}`,
                          borderRadius: 99, fontSize: 11,
                          color: p.pressure === "above" ? "#3A586E" : A.inkSoft, fontWeight: 600,
                        }}>
                          {p.pressure === "above" && <Icon.Alert size={10} />}
                          {p.name.split(" ").slice(0, 2).join(" ")}
                        </span>
                      ))}
                      <button title={otherTargets.map((t) => `${t.name} — ${t.count}`).join(" • ")} style={{
                        padding: "1px 7px", background: A.paper, border: `1px dashed ${A.divider}`,
                        borderRadius: 99, fontSize: 11, color: A.inkSoft, fontWeight: 500, cursor: "pointer",
                      }}>+ {otherTargets.length} sub-threshold</button>
                    </div>
                  </div>
                </div>
                <div style={{ padding: "10px 18px", display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: A.forestDeep, background: "#EFF6E9" }}>
                  <Icon.CheckCircle size={15} stroke={A.forest} />
                  <span><strong>{sp.blockCompatibility.label}.</strong> <span title={sp.blockCompatibility.reason} style={{ color: A.inkSoft, cursor: "help", textDecoration: "underline dotted" }}>Why is this allowed?</span></span>
                </div>
              </A_Card>

              {/* Tank mix */}
              <A_Card>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div>
                    <h3 className="serif" style={{ margin: 0, fontSize: 18, color: A.forestDeep }}>Tank mix</h3>
                    <div style={{ fontSize: 12.5, color: A.inkMuted, marginTop: 2 }}>{sprayer.label} · {sp.tankSize} gal · calibrated {sp.gpa} GPA (TRV)</div>
                  </div>
                  <button style={{ ...A_ghostBtn, padding: "7px 12px", fontSize: 13 }}><Icon.Plus size={14} /> Add product</button>
                </div>
                <div style={{ background: A.cream, borderRadius: 8, border: `1px solid ${A.dividerSoft}`, overflow: "hidden" }}>
                  {sp.products.map((p, i) => (
                    <div key={p.id} style={{ padding: "14px 16px", borderTop: i === 0 ? "none" : `1px solid ${A.dividerSoft}` }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 14, alignItems: "center" }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ width: 12, height: 12, borderRadius: 3, background: p.color, flexShrink: 0 }} />
                            <span style={{ fontSize: 14.5, color: A.ink, fontWeight: 600 }}>{p.name}</span>
                            <A_Pill tone="forest">OK</A_Pill>
                          </div>
                          <div style={{ fontSize: 12.5, color: A.inkMuted, marginTop: 3 }}>{p.group} · <span className="mono">{p.restrictions}</span></div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div className="mono" style={{ fontSize: 13.5, color: A.ink }}>{p.rate}</div>
                          <div className="mono" style={{ fontSize: 11.5, color: A.inkMuted }}>{p.total} total · {sp.tanks.length} tanks</div>
                        </div>
                        <button style={{ ...A_iconBtn, width: 30, height: 30 }} title="Remove"><Icon.X size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 22, paddingTop: 14, borderTop: `1px dashed ${A.divider}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: A.sky, letterSpacing: "0.12em", textTransform: "uppercase" }}>+ Carrier</span>
                    <span style={{ fontSize: 11.5, color: A.inkMuted }}>{sp.waterTotal} across {sp.tanks.length} tanks</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "#E4ECF1", borderRadius: 6, border: `1px solid #B9CBD7` }}>
                    <div style={{ width: 30, height: 30, borderRadius: 6, background: "#FFFFFF", display: "grid", placeItems: "center", color: A.sky, border: `1px solid #B9CBD7`, flexShrink: 0 }}>
                      <Icon.Droplet size={15} />
                    </div>
                    <div style={{ flex: 1, fontSize: 13.5, color: A.ink, fontWeight: 600 }}>Water · clean well · 7.0 pH</div>
                  </div>
                </div>
              </A_Card>

              {/* Disease forecast gate */}
              <A_Card padded={false}>
                <div style={{ padding: "16px 20px 14px", borderBottom: `1px solid ${A.dividerSoft}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                    <Icon.CloudRain size={16} stroke={A.sky} />
                    <h3 className="serif" style={{ margin: 0, fontSize: 17, color: A.forestDeep }}>Disease forecast gate</h3>
                    <A_Pill tone="sky">Triggered</A_Pill>
                    <span style={{ marginLeft: "auto", fontSize: 11, color: A.inkMuted, fontFamily: "IBM Plex Mono" }}>{sp.diseaseGate.model}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: A.inkSoft, lineHeight: 1.5 }}>{sp.diseaseGate.note}</div>
                </div>
                <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 20, alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 10.5, color: A.inkMuted, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Leaf-wet hours</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 6 }}>
                      <span className="serif" style={{ fontSize: 42, color: A.sky, letterSpacing: "-0.02em", fontWeight: 600, lineHeight: 1 }}>{sp.diseaseGate.leafWetHours}</span>
                      <span style={{ fontSize: 13, color: A.inkSoft }}>hrs · last 48h</span>
                    </div>
                    <div style={{ fontSize: 12, color: A.inkMuted, marginTop: 4 }}>Threshold <span className="mono" style={{ color: A.ink, fontWeight: 600 }}>≥{sp.diseaseGate.leafWetThreshold} hrs</span> · avg <span className="mono">{sp.diseaseGate.avgTempF}°F</span></div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10.5, color: A.inkMuted, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>5-day infection windows</div>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 70 }}>
                      {sp.diseaseGate.history.map((h) => {
                        const max = Math.max(...sp.diseaseGate.history.map((x) => x.wetHrs)) || 1;
                        const heightPct = h.wetHrs === 0 ? 6 : Math.max(8, (h.wetHrs / max) * 100);
                        return (
                          <div key={h.day} title={`${h.day}: ${h.wetHrs} hrs · ${h.infect ? "INFECTION" : "no infection"}`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                            <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "flex-end" }}>
                              <div style={{ width: "100%", height: `${heightPct}%`, background: h.infect ? A.sky : A.dividerSoft, opacity: h.infect ? 1 : 0.7, borderRadius: "3px 3px 0 0" }} />
                            </div>
                            <span className="mono" style={{ fontSize: 10, color: h.infect ? A.sky : A.inkMuted, fontWeight: 700 }}>{h.wetHrs}h</span>
                            <span style={{ fontSize: 9.5, color: A.inkMuted, fontFamily: "IBM Plex Mono" }}>{h.day.split(" ")[1]}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </A_Card>

              {/* Rain/dew + FRAC rotation + standard checks (combined) */}
              <A_Card padded={false}>
                <div style={{ padding: "16px 20px 12px", borderBottom: `1px solid ${A.dividerSoft}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Icon.Droplet size={15} stroke={A.sky} />
                        <span className="serif" style={{ fontSize: 15.5, color: A.forestDeep }}>Rain/dew gate</span>
                        <A_Pill tone="forest"><Icon.Check size={10} /> Dry window OK</A_Pill>
                      </div>
                      <div style={{ fontSize: 12, color: A.inkSoft, marginTop: 4, lineHeight: 1.45 }}>{sp.rainDewGate.note}</div>
                    </div>
                    <div style={{ flex: 1, paddingLeft: 16, borderLeft: `1px solid ${A.dividerSoft}` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Icon.Layers size={15} stroke={A.forest} />
                        <span className="serif" style={{ fontSize: 15.5, color: A.forestDeep }}>FRAC rotation</span>
                        <A_Pill tone="forest"><Icon.Check size={10} /> Group cleared</A_Pill>
                      </div>
                      <div style={{ fontSize: 12, color: A.inkSoft, marginTop: 4, lineHeight: 1.45 }}>{sp.resistanceGate.note}</div>
                      <div style={{ fontSize: 11, color: A.inkMuted, marginTop: 4, fontFamily: "IBM Plex Mono" }}>last: {sp.resistanceGate.lastFRAC} → next: {sp.resistanceGate.thisFRAC}</div>
                    </div>
                  </div>
                </div>
                <div style={{ padding: "12px 20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {sp.checks.map((c) => (
                    <div key={c.id} style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                      background: c.ok ? "#EFF6E9" : "#FBE4D2",
                      border: `1px solid ${c.ok ? "#C9DBC0" : "#E2B69E"}`, borderRadius: 6,
                    }}>
                      <div style={{ color: c.ok ? A.forest : A.rust }}>
                        {c.ok ? <Icon.CheckCircle size={16} /> : <Icon.Alert size={16} />}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12.5, color: A.ink, fontWeight: 500 }}>{c.label}</div>
                        <div className="mono" style={{ fontSize: 11, color: A.inkMuted, marginTop: 2 }}>{c.value} · {c.threshold}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </A_Card>
            </div>

            {/* RIGHT */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <A_Card style={{ position: "sticky", top: 24 }} padded={false}>
                <div style={{ padding: "18px 20px 16px", borderBottom: `1px solid ${A.dividerSoft}` }}>
                  <A_Kicker>Ready to record</A_Kicker>
                  <h3 className="serif" style={{ margin: "8px 0 0", fontSize: 22, color: A.forestDeep, letterSpacing: "-0.01em" }}>
                    {sp.tanks.length} tanks · 2 products
                  </h3>
                  <div style={{ fontSize: 13, color: A.inkSoft, marginTop: 4 }}>
                    on {primaryBlock.label} — <span className="mono">{sp.area} ac</span> at <span className="mono">{sp.gpa} GPA</span>
                  </div>
                </div>
                <div style={{ padding: "16px 16px 14px", background: "#FBF5E6", borderBottom: `1px solid ${A.dividerSoft}` }}>
                  <div style={{ display: "flex", justifyContent: "center", gap: 4, alignItems: "flex-end" }}>
                    {sp.tanks.map((t) => {
                      const fillPct = t.fill / sp.tankSize;
                      const tankH = 90, tankW = 32;
                      const fillH = Math.max(6, fillPct * (tankH - 12));
                      const fillY = tankH - 4 - fillH;
                      return (
                        <div key={t.idx} style={{ width: tankW + 8, textAlign: "center" }}>
                          <div style={{ fontSize: 9, fontWeight: 700, color: A.inkMuted, letterSpacing: "0.05em" }}>T{t.idx}</div>
                          <svg viewBox={`0 0 ${tankW + 8} ${tankH + 2}`} width={tankW + 8} height={tankH + 2}>
                            <rect x="4" y="6" width={tankW} height={tankH - 8} rx="5" fill={A.paper} stroke={A.divider} strokeWidth="1.2" />
                            <rect x="9" y="0" width={tankW - 10} height="7" rx="1.5" fill={A.paper} stroke={A.divider} strokeWidth="1.2" />
                            <clipPath id={`fclip-${t.idx}`}>
                              <rect x="4" y="6" width={tankW} height={tankH - 8} rx="5" />
                            </clipPath>
                            <g clipPath={`url(#fclip-${t.idx})`}>
                              <rect x="4" y={fillY} width={tankW} height={fillH * 0.94} fill={sp.waterColor} opacity="0.85" />
                              <rect x="4" y={fillY + fillH * 0.94} width={tankW} height={fillH * 0.04} fill={sp.products[1].color} />
                              <rect x="4" y={fillY + fillH * 0.98} width={tankW} height={fillH * 0.02} fill={sp.products[0].color} />
                            </g>
                          </svg>
                          <div className="mono" style={{ fontSize: 9.5, color: A.ink, fontWeight: 700, marginTop: 2 }}>{t.fill}g</div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 10, fontSize: 11.5, color: A.inkSoft, textAlign: "center" }}>
                    <span className="mono">{sp.totalGal} gal total</span> · orchard TRV airblast
                  </div>
                </div>
                <div style={{ padding: "12px 18px" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ color: A.inkMuted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>
                        <th style={{ textAlign: "left", padding: "4px 0" }}>Ingredient</th>
                        <th style={{ textAlign: "right", padding: "4px 0" }}>Per full</th>
                        <th style={{ textAlign: "right", padding: "4px 0" }}>T5</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sp.products.map((p) => (
                        <tr key={p.id} style={{ borderTop: `1px dashed ${A.dividerSoft}` }}>
                          <td style={{ padding: "7px 0", color: A.ink }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <span style={{ width: 9, height: 9, borderRadius: 2, background: p.color }} />
                              <span style={{ fontWeight: 500 }}>{p.name.split(" ").slice(0, 2).join(" ")}</span>
                            </span>
                          </td>
                          <td className="mono" style={{ padding: "7px 0", textAlign: "right", color: A.ink }}>{p.perTank[0]}</td>
                          <td className="mono" style={{ padding: "7px 0", textAlign: "right", color: A.inkSoft }}>{p.perTank[4]}</td>
                        </tr>
                      ))}
                      <tr style={{ borderTop: `1px dashed ${A.dividerSoft}` }}>
                        <td style={{ padding: "7px 0", color: A.ink }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <span style={{ width: 9, height: 9, borderRadius: 2, background: sp.waterColor }} />
                            <span style={{ fontWeight: 500 }}>Water</span>
                          </span>
                        </td>
                        <td className="mono" style={{ padding: "7px 0", textAlign: "right", color: A.ink }}>{sp.waterPerTank[0]}</td>
                        <td className="mono" style={{ padding: "7px 0", textAlign: "right", color: A.inkSoft }}>{sp.waterPerTank[4]}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div style={{ padding: "0 18px 18px" }}>
                  <button style={{
                    width: "100%", padding: "14px",
                    background: A.forest, color: A.cream,
                    border: "none", borderRadius: 6, fontSize: 15, fontWeight: 600,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  }}>
                    <Icon.Check size={16} /> Confirm & record all 5 tanks
                  </button>
                  <button style={{ ...A_ghostBtn, width: "100%", marginTop: 8, justifyContent: "center" }}>
                    Save as draft
                  </button>
                  <div style={{ marginTop: 12, padding: "10px 12px", background: A.cream, border: `1px solid ${A.dividerSoft}`, borderRadius: 6, fontSize: 11.5, color: A.inkMuted, display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <Icon.Lock size={13} style={{ marginTop: 2, flexShrink: 0 }} />
                    <span>Fungicide records carry a 96-h REI for captan. FRAC group logged for resistance tracking.</span>
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

window.A_FungicideScreen = AFungicideScreen;
