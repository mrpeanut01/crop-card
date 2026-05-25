/* Direction A — Almanac · Stock add flow
   4 entry methods exposed as a single screen with a mode prop:
     - barcode   : camera viewfinder + barcode parse → product match
     - label     : camera + OCR of pesticide / fertilizer / seed label
     - search    : typeahead against plugin registry + your prior stock
     - manual    : full-fielded form (last-resort path)

   Every path lands in the same confirm-and-save step (lot + expiration +
   quantity + location). The lot/exp/qty form is owned by this component
   so the four methods produce a single normalised payload the
   server-side stock repo accepts.

   The right-rail summary tracks safety-kernel implications:
   • EPA reg # matched a registered plugin? → safety-kernel-eligible.
   • No plugin match? → item lands in stock but spray events that try to
     use it must take the "custom rate / no plugin" warning path, which
     the helper role cannot override.

   Wired to A_StockAddScreen(window) for the canvas. */

function AStockAddScreen({ mode = "barcode", phase }) {
  const A = window.A_tokens;
  const [active, setActive] = React.useState(mode);
  const tabs = [
    { id: "barcode", label: "Scan barcode",   icon: "Barcode",  hint: "UPC · EAN · DataMatrix" },
    { id: "label",   label: "Scan label",     icon: "Camera",   hint: "OCR · EPA reg # · SDS" },
    { id: "ai",      label: "AI photo",       icon: "Sparkle",  hint: "Claude · online · any angle" },
    { id: "search",  label: "Textual search", icon: "Search",   hint: "Library → marketplace → AI" },
    { id: "manual",  label: "Manual entry",   icon: "Keyboard", hint: "Full form · last resort" },
  ];

  return (
    <div className="dir-a" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <AStockAddHeader />

      <div style={{ flex: 1, overflow: "auto", padding: "22px 28px 28px", background: A.cream }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>

          {/* Method picker */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 18
          }}>
            {tabs.map((t) => {
              const G = Icon[t.icon];
              const on = active === t.id;
              return (
                <button key={t.id} onClick={() => setActive(t.id)} style={{
                  display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6,
                  padding: "14px 16px",
                  background: on ? A.paper : "transparent",
                  border: on ? `1.5px solid ${A.forest}` : `1px solid ${A.divider}`,
                  borderRadius: 10, textAlign: "left", fontFamily: "inherit", cursor: "pointer",
                  boxShadow: on ? "0 1px 0 rgba(44,82,55,0.08)" : "none",
                }}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 10, width: "100%",
                  }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: 7,
                      background: on ? A.forest : A.dividerSoft,
                      color: on ? A.cream : A.inkSoft,
                      display: "grid", placeItems: "center"
                    }}><G size={16} /></div>
                    <div style={{
                      fontSize: 14, fontWeight: 600,
                      color: on ? A.forestDeep : A.inkSoft,
                      letterSpacing: "-0.005em"
                    }}>{t.label}</div>
                  </div>
                  <div style={{
                    fontSize: 11.5, color: A.inkMuted,
                    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
                  }}>{t.hint}</div>
                </button>
              );
            })}
          </div>

          {/* Method body */}
          {active === "barcode" && <AStockBarcodeBody phase={phase} />}
          {active === "label"   && <AStockLabelBody phase={phase} />}
          {active === "ai"      && <AStockAIBody phase={phase} />}
          {active === "search"  && <AStockSearchBody phase={phase} />}
          {active === "manual"  && <AStockManualBody phase={phase} />}
        </div>
      </div>

      {/* Sticky footer */}
      <AStockAddFooter active={active} />
    </div>
  );
}

/* ── Page header (replaces the global TopBar — this is a flow, not a route) */
function AStockAddHeader() {
  const A = window.A_tokens;
  return (
    <div style={{ background: A.paper, borderBottom: `1px solid ${A.divider}` }}>
      <div style={{ display: "flex", alignItems: "center", padding: "14px 28px", gap: 16 }}>
        <button style={A_iconBtn} title="Back to stock">
          <Icon.ChevronRight size={16} style={{ transform: "rotate(180deg)" }} />
        </button>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 11, color: A.inkMuted, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>
            Stock · Add item
          </div>
          <div className="serif" style={{ fontSize: 22, color: A.forestDeep, letterSpacing: "-0.015em", lineHeight: 1.1, marginTop: 1 }}>
            What are we putting in stock?
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 11.5, color: A.inkMuted, fontFamily: "IBM Plex Mono, ui-monospace, monospace" }}>
            offline · queued for sync
          </div>
          <div style={{ width: 8, height: 8, borderRadius: 99, background: A.wheat }} />
        </div>
      </div>
    </div>
  );
}

/* ── Sticky footer ─────────────────────────────────────────────── */
function AStockAddFooter({ active }) {
  const A = window.A_tokens;
  const ready = active === "barcode" || active === "label" || active === "ai" || active === "search";
  return (
    <div style={{
      borderTop: `1px solid ${A.divider}`, background: A.paper,
      padding: "12px 28px",
      display: "flex", alignItems: "center", gap: 14
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: A.inkSoft }}>
        <Icon.Lock size={13} stroke={A.forest} />
        <span>Lot + expiration + quantity required. Safety kernel won't release this lot to a spray event until lot # is logged.</span>
      </div>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        <button style={A_ghostBtn}>Cancel</button>
        <button style={{
          ...A_primaryBtn,
          opacity: ready ? 1 : 0.45,
          pointerEvents: ready ? "auto" : "none"
        }}>
          <Icon.Plus size={14} /> Add to stock
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════ Method 1 · Scan barcode ════════════════════ */
function AStockBarcodeBody({ phase = "detected" }) {
  const A = window.A_tokens;
  const aiming = phase === "aiming";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.25fr 1fr", gap: 16, alignItems: "start" }}>
      {/* Camera viewfinder */}
      <A_Card padded={false} style={{ overflow: "hidden", background: "#0E1310" }}>
        <div style={{
          position: "relative", aspectRatio: "5 / 4", width: "100%",
          background: `
            radial-gradient(circle at 50% 50%, #1A2218 0%, #0A0F09 100%)
          `,
          display: "grid", placeItems: "center"
        }}>
          {/* Stripe / grain placeholder for the live camera */}
          <div style={{
            position: "absolute", inset: 0,
            backgroundImage: `repeating-linear-gradient(45deg, rgba(255,255,255,0.02) 0 12px, transparent 12px 24px)`,
            opacity: 0.6
          }} />

          {/* The detected barcode visual */}
          {!aiming && (
            <div style={{
              padding: "30px 36px", background: "#F5EFE0", borderRadius: 4,
              display: "flex", flexDirection: "column", gap: 10, alignItems: "center",
              boxShadow: "0 10px 40px rgba(0,0,0,0.4)"
            }}>
              <div style={{
                display: "flex", gap: 1, alignItems: "stretch", height: 70
              }}>
                {[3,1,2,1,4,2,1,3,2,1,4,1,2,3,1,2,4,1,3,2,1,2,4,3,1,2,1,4,2,3,1,2,1,3].map((w, i) => (
                  <div key={i} style={{ width: w, background: i % 2 === 0 ? "#1A1F1A" : "#F5EFE0" }} />
                ))}
              </div>
              <div style={{
                fontSize: 13, color: "#1A1F1A", fontWeight: 600,
                fontFamily: "IBM Plex Mono, ui-monospace, monospace", letterSpacing: "0.2em"
              }}>0 68123 04562 7</div>
            </div>
          )}

          {/* Crosshair frame */}
          <div style={{ position: "absolute", inset: "12% 14%" }}>
            {[
              { top: 0, left: 0, borderTop: 2, borderLeft: 2 },
              { top: 0, right: 0, borderTop: 2, borderRight: 2 },
              { bottom: 0, left: 0, borderBottom: 2, borderLeft: 2 },
              { bottom: 0, right: 0, borderBottom: 2, borderRight: 2 },
            ].map((c, i) => (
              <div key={i} style={{
                position: "absolute", width: 30, height: 30,
                borderTopWidth: c.borderTop || 0, borderBottomWidth: c.borderBottom || 0,
                borderLeftWidth: c.borderLeft || 0, borderRightWidth: c.borderRight || 0,
                borderStyle: "solid", borderColor: aiming ? "#E8D9B5" : "#7FE5A1",
                top: c.top, left: c.left, right: c.right, bottom: c.bottom,
                transition: "border-color .25s"
              }} />
            ))}
            {/* Scan line */}
            {aiming && (
              <div style={{
                position: "absolute", left: 0, right: 0, top: "50%",
                height: 2, background: "rgba(232,217,181,0.6)",
                boxShadow: "0 0 8px rgba(232,217,181,0.7)"
              }} />
            )}
          </div>

          {/* Top-status banner */}
          <div style={{
            position: "absolute", top: 14, left: 14, right: 14,
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 12px", borderRadius: 6,
            background: aiming ? "rgba(0,0,0,0.55)" : "rgba(43,90,55,0.85)",
            color: A.cream, fontSize: 12.5
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: 99,
              background: aiming ? "#E8D9B5" : "#7FE5A1",
              animation: aiming ? "pulse 1.4s ease-in-out infinite" : "none"
            }} />
            <span style={{ fontWeight: 600 }}>
              {aiming ? "Aiming…" : "Detected · UPC-A"}
            </span>
            <span style={{ opacity: 0.75, marginLeft: 6, fontFamily: "IBM Plex Mono, ui-monospace, monospace" }}>
              {aiming ? "Hold barcode in frame" : "0 68123 04562 7"}
            </span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button title="Flashlight" style={{
                width: 28, height: 28, borderRadius: 6, border: "none",
                background: "rgba(255,255,255,0.12)", color: A.cream,
                display: "grid", placeItems: "center", cursor: "pointer"
              }}><Icon.Flashlight size={14} /></button>
              <button title="Upload photo" style={{
                width: 28, height: 28, borderRadius: 6, border: "none",
                background: "rgba(255,255,255,0.12)", color: A.cream,
                display: "grid", placeItems: "center", cursor: "pointer"
              }}><Icon.Image size={14} /></button>
            </div>
          </div>

          {/* Bottom-status hint */}
          <div style={{
            position: "absolute", bottom: 14, left: 14,
            fontSize: 11.5, color: "rgba(255,255,255,0.6)",
            fontFamily: "IBM Plex Mono, ui-monospace, monospace"
          }}>UPC-A · EAN-13 · DataMatrix · QR</div>
        </div>
      </A_Card>

      {/* Match panel */}
      {aiming ? <AStockAimingPanel /> : <AStockMatchPanel
        match={{
          name: "Inspire Super",
          manufacturer: "Syngenta",
          epa: "100-1517",
          unit: "fl oz",
          type: "Fungicide",
          tone: "sky",
          frac: "3 + 9",
          regMatch: true,
          activeIngredients: ["difenoconazole", "cyprodinil"],
          restricted: false,
        }}
        scanned="0 68123 04562 7"
      />}
    </div>
  );
}

/* Aiming-state side panel */
function AStockAimingPanel() {
  const A = window.A_tokens;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <A_Card>
        <A_Kicker>Ready to scan</A_Kicker>
        <div className="serif" style={{ fontSize: 19, color: A.forestDeep, marginTop: 6, lineHeight: 1.3 }}>
          Hold the barcode 4–8″ from the camera.
        </div>
        <ul style={{ margin: "12px 0 0", paddingLeft: 18, color: A.inkSoft, fontSize: 13, lineHeight: 1.7 }}>
          <li>Most pesticide jugs have a UPC on the back near the legal sub-block.</li>
          <li>Seed bags use a smaller EAN-13 next to the lot stamp.</li>
          <li>Liquid fertilizer totes often carry a DataMatrix on the top cap.</li>
        </ul>
      </A_Card>
      <A_Card style={{ background: "#F6F0DF", borderColor: "#E2D3A4" }}>
        <div style={{ display: "flex", gap: 10 }}>
          <Icon.Info size={16} stroke={A.wheat} />
          <div style={{ fontSize: 12.5, color: A.inkSoft, lineHeight: 1.55 }}>
            <strong style={{ color: "#8A6722" }}>No camera?</strong> Switch to <em>Search catalog</em> or <em>Manual entry</em>. Both work fully offline — entries queue and sync when you're back on wifi.
          </div>
        </div>
      </A_Card>
    </div>
  );
}

/* Match-found side panel — common to barcode + label paths */
function AStockMatchPanel({ match, scanned }) {
  const A = window.A_tokens;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <A_Card padded={false}>
        {/* Product header */}
        <div style={{ padding: "14px 18px 12px", borderBottom: `1px solid ${A.dividerSoft}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <A_Pill tone={match.tone}>{match.type}</A_Pill>
            {match.regMatch && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                fontSize: 11, color: A.forest, fontWeight: 700,
                letterSpacing: "0.04em", textTransform: "uppercase"
              }}>
                <Icon.CheckCircle size={12} /> Plugin match
              </span>
            )}
            {match.restricted && (
              <A_Pill tone="rust">Restricted use</A_Pill>
            )}
          </div>
          <div className="serif" style={{ fontSize: 22, color: A.ink, letterSpacing: "-0.015em", lineHeight: 1.15 }}>
            {match.name}
          </div>
          <div style={{ fontSize: 12.5, color: A.inkMuted, marginTop: 3 }}>
            {match.manufacturer} · EPA <span style={{ fontFamily: "IBM Plex Mono, ui-monospace, monospace", color: A.inkSoft }}>{match.epa}</span>
            {match.frac && <> · FRAC <span style={{ fontFamily: "IBM Plex Mono, ui-monospace, monospace", color: A.inkSoft }}>{match.frac}</span></>}
          </div>
          <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 6, fontFamily: "IBM Plex Mono, ui-monospace, monospace" }}>
            scanned · {scanned}
          </div>
        </div>

        {/* Lot / expiration / qty / location */}
        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          <AStockField label="Lot number" required>
            <input style={inputA} defaultValue="BJ24-117" placeholder="Required" />
          </AStockField>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <AStockField label="Expires">
              <input style={inputA} defaultValue="2026-04-30" />
            </AStockField>
            <AStockField label={`Quantity · ${match.unit}`}>
              <input style={inputA} defaultValue="32" type="number" />
            </AStockField>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <AStockField label="Location">
              <select style={inputA} defaultValue="chem-shed">
                <option value="chem-shed">Chemical shed · upper shelf</option>
                <option value="cool-room">Cool room (≤50°F)</option>
                <option value="barn-2">Equipment barn 2</option>
              </select>
            </AStockField>
            <AStockField label="Reorder at">
              <input style={inputA} defaultValue="8" type="number" />
            </AStockField>
          </div>
          {/* Safety read-out */}
          <div style={{
            marginTop: 4, padding: "10px 12px", background: "#EFF6E9",
            border: `1px solid #C9DBC0`, borderRadius: 6, fontSize: 12, color: A.forestDeep,
            display: "flex", gap: 8, alignItems: "flex-start"
          }}>
            <Icon.Lock size={13} stroke={A.forest} style={{ marginTop: 1, flexShrink: 0 }} />
            <span>Active ingredients <strong>{match.activeIngredients.join(" + ")}</strong> route through the safety kernel. Rotation index, REI, PHI and tank-mix gates auto-apply at spray time.</span>
          </div>
        </div>
      </A_Card>

      <A_Card padded={false} style={{ padding: "10px 14px", display: "flex", gap: 10, alignItems: "center" }}>
        <Icon.Layers size={14} stroke={A.inkSoft} />
        <div style={{ fontSize: 12, color: A.inkSoft, flex: 1 }}>
          Already on hand · <strong style={{ color: A.ink }}>0 fl oz</strong> across 0 lots. This will become lot #1.
        </div>
        <button style={{
          background: "transparent", border: "none", color: A.forestDeep,
          fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0
        }}>View history</button>
      </A_Card>
    </div>
  );
}

/* ═══════════════════ Method 2 · Scan label (OCR) ═══════════════ */
function AStockLabelBody() {
  const A = window.A_tokens;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
      {/* Camera + OCR overlay */}
      <A_Card padded={false} style={{ overflow: "hidden", background: "#0E1310" }}>
        <div style={{ position: "relative", aspectRatio: "3 / 4", width: "100%" }}>
          {/* Faux label background */}
          <div style={{
            position: "absolute", inset: 0,
            background: "linear-gradient(180deg, #F4E5C8 0%, #E8D5A8 100%)",
          }} />
          <div style={{
            position: "absolute", inset: "8% 10%",
            display: "flex", flexDirection: "column", gap: 14,
            color: "#1A1F1A",
            fontFamily: "Georgia, serif"
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", color: "#5C4A1F" }}>RESTRICTED USE PESTICIDE</div>
            <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1, color: "#2B3A1F" }}>Lannate® LV</div>
            <div style={{ fontSize: 13, lineHeight: 1.4, color: "#3D4A2F" }}>
              Insecticide containing <em>methomyl</em><br/>
              For agricultural use only
            </div>
            <div style={{ height: 2, background: "#5C4A1F", opacity: 0.4, margin: "4px 0" }} />
            <div style={{ fontSize: 11.5, lineHeight: 1.5, color: "#3D4A2F" }}>
              <strong>Active ingredient:</strong> methomyl (S-methyl N-[(methylcarbamoyl)oxy]thioacetimidate) … 29.0%<br/>
              <strong>Inert ingredients:</strong> … 71.0%
            </div>
            <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", fontSize: 11, color: "#5C4A1F" }}>
              <span>EPA Reg. No. 352-384</span>
              <span>Net contents 2.5 gal</span>
            </div>
          </div>

          {/* OCR field markers */}
          {[
            { top: "8%",  left: "10%", w: "44%", h: "5%",  tag: "Product name",  side: "right" },
            { top: "18%", left: "10%", w: "62%", h: "9%",  tag: "Type + AI",     side: "right" },
            { top: "44%", left: "10%", w: "78%", h: "13%", tag: "Active %",      side: "right" },
            { top: "84%", left: "10%", w: "24%", h: "5%",  tag: "EPA reg #",     side: "right" },
            { top: "84%", left: "62%", w: "26%", h: "5%",  tag: "Net contents",  side: "left" },
            { top: "3%",  left: "10%", w: "40%", h: "5%",  tag: "Restricted",    side: "right" },
          ].map((m, i) => (
            <div key={i} style={{
              position: "absolute",
              top: m.top, left: m.left, width: m.w, height: m.h,
              border: "1.5px solid #7FE5A1",
              borderRadius: 3, pointerEvents: "none"
            }}>
              <div style={{
                position: "absolute",
                top: 0,
                [m.side]: "calc(100% + 6px)",
                background: "#7FE5A1", color: "#0E1310",
                fontSize: 9, fontWeight: 700,
                padding: "2px 6px", borderRadius: 3,
                fontFamily: "IBM Plex Mono, ui-monospace, monospace",
                letterSpacing: "0.04em", textTransform: "uppercase",
                whiteSpace: "nowrap"
              }}>{m.tag}</div>
            </div>
          ))}

          {/* Top status */}
          <div style={{
            position: "absolute", top: 14, left: 14, right: 14,
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 12px", borderRadius: 6,
            background: "rgba(43,90,55,0.85)", color: A.cream, fontSize: 12.5
          }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: "#7FE5A1" }} />
            <span style={{ fontWeight: 600 }}>Label OCR · 6 fields detected</span>
            <span style={{ marginLeft: "auto", fontFamily: "IBM Plex Mono, ui-monospace, monospace", fontSize: 11, opacity: 0.7 }}>0.94 confidence</span>
          </div>
        </div>
      </A_Card>

      {/* Extracted fields */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <A_Card padded={false}>
          <div style={{
            padding: "12px 18px",
            borderBottom: `1px solid ${A.dividerSoft}`,
            display: "flex", alignItems: "center", gap: 10
          }}>
            <Icon.Tag size={14} stroke={A.forest} />
            <div className="serif" style={{ fontSize: 17, color: A.forestDeep, letterSpacing: "-0.01em" }}>Extracted from label</div>
            <span style={{
              marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: 10.5, color: A.forest, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase"
            }}><Icon.CheckCircle size={11} /> Plugin match · methomyl</span>
          </div>
          <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 11 }}>
            <AStockField label="Product name" extracted>
              <input style={inputA} defaultValue="Lannate LV" />
            </AStockField>
            <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 10 }}>
              <AStockField label="Active ingredient" extracted>
                <input style={inputA} defaultValue="methomyl" />
              </AStockField>
              <AStockField label="Concentration" extracted>
                <input style={inputA} defaultValue="29.0%" />
              </AStockField>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <AStockField label="EPA reg #" extracted>
                <input style={inputA} defaultValue="352-384" />
              </AStockField>
              <AStockField label="Net contents" extracted>
                <input style={inputA} defaultValue="2.5 gal" />
              </AStockField>
            </div>
            <div style={{
              padding: "9px 12px", background: "#FBE9DE",
              border: "1px solid #E2B69E", borderRadius: 6,
              display: "flex", alignItems: "center", gap: 10
            }}>
              <Icon.Alert size={14} stroke={A.rust} />
              <div style={{ fontSize: 12.5, color: "#8A341B", flex: 1 }}>
                <strong>Restricted Use Pesticide</strong> — only certified applicators can release this lot to a spray event. Helper role blocked.
              </div>
            </div>
          </div>
        </A_Card>

        {/* Lot+exp+qty short form */}
        <A_Card padded={false}>
          <div style={{ padding: "12px 18px", borderBottom: `1px solid ${A.dividerSoft}` }}>
            <A_Kicker>Lot details</A_Kicker>
          </div>
          <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 11 }}>
            <AStockField label="Lot number" required>
              <input style={inputA} defaultValue="L24-A887" />
            </AStockField>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <AStockField label="Expires"><input style={inputA} defaultValue="2027-09-30" /></AStockField>
              <AStockField label="Qty (gal)"><input style={inputA} defaultValue="2.5" type="number" /></AStockField>
              <AStockField label="Reorder at"><input style={inputA} defaultValue="0.5" type="number" /></AStockField>
            </div>
          </div>
        </A_Card>
      </div>
    </div>
  );
}

/* ═══════════════════ Method 3 · AI photo (Claude) ═══════════════ */
function AStockAIBody({ phase = "result" }) {
  const A = window.A_tokens;
  const analyzing = phase === "analyzing";

  // Mock Claude extraction result — what the structured prompt returns.
  const claudeResult = {
    productName: "Surround WP",
    productNameConfidence: 0.98,
    type: "Insecticide (kaolin clay)",
    typeConfidence: 0.92,
    manufacturer: "NovaSource / Tessenderlo Kerley",
    manufacturerConfidence: 0.81,
    epa: "61842-18",
    epaConfidence: 0.96,
    activeIngredients: ["kaolin (95%)"],
    omri: "OMRI listed",
    netContents: "25 lb bag",
    netContentsConfidence: 0.88,
    lotVisible: false,                    // Claude couldn't see lot # in the photo
    pluginMatch: { matched: true, pluginId: "surround-wp" },
    notes: "Photo taken at an angle; brand wordmark partially obscured by fold. Crosschecked against EPA reg # in registry.",
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.05fr 1fr", gap: 16, alignItems: "start" }}>
      {/* Photo + capture controls */}
      <A_Card padded={false} style={{ overflow: "hidden", background: "#0E1310" }}>
        <div style={{ position: "relative", aspectRatio: "4 / 3", width: "100%" }}>
          {/* Faux photo — angled product bag */}
          <div style={{
            position: "absolute", inset: 0,
            background: "radial-gradient(circle at 30% 40%, #2a2e22 0%, #0e1310 100%)"
          }} />
          <div style={{
            position: "absolute", inset: "12% 18% 14% 14%",
            background: "linear-gradient(135deg, #f1e6c4 0%, #e8d49f 80%)",
            transform: "perspective(900px) rotateY(-18deg) rotateX(4deg)",
            transformOrigin: "left center",
            borderRadius: 6,
            boxShadow: "0 18px 50px rgba(0,0,0,0.55)",
            padding: "8% 7%",
            display: "flex", flexDirection: "column", gap: 10,
            color: "#1A1F1A", fontFamily: "Georgia, serif"
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", color: "#5C4A1F" }}>OMRI LISTED · ORGANIC</div>
            <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1, color: "#2B3A1F" }}>Surround</div>
            <div style={{ fontSize: 14, letterSpacing: "0.2em", color: "#5C4A1F" }}>W · P</div>
            <div style={{ fontSize: 11, lineHeight: 1.4, color: "#3D4A2F", maxWidth: "70%" }}>
              Crop protectant · kaolin clay film for sun, heat, and insect suppression
            </div>
            <div style={{ marginTop: "auto", fontSize: 10, color: "#5C4A1F", opacity: 0.8 }}>
              EPA Reg. 61842-18 · 25 lb (11.3 kg)
            </div>
          </div>

          {/* Fold/shadow over the corner — half of name partially blocked */}
          <div style={{
            position: "absolute", left: "55%", top: "12%", width: "26%", height: "30%",
            background: "linear-gradient(135deg, transparent 40%, rgba(0,0,0,0.35) 100%)",
            transform: "perspective(900px) rotateY(-18deg) rotateX(4deg)",
            transformOrigin: "left center",
            pointerEvents: "none"
          }} />

          {/* Status banner */}
          <div style={{
            position: "absolute", top: 14, left: 14, right: 14,
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 12px", borderRadius: 6,
            background: analyzing ? "rgba(0,0,0,0.55)" : "rgba(43,90,55,0.85)",
            color: A.cream, fontSize: 12.5
          }}>
            <Icon.Sparkle size={14} stroke={analyzing ? "#E8D9B5" : "#7FE5A1"} />
            <span style={{ fontWeight: 600 }}>
              {analyzing ? "Sending to Claude…" : "Claude · result returned"}
            </span>
            <span style={{
              marginLeft: 8, opacity: 0.75, fontSize: 11,
              fontFamily: "IBM Plex Mono, ui-monospace, monospace"
            }}>
              {analyzing ? "~ 1.8 s" : "claude-haiku-4-5 · 1.7 s · 412 tokens"}
            </span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <button title="Retake" style={{
                width: 26, height: 26, borderRadius: 6, border: "none",
                background: "rgba(255,255,255,0.12)", color: A.cream,
                display: "grid", placeItems: "center", cursor: "pointer"
              }}><Icon.Camera size={13} /></button>
              <button title="Upload from camera roll" style={{
                width: 26, height: 26, borderRadius: 6, border: "none",
                background: "rgba(255,255,255,0.12)", color: A.cream,
                display: "grid", placeItems: "center", cursor: "pointer"
              }}><Icon.Image size={13} /></button>
            </div>
          </div>

          {/* Caption: when barcode + label OCR fail */}
          <div style={{
            position: "absolute", bottom: 14, left: 14, right: 14,
            display: "flex", alignItems: "center", gap: 8,
            fontSize: 11, color: "rgba(255,255,255,0.65)",
            fontFamily: "IBM Plex Mono, ui-monospace, monospace"
          }}>
            <span>Photo · angled · partial fold · no visible barcode</span>
          </div>
        </div>

        {/* Photo capture controls */}
        <div style={{
          padding: "12px 14px", background: "#11160F",
          borderTop: `1px solid rgba(255,255,255,0.08)`,
          display: "flex", alignItems: "center", gap: 10
        }}>
          <button style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 14px", borderRadius: 6, border: "none",
            background: A.cream, color: A.forestDeep, fontWeight: 600,
            fontSize: 13, cursor: "pointer", fontFamily: "inherit"
          }}>
            <Icon.Camera size={14} /> Take photo
          </button>
          <button style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "8px 12px", borderRadius: 6,
            border: `1px solid rgba(255,255,255,0.18)`,
            background: "transparent", color: A.cream, fontSize: 12.5,
            cursor: "pointer", fontFamily: "inherit"
          }}>
            <Icon.Image size={13} /> Upload
          </button>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "rgba(255,255,255,0.55)" }}>
            <Icon.Cloud size={12} />
            <span style={{ fontFamily: "IBM Plex Mono, ui-monospace, monospace" }}>online · 87 req left today</span>
          </div>
        </div>
      </A_Card>

      {/* Claude result panel */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {analyzing ? <AStockAIAnalyzing /> : <AStockAIResult result={claudeResult} />}
      </div>
    </div>
  );
}

function AStockAIAnalyzing() {
  const A = window.A_tokens;
  return (
    <A_Card>
      <A_Kicker>Sending to Claude</A_Kicker>
      <div className="serif" style={{ fontSize: 19, color: A.forestDeep, marginTop: 6, lineHeight: 1.3 }}>
        Reading the photo…
      </div>
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {["Encoding photo (1024×768)", "claude-haiku-4-5 vision pass", "Extracting product fields", "Cross-checking EPA reg # against plugin registry"].map((step, i) => (
          <div key={step} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: A.inkSoft }}>
            <span style={{
              width: 8, height: 8, borderRadius: 99,
              background: i < 2 ? A.forest : A.dividerSoft
            }} />
            <span>{step}</span>
            {i < 2 && <span style={{ marginLeft: "auto", fontSize: 11, color: A.forest, fontFamily: "IBM Plex Mono, ui-monospace, monospace" }}>✓</span>}
          </div>
        ))}
      </div>
      <div style={{
        marginTop: 14, padding: "10px 12px", background: A.cream,
        borderRadius: 6, fontSize: 11.5, color: A.inkSoft, lineHeight: 1.55
      }}>
        Average response 1.7 s. Times out at 6 s and falls back to label OCR if you're offline or rate-limited.
      </div>
    </A_Card>
  );
}

function AStockAIResult({ result }) {
  const A = window.A_tokens;
  const confTone = (c) => c >= 0.9 ? A.forest : c >= 0.75 ? A.wheat : A.rust;
  const confLabel = (c) => `${Math.round(c * 100)}%`;

  return (
    <>
      <A_Card padded={false}>
        <div style={{
          padding: "12px 18px",
          borderBottom: `1px solid ${A.dividerSoft}`,
          display: "flex", alignItems: "center", gap: 10
        }}>
          <Icon.Sparkle size={14} stroke={A.forest} />
          <div className="serif" style={{ fontSize: 17, color: A.forestDeep, letterSpacing: "-0.01em" }}>Claude extracted</div>
          {result.pluginMatch.matched && (
            <span style={{
              marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: 10.5, color: A.forest, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase"
            }}><Icon.CheckCircle size={11} /> Plugin match · {result.pluginMatch.pluginId}</span>
          )}
        </div>
        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 11 }}>
          <AStockAIField
            label="Product name"
            value={result.productName}
            confidence={result.productNameConfidence}
            confTone={confTone(result.productNameConfidence)}
            confLabel={confLabel(result.productNameConfidence)}
          />
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 10 }}>
            <AStockAIField
              label="Type"
              value={result.type}
              confidence={result.typeConfidence}
              confTone={confTone(result.typeConfidence)}
              confLabel={confLabel(result.typeConfidence)}
            />
            <AStockAIField
              label="Net contents"
              value={result.netContents}
              confidence={result.netContentsConfidence}
              confTone={confTone(result.netContentsConfidence)}
              confLabel={confLabel(result.netContentsConfidence)}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <AStockAIField
              label="EPA reg #"
              value={result.epa}
              confidence={result.epaConfidence}
              confTone={confTone(result.epaConfidence)}
              confLabel={confLabel(result.epaConfidence)}
            />
            <AStockAIField
              label="Manufacturer"
              value={result.manufacturer}
              confidence={result.manufacturerConfidence}
              confTone={confTone(result.manufacturerConfidence)}
              confLabel={confLabel(result.manufacturerConfidence)}
            />
          </div>
          <AStockAIField
            label="Active ingredient(s) · OMRI status"
            value={`${result.activeIngredients.join(", ")} · ${result.omri}`}
          />

          {/* Claude notes */}
          <div style={{
            padding: "10px 12px", background: A.cream,
            border: `1px dashed ${A.divider}`, borderRadius: 6,
            display: "flex", gap: 9, alignItems: "flex-start"
          }}>
            <Icon.Info size={13} stroke={A.inkSoft} style={{ marginTop: 1 }} />
            <div style={{ fontSize: 11.5, color: A.inkSoft, lineHeight: 1.55, fontStyle: "italic" }}>
              {result.notes}
            </div>
          </div>

          {/* Lot warning — Claude couldn't see it */}
          {!result.lotVisible && (
            <div style={{
              padding: "9px 12px", background: "#F6F0DF",
              border: "1px solid #E2D3A4", borderRadius: 6,
              display: "flex", alignItems: "center", gap: 10
            }}>
              <Icon.Alert size={14} stroke={A.wheat} />
              <div style={{ fontSize: 12.5, color: "#8A6722", flex: 1 }}>
                Lot # not visible in this photo. Required by the safety kernel — type it in below.
              </div>
            </div>
          )}
        </div>
      </A_Card>

      {/* Lot details — manual completion */}
      <A_Card padded={false}>
        <div style={{ padding: "12px 18px", borderBottom: `1px solid ${A.dividerSoft}` }}>
          <A_Kicker>Lot details · still required</A_Kicker>
        </div>
        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 11 }}>
          <AStockField label="Lot number" required>
            <input style={inputA} placeholder="From bottom of bag" />
          </AStockField>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <AStockField label="Expires"><input style={inputA} defaultValue="2028-06-30" /></AStockField>
            <AStockField label="Qty (lb)"><input style={inputA} defaultValue="25" type="number" /></AStockField>
            <AStockField label="Reorder at"><input style={inputA} defaultValue="5" type="number" /></AStockField>
          </div>
        </div>
      </A_Card>

      {/* Prompt structure — for engineering reference */}
      <A_Card padded={false} style={{ background: A.cream }}>
        <div style={{ padding: "10px 14px", borderBottom: `1px solid ${A.dividerSoft}`, display: "flex", alignItems: "center", gap: 8 }}>
          <Icon.FileText size={12} stroke={A.inkSoft} />
          <span style={{ fontSize: 11, color: A.inkMuted, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Engineering · structured prompt
          </span>
        </div>
        <div style={{
          padding: "10px 14px", fontFamily: "IBM Plex Mono, ui-monospace, monospace",
          fontSize: 11, color: A.inkSoft, lineHeight: 1.55, whiteSpace: "pre"
        }}>{`window.claude.complete({ messages: [
  { role: "user", content: [
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: photoB64 }},
    { type: "text",  text: STOCK_EXTRACTION_PROMPT }
  ]}]
}) // returns JSON matching StockExtraction zod schema`}</div>
      </A_Card>
    </>
  );
}

function AStockAIField({ label, value, confidence, confTone, confLabel }) {
  const A = window.A_tokens;
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11, color: A.inkSoft, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          {label}
        </span>
        {confidence != null && (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 3,
            fontSize: 10, color: confTone, fontWeight: 700, letterSpacing: "0.04em"
          }}>
            <Icon.Sparkle size={9} stroke={confTone} /> {confLabel}
          </span>
        )}
      </div>
      <input style={inputA} defaultValue={value} />
    </label>
  );
}

/* ═══════════════════ Method 4 · Textual search (3-tier waterfall) ═══════════════════
   Waterfall: user's library → marketplace plugins → Claude web lookup.
   The third tier only fires when the first two are thin; results are
   flagged "Review before adding" and create a draft plugin request
   instead of going straight to the safety kernel. */
function AStockSearchBody({ phase }) {
  const A = window.A_tokens;
  const [q, setQ] = React.useState("Bonide copper");

  const tiers = {
    library: [
      { name: "Bonide Copper Fungicide (RTU)", manufacturer: "Bonide Products",
        epa: "4-413", type: "Fungicide", tone: "sky", ai: "copper octanoate (10%)",
        group: "FRAC M1", unit: "fl oz", onHand: 12, lastReceived: "Mar 4 · Lot CO-23-A",
        omri: true },
    ],
    marketplace: [
      { name: "Bonide Liquid Copper Fungicide", manufacturer: "Bonide Products",
        epa: "4-414", type: "Fungicide", tone: "sky", ai: "copper octanoate (0.08%)",
        group: "FRAC M1", unit: "fl oz", omri: true, downloads: "1.2k farms" },
      { name: "Copper Sulfate (Bordeaux 4-4-50)", manufacturer: "Old Bridge Chemicals",
        epa: "5905-541", type: "Fungicide", tone: "sky", ai: "copper sulfate (98%)",
        group: "FRAC M1", unit: "lb", downloads: "230 farms" },
      { name: "Champ DP Dry Prill", manufacturer: "Nufarm Americas",
        epa: "55146-1", type: "Fungicide", tone: "sky", ai: "copper hydroxide (37.5%)",
        group: "FRAC M1", unit: "lb", downloads: "84 farms" },
    ],
    ai: [
      { name: "Cueva Fungicide Concentrate (1% Cu octanoate)",
        manufacturer: "Certis USA", epa: "67702-2-70051", type: "Fungicide", tone: "sky",
        ai: "copper octanoate (10%)", group: "FRAC M1", unit: "fl oz", omri: true,
        sourceUrl: "certisbio.com/cueva",
        citation: "Found via Claude web search · 3 corroborating sources",
        confidence: 0.91 },
    ],
  };
  const totalCount = tiers.library.length + tiers.marketplace.length + tiers.ai.length;
  const selected = tiers.library[0];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16, alignItems: "start" }}>
      <A_Card padded={false}>
        {/* Search input */}
        <div style={{
          padding: "12px 14px", borderBottom: `1px solid ${A.dividerSoft}`,
          display: "flex", alignItems: "center", gap: 10
        }}>
          <Icon.Search size={16} stroke={A.inkSoft} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Type a product name, brand, EPA reg #, or active ingredient…"
            style={{
              flex: 1, border: "none", outline: "none", fontSize: 14,
              background: "transparent", color: A.ink, fontFamily: "inherit"
            }}
          />
          <span style={{
            fontSize: 11, color: A.inkMuted,
            fontFamily: "IBM Plex Mono, ui-monospace, monospace"
          }}>{totalCount} matches</span>
        </div>

        {/* Waterfall summary */}
        <div style={{
          padding: "8px 14px",
          borderBottom: `1px solid ${A.dividerSoft}`,
          background: A.cream,
          display: "flex", alignItems: "center", gap: 14,
          fontSize: 11.5, color: A.inkSoft
        }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: A.forest }} />
            <strong style={{ color: A.forestDeep }}>{tiers.library.length}</strong> in your library
          </span>
          <span style={{ color: A.inkMuted }}>→</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: A.sky }} />
            <strong style={{ color: "#3A586E" }}>{tiers.marketplace.length}</strong> from marketplace
          </span>
          <span style={{ color: A.inkMuted }}>→</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Icon.Sparkle size={10} stroke={A.wheat} />
            <strong style={{ color: "#8A6722" }}>{tiers.ai.length}</strong> found by Claude
          </span>
          <span style={{ marginLeft: "auto", color: A.inkMuted, fontFamily: "IBM Plex Mono, ui-monospace, monospace" }}>
            waterfall · stops once you pick
          </span>
        </div>

        {/* Filter chips */}
        <div style={{ padding: "8px 14px", borderBottom: `1px solid ${A.dividerSoft}`, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {["All sources", "Library only", "Marketplace", "AI suggestions"].map((c, i) => (
            <button key={c} style={{
              padding: "4px 10px", borderRadius: 99,
              border: `1px solid ${i === 0 ? A.forest : A.divider}`,
              background: i === 0 ? "#E5EEDF" : A.paper,
              color: i === 0 ? A.forestDeep : A.inkSoft,
              fontSize: 11.5, fontWeight: i === 0 ? 600 : 500,
              cursor: "pointer", fontFamily: "inherit"
            }}>{c}</button>
          ))}
          <span style={{ width: 1, height: 18, background: A.divider, margin: "0 4px", alignSelf: "center" }} />
          {["Fungicide", "OMRI only"].map((c) => (
            <button key={c} style={{
              padding: "4px 10px", borderRadius: 99,
              border: `1px solid ${A.divider}`, background: A.paper,
              color: A.inkSoft, fontSize: 11.5, cursor: "pointer", fontFamily: "inherit"
            }}>{c}</button>
          ))}
        </div>

        {/* TIER 1 · Library */}
        <SearchTierHeader label="From your library" sub="Already in your stock or in a previous purchase" color={A.forest} />
        {tiers.library.map((r, i) => <SearchResultRow key={r.epa} r={r} tier="library" selected={i === 0} />)}

        {/* TIER 2 · Marketplace */}
        <SearchTierHeader label="From the marketplace" sub="Community plugin registry · 1,840 products · curator-reviewed" color={A.sky} />
        {tiers.marketplace.map((r) => <SearchResultRow key={r.epa} r={r} tier="marketplace" />)}

        {/* TIER 3 · AI lookup */}
        <SearchTierHeader label="Claude found online" sub="Live web search · not yet in the marketplace · review before adding" color={A.wheat} sparkle />
        {tiers.ai.map((r) => <SearchResultRow key={r.epa} r={r} tier="ai" />)}

        {/* Footer */}
        <div style={{
          padding: "10px 14px", background: A.cream,
          fontSize: 12, color: A.inkSoft,
          display: "flex", justifyContent: "space-between", alignItems: "center"
        }}>
          <span>Searched 12 of your lots, 1,840 marketplace products, then asked Claude.</span>
          <button style={{
            background: "transparent", border: "none", color: A.forestDeep,
            fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0
          }}>Don't see it? → Manual entry</button>
        </div>
      </A_Card>

      {/* Selected detail + lot form */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <A_Card padded={false}>
          <div style={{ padding: "14px 18px 12px", borderBottom: `1px solid ${A.dividerSoft}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <A_Pill tone={selected.tone}>{selected.type}</A_Pill>
              {selected.omri && (
                <span style={{
                  fontSize: 10, color: A.forest, fontWeight: 700, letterSpacing: "0.04em",
                  background: "#E5EEDF", padding: "1px 6px", borderRadius: 3
                }}>OMRI</span>
              )}
              <span style={{
                marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4,
                fontSize: 10.5, color: A.forest, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase"
              }}><Icon.CheckCircle size={11} /> In your library</span>
            </div>
            <div className="serif" style={{ fontSize: 20, color: A.ink, letterSpacing: "-0.015em" }}>{selected.name}</div>
            <div style={{ fontSize: 12.5, color: A.inkMuted, marginTop: 3 }}>
              {selected.manufacturer} · EPA <span style={{ fontFamily: "IBM Plex Mono, ui-monospace, monospace", color: A.inkSoft }}>{selected.epa}</span>
            </div>
            <div style={{ marginTop: 6, fontSize: 11.5, color: A.forest, fontFamily: "IBM Plex Mono, ui-monospace, monospace" }}>
              on hand · {selected.onHand} {selected.unit} · {selected.lastReceived}
            </div>
          </div>
          <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 11 }}>
            <AStockField label="Lot number" required>
              <input style={inputA} placeholder="Adds new lot to existing item" defaultValue="CO-24-B" />
            </AStockField>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <AStockField label="Expires"><input style={inputA} defaultValue="2027-09-30" /></AStockField>
              <AStockField label={`Qty (${selected.unit})`}><input style={inputA} defaultValue="32" type="number" /></AStockField>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <AStockField label="Location">
                <select style={inputA} defaultValue="chem-shed">
                  <option value="chem-shed">Chemical shed · upper shelf</option>
                </select>
              </AStockField>
              <AStockField label="Reorder at"><input style={inputA} defaultValue="8" type="number" /></AStockField>
            </div>
          </div>
        </A_Card>

        <A_Card padded={false} style={{
          padding: "10px 14px", background: "#EFF6E9", borderColor: "#C9DBC0",
          display: "flex", gap: 10, alignItems: "flex-start"
        }}>
          <Icon.Layers size={14} stroke={A.forest} style={{ marginTop: 2 }} />
          <div style={{ fontSize: 12, color: A.forestDeep, lineHeight: 1.55 }}>
            This adds a <strong>second lot</strong> to your existing item. Spray events will draw from oldest lot first (FIFO) and respect each lot's separate expiration.
          </div>
        </A_Card>
      </div>
    </div>
  );
}

function SearchTierHeader({ label, sub, color, sparkle }) {
  const A = window.A_tokens;
  return (
    <div style={{
      padding: "10px 14px 8px",
      borderTop: `1px solid ${A.dividerSoft}`,
      background: A.paper,
      display: "flex", alignItems: "center", gap: 10
    }}>
      <span style={{ width: 8, height: 8, borderRadius: 99, background: color }} />
      <span style={{ fontSize: 10.5, color: "#1A1F1A", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {label}
      </span>
      {sparkle && <Icon.Sparkle size={11} stroke={color} />}
      <span style={{ fontSize: 11.5, color: A.inkMuted, marginLeft: 4 }}>· {sub}</span>
    </div>
  );
}

function SearchResultRow({ r, tier, selected }) {
  const A = window.A_tokens;
  const bg = selected ? "#F2F0E5" : "transparent";
  const tierAccent = tier === "library" ? A.forest : tier === "marketplace" ? A.sky : A.wheat;
  return (
    <div style={{
      padding: "11px 16px",
      borderTop: `1px solid ${A.dividerSoft}`,
      background: bg,
      borderLeft: selected ? `3px solid ${tierAccent}` : "3px solid transparent",
      display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center",
      cursor: "pointer"
    }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
          <span style={{ fontSize: 13.5, color: A.ink, fontWeight: 600 }}>{r.name}</span>
          <A_Pill tone={r.tone}>{r.type}</A_Pill>
          {r.omri && <span style={{
            fontSize: 9.5, color: A.forest, fontWeight: 700, letterSpacing: "0.04em",
            background: "#E5EEDF", padding: "1px 5px", borderRadius: 3
          }}>OMRI</span>}
          {tier === "ai" && (
            <span style={{
              fontSize: 9.5, color: "#8A6722", fontWeight: 700, letterSpacing: "0.04em",
              background: "#F6F0DF", padding: "1px 5px", borderRadius: 3,
              display: "inline-flex", alignItems: "center", gap: 3
            }}><Icon.Sparkle size={9} stroke="#8A6722" /> AI</span>
          )}
        </div>
        <div style={{
          fontSize: 11.5, color: A.inkMuted, display: "flex", gap: 10, flexWrap: "wrap",
          fontFamily: "IBM Plex Mono, ui-monospace, monospace"
        }}>
          <span>{r.manufacturer}</span>
          <span>EPA {r.epa}</span>
          <span>{r.ai} · {r.group}</span>
        </div>
        {tier === "library" && (
          <div style={{ fontSize: 11, color: A.forest, marginTop: 3, fontWeight: 600 }}>
            {r.onHand} {r.unit} on hand · {r.lastReceived}
          </div>
        )}
        {tier === "marketplace" && (
          <div style={{ fontSize: 11, color: A.inkSoft, marginTop: 3 }}>
            Used by {r.downloads} · plugin registered
          </div>
        )}
        {tier === "ai" && (
          <div style={{ marginTop: 4, padding: "5px 8px", background: "#F6F0DF", borderRadius: 4, fontSize: 11, color: "#8A6722", lineHeight: 1.4 }}>
            {r.citation} · <span style={{ fontFamily: "IBM Plex Mono, ui-monospace, monospace" }}>{r.sourceUrl}</span> · <strong>confidence {Math.round(r.confidence * 100)}%</strong>
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {tier === "ai" && (
          <span title="Will create a draft plugin request" style={{
            fontSize: 10.5, color: "#8A6722", fontWeight: 600,
            background: "#FBF5E6", padding: "3px 7px", borderRadius: 4
          }}>Review before adding</span>
        )}
        <Icon.ChevronRight size={14} stroke={A.inkMuted} />
      </div>
    </div>
  );
}

/* ═══════════════════ Method 4 · Manual entry ═══════════════════ */
function AStockManualBody() {
  const A = window.A_tokens;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, alignItems: "start" }}>
      <A_Card padded={false}>
        <div style={{ padding: "14px 18px 8px", borderBottom: `1px solid ${A.dividerSoft}` }}>
          <A_Kicker>Manual entry · last-resort path</A_Kicker>
          <div className="serif" style={{ fontSize: 18, color: A.forestDeep, marginTop: 4 }}>Tell CropCard what you have.</div>
          <div style={{ fontSize: 12, color: A.inkMuted, marginTop: 4, lineHeight: 1.5 }}>
            We use this when a barcode is missing, the label is damaged, or your input isn't in the EPA / OMRI catalogs.
            Required fields keep the safety kernel honest at spray time.
          </div>
        </div>

        <div style={{ padding: "18px 18px 4px", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Section 1 — what is it */}
          <div>
            <A_Kicker>1 · What is it</A_Kicker>
            <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
              <AStockField label="Product name" required>
                <input style={inputA} placeholder="e.g. Banvel SGF, Howard's Compost, French Marigold starts" />
              </AStockField>
              <AStockField label="Type" required>
                <select style={inputA} defaultValue="">
                  <option value="" disabled>Choose…</option>
                  <option value="herb">Herbicide</option>
                  <option value="insect">Insecticide</option>
                  <option value="fung">Fungicide</option>
                  <option value="fert">Fertility / amendment</option>
                  <option value="seed">Seed / start</option>
                  <option value="other">Other (PPE, adjuvant, etc.)</option>
                </select>
              </AStockField>
            </div>
            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <AStockField label="Manufacturer / source">
                <input style={inputA} placeholder="Helena Agri, Johnny's…" />
              </AStockField>
              <AStockField label="EPA reg #" hint="format ####-### or ####-###-####">
                <input style={inputA} placeholder="e.g. 100-1517" />
              </AStockField>
              <AStockField label="OMRI / organic ID" hint="if certified">
                <input style={inputA} placeholder="optional" />
              </AStockField>
            </div>
          </div>

          {/* Section 2 — chemistry */}
          <div>
            <A_Kicker>2 · Chemistry (if applicable)</A_Kicker>
            <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10 }}>
              <AStockField label="Active ingredient(s)" hint="Comma-separated; matched against safety kernel registry">
                <input style={inputA} placeholder="e.g. glyphosate, 2,4-D" />
              </AStockField>
              <AStockField label="Concentration">
                <input style={inputA} placeholder="e.g. 41%" />
              </AStockField>
              <AStockField label="Mode-of-action group" hint="HRAC / IRAC / FRAC">
                <input style={inputA} placeholder="e.g. HRAC 9" />
              </AStockField>
            </div>
            <label style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: A.inkSoft, cursor: "pointer" }}>
              <input type="checkbox" />
              Restricted Use Pesticide (RUP) — applicator must be certified
            </label>
          </div>

          {/* Section 3 — this lot */}
          <div>
            <A_Kicker>3 · This lot</A_Kicker>
            <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
              <AStockField label="Lot number" required>
                <input style={inputA} placeholder="from container" />
              </AStockField>
              <AStockField label="Expires">
                <input style={inputA} placeholder="YYYY-MM-DD" />
              </AStockField>
              <AStockField label="Quantity" required>
                <input style={inputA} placeholder="numeric" type="number" />
              </AStockField>
              <AStockField label="Unit" required>
                <select style={inputA} defaultValue="">
                  <option value="" disabled>—</option>
                  <option>fl oz</option><option>qt</option><option>gal</option>
                  <option>lb</option><option>oz (dry)</option>
                  <option>plants</option><option>bags</option><option>each</option>
                </select>
              </AStockField>
            </div>
            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
              <AStockField label="Location">
                <select style={inputA} defaultValue="chem-shed">
                  <option value="chem-shed">Chemical shed · upper shelf</option>
                  <option value="cool-room">Cool room (≤50°F)</option>
                  <option value="barn-2">Equipment barn 2</option>
                  <option value="other">Other…</option>
                </select>
              </AStockField>
              <AStockField label="Reorder at">
                <input style={inputA} placeholder="threshold" type="number" />
              </AStockField>
            </div>
          </div>

          {/* Section 4 — notes */}
          <div style={{ paddingBottom: 14 }}>
            <A_Kicker>4 · Notes (optional)</A_Kicker>
            <div style={{ marginTop: 8 }}>
              <textarea
                rows={3}
                style={{ ...inputA, minHeight: 60, resize: "vertical", fontFamily: "inherit" }}
                placeholder="Where it came from, why it's here, anything Marco or Sherry should know at spray time…"
              />
            </div>
          </div>
        </div>
      </A_Card>

      {/* Right rail — implications */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <A_Card style={{ background: "#F6F0DF", borderColor: "#E2D3A4" }}>
          <div style={{ display: "flex", gap: 10 }}>
            <Icon.Alert size={16} stroke={A.wheat} style={{ marginTop: 2 }} />
            <div>
              <div style={{ fontSize: 13, color: "#8A6722", fontWeight: 700, marginBottom: 4 }}>
                No plugin match yet
              </div>
              <div style={{ fontSize: 12.5, color: A.inkSoft, lineHeight: 1.55 }}>
                Without an EPA-registered plugin, the safety kernel cannot validate active-ingredient incompatibility, REI, PHI, or tank-mix rules for this product. Spray events that use this lot will require an explicit <strong>bypass-with-reason</strong> from an owner; helpers are blocked.
              </div>
              <button style={{
                marginTop: 10,
                background: "transparent", border: `1px solid ${A.wheat}`, color: "#8A6722",
                padding: "5px 10px", borderRadius: 6, fontSize: 11.5, fontWeight: 600, cursor: "pointer",
                fontFamily: "inherit"
              }}>
                <Icon.Plus size={11} /> Request a plugin instead
              </button>
            </div>
          </div>
        </A_Card>

        <A_Card>
          <A_Kicker>What happens after save</A_Kicker>
          <ol style={{ margin: "10px 0 0", paddingLeft: 18, color: A.inkSoft, fontSize: 12.5, lineHeight: 1.7 }}>
            <li>Lot writes to <span style={{ fontFamily: "IBM Plex Mono, ui-monospace, monospace", color: A.ink }}>stock_lots</span> + <span style={{ fontFamily: "IBM Plex Mono, ui-monospace, monospace", color: A.ink }}>stock_movements</span> as <em>received</em>.</li>
            <li>If offline, queues to Dexie and syncs on next online tick.</li>
            <li>Item appears in Stock list immediately; shopping-list shortfalls re-evaluate.</li>
            <li>If you marked it RUP, only certified applicators see it at spray time.</li>
          </ol>
        </A_Card>

        <A_Card padded={false} style={{
          padding: "12px 14px", display: "flex", gap: 10, alignItems: "center"
        }}>
          <div style={{
            width: 30, height: 30, borderRadius: 6, background: A.dividerSoft,
            display: "grid", placeItems: "center", color: A.inkSoft
          }}><Icon.FileText size={14} /></div>
          <div style={{ flex: 1, fontSize: 12, color: A.inkSoft, lineHeight: 1.4 }}>
            Attach SDS PDF or label photo — recommended for RUP items.
          </div>
          <button style={{
            background: A.paper, border: `1px solid ${A.divider}`, color: A.forestDeep,
            padding: "5px 10px", borderRadius: 6, fontSize: 11.5, fontWeight: 600, cursor: "pointer",
            fontFamily: "inherit"
          }}>Attach</button>
        </A_Card>
      </div>
    </div>
  );
}

/* ── Shared bits ───────────────────────────────────────────────── */
function AStockField({ label, hint, required, extracted, children }) {
  const A = window.A_tokens;
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11, color: A.inkSoft, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          {label}
        </span>
        {required && <span style={{ fontSize: 10, color: A.rust, fontWeight: 700 }}>· required</span>}
        {extracted && (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 3,
            fontSize: 9.5, color: A.forest, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase"
          }}><Icon.Sparkle size={10} stroke={A.forest} /> from OCR</span>
        )}
        {hint && <span style={{ fontSize: 10.5, color: A.inkMuted, marginLeft: "auto", fontFamily: "IBM Plex Mono, ui-monospace, monospace" }}>{hint}</span>}
      </div>
      {children}
    </label>
  );
}

const inputA = {
  border: `1px solid ${window.A_tokens.divider}`,
  background: window.A_tokens.paper,
  color: window.A_tokens.ink,
  padding: "8px 10px",
  borderRadius: 6,
  fontSize: 13.5,
  fontFamily: "inherit",
  outline: "none",
  width: "100%"
};

/* Sparkle icon for OCR-extracted hint */
if (!Icon.Sparkle) {
  Icon.Sparkle = (p) => (
    <svg width={p.size || 12} height={p.size || 12} viewBox="0 0 24 24" fill="none"
      stroke={p.stroke || "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v6M12 16v6M2 12h6M16 12h6M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3" />
    </svg>
  );
}

window.A_StockAddScreen = AStockAddScreen;
