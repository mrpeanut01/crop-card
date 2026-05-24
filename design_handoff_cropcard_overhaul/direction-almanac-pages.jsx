/* Direction A — Almanac · Harvest + Stock + Records + Login + Settings
   All five reuse the Almanac chrome (A_TopBar, A_Card, A_Pill, A_Kicker,
   A_primaryBtn, A_ghostBtn, A_iconBtn). Kept in one file to share the
   small helpers below. */

const _kic = () => ({ fontSize: 11, fontWeight: 600, color: "#7A7F75", letterSpacing: "0.12em", textTransform: "uppercase" });
const _mono = { fontFamily: "IBM Plex Mono, ui-monospace, monospace" };

/* ═══════════════════ HARVEST ═══════════════════════════════════ */
function AHarvestScreen() {
  const A = window.A_tokens;
  const h = MOCK.harvestData;

  return (
    <div className="dir-a" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <A_TopBar active="harvest" />
      <div style={{ flex: 1, overflow: "auto", padding: "26px 28px 32px" }}>
        <div style={{ maxWidth: 1180, margin: "0 auto" }}>

          {/* Header */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 22 }}>
            <div>
              <div style={_kic()}>Harvest · 2026 season</div>
              <h1 className="serif" style={{ margin: "6px 0 0", fontSize: 34, color: A.forestDeep, letterSpacing: "-0.02em", lineHeight: 1.05 }}>Harvest.</h1>
              <div style={{ marginTop: 6, color: A.inkSoft, fontSize: 14 }}>
                <strong>{h.readyNow.length} ready today.</strong> <span style={{ color: A.inkMuted }}>·</span> {h.upcoming.length} upcoming windows. <span style={{ color: A.inkMuted }}>·</span> {h.ytd.totalLbs} lb logged YTD.
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={A_ghostBtn}><Icon.FileText size={14} /> Export YTD</button>
              <button style={A_primaryBtn}><Icon.Plus size={14} /> Record harvest</button>
            </div>
          </div>

          {/* Ready-now hero cards */}
          {h.readyNow.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <A_Kicker>Ready to harvest · {h.readyNow.length}</A_Kicker>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 10 }}>
                {h.readyNow.map((r) => (
                  <A_Card key={r.id} padded={false} style={{ borderColor: r.urgency === "today" ? A.forest : A.divider, borderLeft: `4px solid ${r.urgency === "today" ? A.forest : A.wheat}` }}>
                    <div style={{ padding: "16px 18px 12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <A_Pill tone={r.urgency === "today" ? "forest" : "wheat"}>{r.urgency === "today" ? "Today" : r.urgency}</A_Pill>
                        {r.phiClear && <A_Pill tone="forest"><Icon.Check size={10} /> PHI clear</A_Pill>}
                        <span style={{ marginLeft: "auto", fontSize: 11, color: A.inkMuted }}>{r.daysSincePlanting} d since planting</span>
                      </div>
                      <h3 className="serif" style={{ margin: 0, fontSize: 19, color: A.ink, letterSpacing: "-0.01em" }}>{r.crop}</h3>
                      <div style={{ fontSize: 12.5, color: A.inkMuted, marginTop: 3 }}>{r.block} · <span style={_mono}>{r.mode}</span></div>
                      <p style={{ margin: "10px 0 0", color: A.inkSoft, fontSize: 13, lineHeight: 1.5 }}>{r.note}</p>
                    </div>
                    <div style={{ padding: "12px 18px", background: "#F4ECD8", display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: 10.5, color: A.inkMuted, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700 }}>Expected yield</div>
                        <div style={{ fontSize: 14, color: A.ink, marginTop: 2, fontWeight: 600 }}>{r.expectedYield}</div>
                      </div>
                      <button style={{ ...A_primaryBtn, padding: "9px 14px", fontSize: 13.5 }}>Start picking <Icon.ArrowRight size={13} /></button>
                    </div>
                  </A_Card>
                ))}
              </div>
            </div>
          )}

          {/* Upcoming + Log split */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 16 }}>
            <A_Card padded={false}>
              <div style={{ padding: "14px 18px 10px", borderBottom: `1px solid ${A.dividerSoft}` }}>
                <h3 className="serif" style={{ margin: 0, fontSize: 16, color: A.forestDeep }}>Upcoming windows · {h.upcoming.length}</h3>
                <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 2 }}>Future windows from your season plan</div>
              </div>
              {h.upcoming.map((u, i) => (
                <div key={u.id} style={{ padding: "12px 18px", borderTop: i === 0 ? "none" : `1px solid ${A.dividerSoft}`, display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 13.5, color: A.ink, fontWeight: 600 }}>{u.crop}</div>
                    <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 2 }}>{u.block} · <span style={_mono}>{u.mode}</span></div>
                    <div style={{ ..._mono, fontSize: 11.5, color: A.inkSoft, marginTop: 3 }}>{u.window}</div>
                  </div>
                  <A_Pill tone="neutral">{u.est}</A_Pill>
                </div>
              ))}
            </A_Card>

            <A_Card padded={false}>
              <div style={{ padding: "14px 18px 10px", borderBottom: `1px solid ${A.dividerSoft}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <h3 className="serif" style={{ margin: 0, fontSize: 16, color: A.forestDeep }}>Recent log</h3>
                  <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 2 }}>Last 4 events · all locked</div>
                </div>
                <button style={{ ...A_ghostBtn, padding: "5px 10px", fontSize: 12 }}><Icon.Filter size={11} /> All events</button>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: A.cream, color: A.inkMuted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
                    <th style={{ textAlign: "left", padding: "8px 14px" }}>When</th>
                    <th style={{ textAlign: "left", padding: "8px 6px" }}>Crop · block</th>
                    <th style={{ textAlign: "right", padding: "8px 6px" }}>Qty</th>
                    <th style={{ textAlign: "left", padding: "8px 14px" }}>By</th>
                  </tr>
                </thead>
                <tbody>
                  {h.recentLog.map((row, i) => (
                    <tr key={row.id} style={{ borderTop: `1px solid ${A.dividerSoft}` }}>
                      <td style={{ ..._mono, padding: "10px 14px", color: A.inkSoft }}>{row.when}</td>
                      <td style={{ padding: "10px 6px" }}>
                        <div style={{ fontSize: 12.5, color: A.ink, fontWeight: 500 }}>{row.crop}</div>
                        <div style={{ fontSize: 11, color: A.inkMuted, marginTop: 1 }}>{row.block} · {row.mode}</div>
                      </td>
                      <td style={{ padding: "10px 6px", textAlign: "right" }}>
                        <span style={{ ..._mono, fontWeight: 600, color: A.ink }}>{row.qty}</span>
                        <span style={{ fontSize: 11, color: A.inkMuted, marginLeft: 3 }}>{row.unit}</span>
                      </td>
                      <td style={{ padding: "10px 14px", color: A.inkSoft, fontSize: 12 }}>{row.by}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </A_Card>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ STOCK ═════════════════════════════════════ */
function AStockScreen() {
  const A = window.A_tokens;
  const s = MOCK.stockData;
  const [cat, setCat] = React.useState("all");
  const filtered = cat === "all" ? s.items : s.items.filter((i) => i.category === cat);

  return (
    <div className="dir-a" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <A_TopBar active="stock" />
      <div style={{ flex: 1, overflow: "auto", padding: "26px 28px 32px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>

          {/* Header */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 22 }}>
            <div>
              <div style={_kic()}>Inventory · {MOCK.farm}</div>
              <h1 className="serif" style={{ margin: "6px 0 0", fontSize: 34, color: A.forestDeep, letterSpacing: "-0.02em", lineHeight: 1.05 }}>Stock.</h1>
              <div style={{ marginTop: 6, color: A.inkSoft, fontSize: 14 }}>
                <strong style={{ color: A.rust }}>{s.summary.lowStock} items short</strong>
                <span style={{ color: A.inkMuted }}> · </span>
                <strong style={{ color: A.wheat }}>{s.summary.expiringSoon} expiring soon</strong>
                <span style={{ color: A.inkMuted }}> · {s.summary.totalItems} SKUs across {s.summary.lotsTotal} lots</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={A_ghostBtn}><Icon.FileText size={14} /> Shopping list CSV</button>
              <button style={A_ghostBtn}><Icon.Box size={14} /> Receive shipment</button>
              <button style={A_primaryBtn}><Icon.Plus size={14} /> Add item</button>
            </div>
          </div>

          {/* KPI strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 18 }}>
            {[
              ["SKUs",         s.summary.totalItems, A.forestDeep, "Box"],
              ["Short",        s.summary.lowStock,   A.rust,        "Alert"],
              ["Expiring 30d", s.summary.expiringSoon, A.wheat,    "CloudRain"],
              ["Lots tracked", s.summary.lotsTotal,  A.inkSoft,     "Layers"],
            ].map(([k, v, c, ic]) => {
              const G = Icon[ic];
              return (
                <A_Card key={k} padded={false} style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: "#E5EEDF", color: c, display: "grid", placeItems: "center" }}>
                    <G size={17} />
                  </div>
                  <div>
                    <div className="serif" style={{ fontSize: 24, color: c, lineHeight: 1, fontWeight: 600, letterSpacing: "-0.02em" }}>{v}</div>
                    <div style={{ fontSize: 11, color: A.inkMuted, marginTop: 3, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>{k}</div>
                  </div>
                </A_Card>
              );
            })}
          </div>

          {/* Category tabs */}
          <div style={{ display: "flex", gap: 4, marginBottom: 12, borderBottom: `1px solid ${A.divider}` }}>
            {s.categories.map((c) => {
              const sel = cat === c.id;
              return (
                <button key={c.id} onClick={() => setCat(c.id)} style={{
                  padding: "9px 14px 10px", background: "transparent", border: "none",
                  color: sel ? A.forestDeep : A.inkSoft, fontSize: 13, fontWeight: sel ? 700 : 500,
                  borderBottom: sel ? `2.5px solid ${A.forest}` : "2.5px solid transparent",
                  marginBottom: -1, cursor: "pointer", fontFamily: "inherit",
                  display: "inline-flex", alignItems: "center", gap: 6,
                }}>
                  {c.label}
                  <span style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    minWidth: 18, padding: "0 5px", borderRadius: 99, fontSize: 10.5,
                    background: sel ? A.forest : A.dividerSoft, color: sel ? A.cream : A.inkSoft,
                    fontWeight: 700, ..._mono,
                  }}>{c.count}</span>
                  {c.low > 0 && <span style={{ width: 6, height: 6, borderRadius: 99, background: A.rust }} title={`${c.low} short`} />}
                </button>
              );
            })}
          </div>

          {/* Items table + side panel */}
          <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16 }}>
            <A_Card padded={false}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: A.cream, color: A.inkMuted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
                    <th style={{ textAlign: "left", padding: "10px 14px" }}>Item</th>
                    <th style={{ textAlign: "left", padding: "10px 8px" }}>Type</th>
                    <th style={{ textAlign: "right", padding: "10px 8px" }}>On hand</th>
                    <th style={{ textAlign: "right", padding: "10px 8px" }}>Reorder at</th>
                    <th style={{ textAlign: "left", padding: "10px 8px" }}>Expires</th>
                    <th style={{ textAlign: "right", padding: "10px 14px" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((it, i) => {
                    const bg = it.status === "short" ? "#FBF1E5" : it.status === "expiring" ? "#FBF5E6" : "transparent";
                    const fg = it.status === "short" ? A.rust : it.status === "expiring" ? A.wheat : A.ink;
                    // Category tag — clear visual delineation between herbicide / insecticide / fungicide / fertility / seed
                    const catTag = ({
                      herb:   { label: "Herbicide",   tone: "rust" },
                      insect: { label: "Insecticide", tone: "wheat" },
                      fung:   { label: "Fungicide",   tone: "sky" },
                      fert:   { label: "Fertility",   tone: "forest" },
                      seed:   { label: "Seed",        tone: "neutral" },
                    })[it.category] || { label: it.category, tone: "neutral" };
                    return (
                      <tr key={it.id} style={{ borderTop: `1px solid ${A.dividerSoft}`, background: bg }}>
                        <td style={{ padding: "11px 14px" }}>
                          <div style={{ fontSize: 13, color: A.ink, fontWeight: 500 }}>{it.name}</div>
                          <div style={{ fontSize: 11, color: A.inkMuted, marginTop: 1, fontFamily: "IBM Plex Mono" }}>{it.lots} lot{it.lots === 1 ? "" : "s"}</div>
                        </td>
                        <td style={{ padding: "11px 8px" }}>
                          <A_Pill tone={catTag.tone}>{catTag.label}</A_Pill>
                        </td>
                        <td style={{ padding: "11px 8px", textAlign: "right" }}>
                          <span style={{ ..._mono, fontSize: 13, color: fg, fontWeight: 600 }}>{it.onHand}</span>
                          <span style={{ fontSize: 11, color: A.inkMuted, marginLeft: 3 }}>{it.unit}</span>
                        </td>
                        <td style={{ padding: "11px 8px", textAlign: "right", ..._mono, fontSize: 12, color: A.inkMuted }}>{it.reorderAt} {it.unit}</td>
                        <td style={{ padding: "11px 8px", ..._mono, fontSize: 12, color: it.status === "expiring" ? A.wheat : A.inkMuted }}>{it.expires}</td>
                        <td style={{ padding: "11px 14px", textAlign: "right" }}>
                          {it.status === "short"
                            ? <button style={{ ...A_primaryBtn, padding: "5px 10px", fontSize: 11.5, background: A.wheat }}>Reorder</button>
                            : <Icon.ChevronRight size={14} stroke={A.inkMuted} />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </A_Card>

            {/* Recent transactions */}
            <A_Card padded={false}>
              <div style={{ padding: "14px 18px 10px", borderBottom: `1px solid ${A.dividerSoft}` }}>
                <h3 className="serif" style={{ margin: 0, fontSize: 16, color: A.forestDeep }}>Recent movement</h3>
                <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 2 }}>Last received {s.summary.lastReceived}</div>
              </div>
              {s.recentTxns.map((tx, i) => {
                const isReceived = tx.kind === "received";
                return (
                  <div key={i} style={{ padding: "12px 18px", borderTop: i === 0 ? "none" : `1px solid ${A.dividerSoft}`, display: "grid", gridTemplateColumns: "auto 1fr", gap: 12 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                      background: isReceived ? "#E5EEDF" : "#F1D9CE",
                      color: isReceived ? A.forest : A.rust,
                      display: "grid", placeItems: "center",
                    }}>{isReceived ? <Icon.ArrowRight size={14} style={{ transform: "rotate(-90deg)" }} /> : <Icon.ArrowRight size={14} style={{ transform: "rotate(90deg)" }} />}</div>
                    <div>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6 }}>
                        <span style={{ fontSize: 13, color: A.ink, fontWeight: 600 }}>{tx.item}</span>
                        <span style={{ ..._mono, fontSize: 12, color: isReceived ? A.forest : A.rust, fontWeight: 700 }}>{tx.qty}</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 2 }}>{tx.reason}</div>
                      <div style={{ ..._mono, fontSize: 11, color: A.inkMuted, marginTop: 2 }}>{tx.when} · {tx.by}</div>
                    </div>
                  </div>
                );
              })}
            </A_Card>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ RECORDS ═══════════════════════════════════ */
function ARecordsScreen() {
  const A = window.A_tokens;
  const r = MOCK.recordsData;
  const kindTone = {
    spray: "rust", herbicide: "rust", insecticide: "wheat", fungicide: "sky",
    scout: "neutral", harvest: "wheat", fertility: "sky", planting: "forest", decon: "rust",
  };

  return (
    <div className="dir-a" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <A_TopBar active="records" />
      <div style={{ flex: 1, overflow: "auto", padding: "26px 28px 32px" }}>
        <div style={{ maxWidth: 1240, margin: "0 auto" }}>

          {/* Header */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 22 }}>
            <div>
              <div style={_kic()}>Records & audit trail</div>
              <h1 className="serif" style={{ margin: "6px 0 0", fontSize: 34, color: A.forestDeep, letterSpacing: "-0.02em", lineHeight: 1.05 }}>Records.</h1>
              <div style={{ marginTop: 6, color: A.inkSoft, fontSize: 14 }}>
                <strong>{r.summary.total} records</strong> · {r.summary.locked} locked · {r.summary.ytd} this year. Retained through <span style={_mono}>{r.summary.retainsUntil}</span>.
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={A_ghostBtn}><Icon.FileText size={14} /> CSV</button>
              <button style={A_ghostBtn}><Icon.FileText size={14} /> PDF</button>
              <button style={A_primaryBtn}><Icon.Lock size={14} /> VDACS audit PDF</button>
            </div>
          </div>

          {/* Filter bar */}
          <A_Card padded={false} style={{ marginBottom: 14 }}>
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${A.dividerSoft}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, color: A.inkMuted, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Filter</span>
              {Object.entries(r.counts).map(([kind, count]) => {
                const active = r.filters.activeKinds.includes(kind);
                return (
                  <button key={kind} style={{
                    padding: "5px 11px", borderRadius: 99,
                    border: `1px solid ${active ? A.forest : A.divider}`,
                    background: active ? A.forest : A.paper,
                    color: active ? A.cream : A.inkSoft,
                    fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
                    display: "inline-flex", alignItems: "center", gap: 5,
                  }}>
                    {kind} <span style={{ ..._mono, fontSize: 10, opacity: 0.8 }}>{count}</span>
                  </button>
                );
              })}
              <span style={{ width: 1, height: 22, background: A.divider, margin: "0 4px" }} />
              <button style={{ ...A_ghostBtn, padding: "5px 10px", fontSize: 12 }}>
                <Icon.Calendar size={12} /> {r.filters.dateRange}
              </button>
              <button style={{ ...A_ghostBtn, padding: "5px 10px", fontSize: 12 }}>
                <Icon.Field size={12} /> Block: {r.filters.block}
              </button>
              <button style={{ ...A_ghostBtn, padding: "5px 10px", fontSize: 12 }}>
                <Icon.Spray size={12} /> Sprayer: {r.filters.sprayer}
              </button>
              <span style={{ marginLeft: "auto", fontSize: 12, color: A.inkMuted }}>Showing {r.rows.length} of {r.summary.total}</span>
            </div>

            {/* Retention strip */}
            <div style={{ padding: "8px 16px", background: "#EFF6E9", borderBottom: `1px solid ${A.dividerSoft}`, display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: A.forestDeep }}>
              <Icon.Lock size={13} stroke={A.forest} />
              <span><strong>{r.summary.locked}/{r.summary.total}</strong> records locked under the 48-hour FR-09 rule. Hash chain verified. Oldest record: <span style={_mono}>{r.summary.oldest}</span>.</span>
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: A.cream, color: A.inkMuted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
                  <th style={{ textAlign: "left", padding: "9px 14px" }}>Timestamp</th>
                  <th style={{ textAlign: "left", padding: "9px 6px" }}>Kind</th>
                  <th style={{ textAlign: "left", padding: "9px 6px" }}>Block · planting</th>
                  <th style={{ textAlign: "left", padding: "9px 6px" }}>Detail</th>
                  <th style={{ textAlign: "left", padding: "9px 6px" }}>By</th>
                  <th style={{ textAlign: "left", padding: "9px 6px" }}>Hash</th>
                  <th style={{ textAlign: "right", padding: "9px 14px" }}></th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((row, i) => (
                  <tr key={row.id} style={{ borderTop: `1px solid ${A.dividerSoft}` }}>
                    <td style={{ ..._mono, padding: "10px 14px", color: A.inkSoft, fontSize: 11.5 }}>{row.when}</td>
                    <td style={{ padding: "10px 6px" }}>
                      <A_Pill tone={kindTone[row.kind] || "neutral"}>{row.kind}</A_Pill>
                    </td>
                    <td style={{ padding: "10px 6px", fontSize: 12, color: A.ink }}>
                      <div style={{ fontWeight: 500 }}>{row.block !== "—" ? `Block ${row.block}` : "—"}</div>
                      <div style={{ fontSize: 11, color: A.inkMuted }}>{row.planting !== "—" ? row.planting : ""}</div>
                    </td>
                    <td style={{ padding: "10px 6px", color: A.inkSoft, fontSize: 12 }}>{row.detail}</td>
                    <td style={{ padding: "10px 6px", color: A.inkMuted, fontSize: 11.5 }}>{row.by}</td>
                    <td style={{ padding: "10px 6px" }}>
                      {row.locked
                        ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4, ..._mono, fontSize: 11, color: A.forest }}><Icon.Lock size={10} /> {row.hash}</span>
                        : <span style={{ ..._mono, fontSize: 11, color: A.wheat }}>unlocked · {row.hash}</span>}
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "right" }}>
                      <Icon.ChevronRight size={14} stroke={A.inkMuted} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </A_Card>

          {/* Footer reassurance */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <A_Card>
              <A_Kicker>Hash chain</A_Kicker>
              <div style={{ marginTop: 8, fontSize: 13, color: A.inkSoft, lineHeight: 1.55 }}>
                Every record signs the previous record's hash. A tampered row breaks the chain at the next link. The VDACS export bundle includes the full chain + a verification command.
              </div>
              <a style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 10, fontSize: 12.5, color: A.forest, fontWeight: 600 }}>
                Verify chain on-device <Icon.ArrowRight size={12} />
              </a>
            </A_Card>
            <A_Card>
              <A_Kicker>Inspector access</A_Kicker>
              <div style={{ marginTop: 8, fontSize: 13, color: A.inkSoft, lineHeight: 1.55 }}>
                Generate a time-boxed link to share with VDACS or a CSA member. The link opens this view in read-only mode with the right filters preset. No login required.
              </div>
              <button style={{ ...A_ghostBtn, marginTop: 10, padding: "7px 12px", fontSize: 12.5 }}>
                <Icon.Plus size={12} /> Create inspector link
              </button>
            </A_Card>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ LOGIN ════════════════════════════════════ */
function ALoginScreen() {
  const A = window.A_tokens;
  const l = MOCK.loginData;
  const [showDemo, setShowDemo] = React.useState(false);

  return (
    <div className="dir-a" style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", height: "100%", overflow: "hidden", background: A.cream }}>

      {/* LEFT — brand + selling points */}
      <div style={{
        background: `linear-gradient(180deg, ${A.cream} 0%, #EFE6CC 100%)`,
        padding: "44px 48px", display: "flex", flexDirection: "column", overflow: "auto",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: A.forest, color: A.cream, display: "grid", placeItems: "center" }}>
            <Icon.Leaf size={20} />
          </div>
          <span className="serif" style={{ fontSize: 24, color: A.forestDeep, letterSpacing: "-0.02em", fontWeight: 600 }}>CropCard</span>
        </div>

        <h1 className="serif" style={{ margin: "44px 0 0", fontSize: 46, lineHeight: 1.05, color: A.forestDeep, letterSpacing: "-0.025em", maxWidth: 500 }}>
          The field card,<br /><em style={{ fontStyle: "italic", color: A.forest }}>modernized.</em>
        </h1>
        <p style={{ margin: "16px 0 0", fontSize: 15.5, color: A.inkSoft, lineHeight: 1.5, maxWidth: 460 }}>
          Plan, spray, harvest. Audit-ready records that survive a VDACS visit. Built for the small-plot grower who used to keep notes on the truck dash.
        </p>

        <div style={{ marginTop: 36, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, maxWidth: 580 }}>
          {l.sellingPoints.map((p) => {
            const G = Icon[p.icon];
            return (
              <div key={p.title} style={{ display: "flex", gap: 12 }}>
                <div style={{ width: 30, height: 30, borderRadius: 6, background: A.paper, color: A.forest, display: "grid", placeItems: "center", flexShrink: 0, border: `1px solid ${A.divider}` }}>
                  <G size={15} />
                </div>
                <div>
                  <div className="serif" style={{ fontSize: 14, color: A.ink, fontWeight: 600 }}>{p.title}</div>
                  <div style={{ fontSize: 12, color: A.inkMuted, lineHeight: 1.45, marginTop: 3 }}>{p.sub}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: "auto", paddingTop: 32, fontSize: 11.5, color: A.inkMuted, display: "flex", alignItems: "center", gap: 10 }}>
          <Icon.Lock size={11} /> Offline-first PWA · single-tenant SQLite · Litestream-backed
          <span style={{ marginLeft: "auto" }}>VDACS audit ready · NOP §205.202 compliant</span>
        </div>
      </div>

      {/* RIGHT — auth */}
      <div style={{ background: A.paper, padding: "44px 48px", display: "flex", flexDirection: "column", justifyContent: "center", overflow: "auto", borderLeft: `1px solid ${A.divider}` }}>
        <div style={{ maxWidth: 360, width: "100%", margin: "0 auto" }}>
          <h2 className="serif" style={{ margin: 0, fontSize: 26, color: A.forestDeep, letterSpacing: "-0.015em" }}>Sign in</h2>
          <p style={{ fontSize: 13.5, color: A.inkSoft, margin: "8px 0 22px", lineHeight: 1.5 }}>
            Enter your email — we'll send a one-time link. New here? Set up your farm in the next step.
          </p>

          {/* Invite banner (shown when an invite token present in URL) */}
          <div style={{ padding: "10px 12px", marginBottom: 14, background: "#E5EEDF", border: `1px solid #C9DBC0`, borderRadius: 6, fontSize: 12.5, color: A.forestDeep, display: "flex", gap: 8, alignItems: "center" }}>
            <Icon.User size={13} />
            <span><strong>Sherry has invited you</strong> as a Helper on Loudoun Home Farm. Sign in to accept.</span>
          </div>

          <label style={{ display: "block" }}>
            <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: A.inkSoft, marginBottom: 5 }}>Email</span>
            <input type="email" placeholder="you@example.com" defaultValue="" style={{
              width: "100%", padding: "11px 14px", fontSize: 14, fontFamily: "inherit",
              background: A.cream, border: `1px solid ${A.divider}`, borderRadius: 8,
              color: A.ink, outline: "none",
            }} />
          </label>

          <button style={{ ...A_primaryBtn, width: "100%", marginTop: 14, padding: "12px 16px", fontSize: 14.5, justifyContent: "center" }}>
            Send magic link <Icon.ArrowRight size={14} />
          </button>

          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, fontSize: 11.5, color: A.inkMuted }}>
            <Icon.Info size={11} /> Magic links expire in 15 minutes. No password needed.
          </div>

          {/* Demo expander */}
          <div style={{ marginTop: 22, paddingTop: 18, borderTop: `1px dashed ${A.divider}` }}>
            <button onClick={() => setShowDemo(!showDemo)} style={{
              display: "flex", alignItems: "center", gap: 5,
              background: "transparent", border: "none", padding: 0, cursor: "pointer",
              color: A.forest, fontSize: 13, fontWeight: 600, fontFamily: "inherit",
            }}>
              <Icon.ChevronRight size={13} style={{ transform: showDemo ? "rotate(90deg)" : "none", transition: "transform 0.15s" }} />
              Try a sandbox demo
            </button>
            {showDemo && (
              <>
                <p style={{ fontSize: 12, color: A.inkMuted, margin: "10px 0 10px", lineHeight: 1.5 }}>
                  One-tap sign-in to the Loudoun sample tenant. Pick a role to feel the surface area.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {l.demoRoles.map((r) => (
                    <button key={r.id} title={r.sub} style={{
                      textAlign: "left", padding: "10px 12px", background: A.cream,
                      border: `1px solid ${A.divider}`, borderRadius: 8,
                      cursor: "pointer", fontFamily: "inherit",
                    }}>
                      <div style={{ fontSize: 13, color: A.ink, fontWeight: 700 }}>{r.label}</div>
                      <div style={{ fontSize: 11, color: A.inkMuted, marginTop: 2 }}>{r.name}</div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div style={{ marginTop: 32, paddingTop: 18, borderTop: `1px solid ${A.dividerSoft}`, textAlign: "center", fontSize: 11.5, color: A.inkMuted, lineHeight: 1.5 }}>
            By signing in, you agree to the <a style={{ color: A.forest }}>terms</a> & <a style={{ color: A.forest }}>privacy</a>. Your data lives on your device first.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ SETTINGS ═════════════════════════════════ */
function ASettingsScreen() {
  const A = window.A_tokens;
  const s = MOCK.settingsData;

  return (
    <div className="dir-a" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <A_TopBar active="settings" />
      <div style={{ flex: 1, overflow: "auto", padding: "26px 28px 32px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>

          {/* Header */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 22 }}>
            <div>
              <div style={_kic()}>Settings</div>
              <h1 className="serif" style={{ margin: "6px 0 0", fontSize: 34, color: A.forestDeep, letterSpacing: "-0.02em", lineHeight: 1.05 }}>Configure CropCard.</h1>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={A_ghostBtn}><Icon.FileText size={14} /> Export account data</button>
            </div>
          </div>

          {/* Account card */}
          <A_Card style={{ marginBottom: 18 }} padded={false}>
            <div style={{ padding: "18px 22px", display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 16, alignItems: "center" }}>
              <div style={{ width: 52, height: 52, borderRadius: 99, background: A.wheat, color: A.cream, display: "grid", placeItems: "center", fontSize: 22, fontWeight: 700 }}>
                {s.user.name[0]}
              </div>
              <div>
                <div className="serif" style={{ fontSize: 19, color: A.ink, letterSpacing: "-0.01em" }}>{s.user.name}</div>
                <div style={{ fontSize: 13, color: A.inkMuted, marginTop: 2 }}>{s.user.email}</div>
                <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                  <A_Pill tone="forest">{s.user.role}</A_Pill>
                  <A_Pill tone="neutral">Member since {s.user.since}</A_Pill>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11.5, color: A.inkMuted, fontWeight: 600 }}>Last sign-in</div>
                <div style={{ ..._mono, fontSize: 12.5, color: A.ink, marginTop: 2 }}>{s.user.lastLogin}</div>
                <div style={{ fontSize: 11, color: A.inkMuted, marginTop: 4 }}>{s.user.sessions} active sessions</div>
              </div>
            </div>
          </A_Card>

          {/* AI assistant card — Claude API key, monthly cap, gated features.
              Sitting above the section grid because it's the highest-leverage
              answer to "what happens when AI is off?" */}
          <A_Card style={{ marginBottom: 14 }} padded={false}>
            <div style={{ padding: "16px 20px 12px", borderBottom: `1px solid ${A.dividerSoft}`, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 44, height: 44, borderRadius: 10,
                background: MOCK.aiEnabled ? A.forest : A.dividerSoft,
                color: MOCK.aiEnabled ? A.cream : A.inkMuted,
                display: "grid", placeItems: "center",
              }}>
                <Icon.Leaf size={20} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <h3 className="serif" style={{ margin: 0, fontSize: 17, color: A.forestDeep, letterSpacing: "-0.01em" }}>AI planning assistant</h3>
                  {MOCK.aiEnabled
                    ? <A_Pill tone="forest"><Icon.Check size={10} /> Active</A_Pill>
                    : <A_Pill tone="rust">Off · no key</A_Pill>}
                </div>
                <div style={{ fontSize: 12.5, color: A.inkMuted, marginTop: 3 }}>
                  Claude {MOCK.aiSettings.model} · monthly cap ${MOCK.aiSettings.monthlyCapUSD} · ${MOCK.aiSettings.spendThisMonth} spent this month · {MOCK.aiSettings.callsThisMonth} calls
                </div>
              </div>
            </div>

            <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 24 }}>
              {/* Key field + cap */}
              <div>
                <div style={{ fontSize: 11, color: A.inkMuted, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>Claude API key</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input type="password" placeholder="sk-ant-…" defaultValue={MOCK.aiSettings.keyMasked || ""} style={{
                    flex: 1, padding: "10px 12px", fontSize: 13, fontFamily: "IBM Plex Mono, monospace",
                    background: A.cream, border: `1px solid ${A.divider}`, borderRadius: 6,
                    color: A.ink, outline: "none",
                  }} />
                  <button style={{ ...A_primaryBtn, padding: "8px 14px", fontSize: 13 }}>
                    {MOCK.aiEnabled ? "Update" : "Save & enable"}
                  </button>
                </div>
                <div style={{ marginTop: 6, fontSize: 11, color: A.inkMuted, display: "flex", alignItems: "center", gap: 5 }}>
                  <Icon.Lock size={11} /> Stored locally · never sent to the CropCard server. Get a key at <a style={{ color: A.forest, fontWeight: 600 }}>console.anthropic.com</a>.
                </div>

                {/* Cap slider */}
                <div style={{ marginTop: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                    <span style={{ fontSize: 11, color: A.inkMuted, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Monthly cap</span>
                    <span style={{ fontFamily: "IBM Plex Mono", fontSize: 12, color: A.ink, fontWeight: 600 }}>${MOCK.aiSettings.monthlyCapUSD}.00</span>
                  </div>
                  <div style={{ height: 8, background: A.cream, borderRadius: 99, position: "relative", overflow: "hidden", border: `1px solid ${A.divider}` }}>
                    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(MOCK.aiSettings.spendThisMonth / MOCK.aiSettings.monthlyCapUSD) * 100}%`, background: A.forest }} />
                  </div>
                  <div style={{ marginTop: 4, display: "flex", justifyContent: "space-between", fontSize: 10.5, color: A.inkMuted, fontFamily: "IBM Plex Mono" }}>
                    <span>$0</span><span>${MOCK.aiSettings.spendThisMonth} spent</span><span>${MOCK.aiSettings.monthlyCapUSD} cap</span>
                  </div>
                </div>
              </div>

              {/* What's gated vs. what works without AI */}
              <div style={{ paddingLeft: 18, borderLeft: `1px solid ${A.dividerSoft}` }}>
                <div style={{ fontSize: 11, color: A.inkMuted, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
                  Gated by AI ({MOCK.aiEnabled ? "available" : "currently hidden"})
                </div>
                {MOCK.aiSettings.gatedFeatures.map((g, i) => (
                  <div key={i} style={{ fontSize: 12, color: MOCK.aiEnabled ? A.ink : A.inkMuted, lineHeight: 1.5, paddingLeft: 14, position: "relative" }}>
                    <span style={{ position: "absolute", left: 0, top: 7, width: 5, height: 5, borderRadius: 99, background: MOCK.aiEnabled ? A.forest : A.divider }} />
                    {g}
                  </div>
                ))}
                <div style={{ marginTop: 12, fontSize: 11, color: A.inkMuted, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  Always works ({MOCK.aiSettings.keepWorking.length})
                </div>
                {MOCK.aiSettings.keepWorking.map((k, i) => (
                  <div key={i} style={{ fontSize: 12, color: A.ink, lineHeight: 1.5, paddingLeft: 14, position: "relative", marginTop: 4 }}>
                    <Icon.Check size={11} stroke={A.forest} style={{ position: "absolute", left: -2, top: 4 }} />
                    {k}
                  </div>
                ))}
              </div>
            </div>
          </A_Card>

          {/* Sections grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 }}>
            {s.sections.map((sec) => {
              const G = Icon[sec.icon];
              const isDanger = sec.id === "danger";
              return (
                <button key={sec.id} style={{
                  textAlign: "left", padding: "16px 18px",
                  background: A.paper, border: `1px solid ${isDanger ? "#E2B69E" : A.divider}`,
                  borderRadius: 10, cursor: "pointer", fontFamily: "inherit",
                  display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, alignItems: "center",
                }}>
                  <div style={{ width: 38, height: 38, borderRadius: 8, background: isDanger ? "#F1D9CE" : "#E5EEDF", color: isDanger ? A.rust : A.forest, display: "grid", placeItems: "center", flexShrink: 0 }}>
                    <G size={17} />
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="serif" style={{ fontSize: 15, color: A.ink, fontWeight: 600 }}>{sec.label}</span>
                      {sec.badge && <A_Pill tone={sec.badge.tone}>{sec.badge.text}</A_Pill>}
                    </div>
                    <div style={{ fontSize: 12, color: A.inkMuted, marginTop: 3, lineHeight: 1.4 }}>{sec.sub}</div>
                  </div>
                  <Icon.ChevronRight size={14} stroke={A.inkMuted} />
                </button>
              );
            })}
          </div>

          {/* Advanced footer */}
          <A_Card style={{ background: A.cream }}>
            <A_Kicker>Advanced · diagnostics</A_Kicker>
            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, fontSize: 12 }}>
              {[
                ["Build version",   s.advanced.buildVersion],
                ["Rules version",   s.advanced.rulesVersion],
                ["Plugin failures", s.advanced.pluginFailures],
                ["Tenant ID",       s.advanced.tenantId],
                ["Last backup",     s.advanced.lastBackup],
                ["Storage tier",    "SQLite · Litestream → Azure Blob"],
              ].map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: 10.5, color: A.inkMuted, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700 }}>{k}</div>
                  <div style={{ ..._mono, fontSize: 12, color: A.ink, marginTop: 3 }}>{v}</div>
                </div>
              ))}
            </div>
          </A_Card>
        </div>
      </div>
    </div>
  );
}

window.A_HarvestScreen = AHarvestScreen;
window.A_StockScreen = AStockScreen;
window.A_RecordsScreen = ARecordsScreen;
window.A_LoginScreen = ALoginScreen;
window.A_SettingsScreen = ASettingsScreen;
