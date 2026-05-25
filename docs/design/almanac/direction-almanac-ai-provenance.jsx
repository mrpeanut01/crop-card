/* Direction A — Almanac · Data provenance system
   ──────────────────────────────────────────────────────────────────
   The single source of truth for HOW CropCard prefers to populate data.
   Hard principle:  AI assists, never gates.

   Every screen pre-populates as much as it can without typing. The
   ladder for any field/recommendation is:

     1. Plugin / safety kernel rule   (deterministic, always works)
     2. Computed from your records    (your scout, calibration, history)
     3. AI proposal                   (Claude, optional, gated on key)
     4. Manual entry / edit           (last resort, always available)

   We render a small badge — A_Provenance — wherever data appears that
   the user didn't type. The tone communicates the source so anyone
   looking at a screen knows what's deterministic vs what came from AI.

   This file owns:
     • A_Provenance               — single-line badge for any data row
     • A_ProvenanceLegend         — compact legend (for screens that use
                                    multiple sources side-by-side)
     • A_DataPhilosophyArtboard   — the full reference page for the canvas
*/

/* ──────────────────────────────────────────────────────────────────
   Sources — tone, icon, label, short explanation.
   ────────────────────────────────────────────────────────────────── */
const PROV_SOURCES = {
  plugin: {
    label: "Plugin",
    long: "From a crop, input, or safety-kernel plugin",
    icon: "Lock",
    fg: "#1F3A28", bg: "#E5EEDF", bd: "#C9DBC0",
    swatch: "#2C5237",
  },
  data: {
    label: "Your data",
    long: "Derived from your records — scout, calibration, prior season",
    icon: "FileText",
    fg: "#3A586E", bg: "#DEE7EF", bd: "#BDCDD9",
    swatch: "#6F8FA8",
  },
  ai: {
    label: "AI",
    long: "Claude proposed this · always editable · falls back when off",
    icon: "Sparkle",
    fg: "#8A6722", bg: "#EFE6CC", bd: "#D9C18F",
    swatch: "#B8893C",
  },
  manual: {
    label: "You typed",
    long: "Entered or edited by you · the safety kernel still checks it",
    icon: "Edit",
    fg: "#4A4F46", bg: "#E9DFCC", bd: "#D9CFB7",
    swatch: "#7A7F75",
  },
  fallback: {
    label: "Fallback",
    long: "AI was off or unavailable — used the deterministic default",
    icon: "Refresh",
    fg: "#8A341B", bg: "#F1D9CE", bd: "#E2B69E",
    swatch: "#A64A2A",
  },
};

/* ──────────────────────────────────────────────────────────────────
   A_Provenance — small inline badge.
   Props:
     source     — "plugin" | "data" | "ai" | "manual" | "fallback"
     detail     — optional second line, e.g. "corn-bb v1.4" or "0.92"
     compact    — true for icon-only (use in dense tables)
     confidence — 0–1; AI source only. Shown as %.
*/
function A_Provenance({ source = "plugin", detail, compact = false, confidence, style = {} }) {
  const s = PROV_SOURCES[source] || PROV_SOURCES.manual;
  const G = (window.Icon || {})[s.icon] || (window.Icon || {}).Info || (() => null);
  const showConf = source === "ai" && typeof confidence === "number";

  if (compact) {
    return (
      <span
        title={`${s.label} · ${s.long}${detail ? " · " + detail : ""}${showConf ? " · " + Math.round(confidence * 100) + "%" : ""}`}
        style={{
          display: "inline-flex", alignItems: "center", gap: 3,
          padding: "1px 5px", background: s.bg, border: `1px solid ${s.bd}`,
          borderRadius: 99, fontSize: 10, fontWeight: 700, color: s.fg,
          letterSpacing: "0.04em", textTransform: "uppercase",
          fontFamily: "inherit", ...style,
        }}>
        <G size={9} stroke={s.fg} />
        {showConf && <span style={{ fontFamily: "IBM Plex Mono, ui-monospace, monospace", fontSize: 9 }}>{Math.round(confidence * 100)}%</span>}
      </span>
    );
  }

  return (
    <span
      title={s.long}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "2px 8px", background: s.bg, border: `1px solid ${s.bd}`,
        borderRadius: 99, fontSize: 10.5, fontWeight: 700, color: s.fg,
        letterSpacing: "0.04em", textTransform: "uppercase",
        fontFamily: "inherit", whiteSpace: "nowrap", ...style,
      }}>
      <G size={10} stroke={s.fg} />
      <span>{s.label}</span>
      {showConf && (
        <span style={{ fontFamily: "IBM Plex Mono, ui-monospace, monospace", fontSize: 10, fontWeight: 600, opacity: 0.85 }}>
          {Math.round(confidence * 100)}%
        </span>
      )}
      {detail && (
        <>
          <span style={{ opacity: 0.45 }}>·</span>
          <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>{detail}</span>
        </>
      )}
    </span>
  );
}

/* A_ProvenanceLegend — compact horizontal legend for screens that
   mix sources. Drop into a strip beneath the page header. */
function A_ProvenanceLegend({ shown = ["plugin", "data", "ai", "manual"], note }) {
  const A = window.A_tokens;
  return (
    <div style={{
      display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12,
      padding: "8px 14px", background: A.cream,
      border: `1px solid ${A.dividerSoft}`, borderRadius: 8,
      fontSize: 11.5, color: A.inkMuted,
    }}>
      <span style={{ fontWeight: 700, color: A.inkSoft, letterSpacing: "0.06em", textTransform: "uppercase", fontSize: 10 }}>
        Where this data came from
      </span>
      <span style={{ width: 1, height: 14, background: A.divider }} />
      {shown.map((k) => {
        const s = PROV_SOURCES[k];
        return (
          <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: s.swatch }} />
            <span style={{ color: A.ink }}>{s.label}</span>
          </span>
        );
      })}
      {note && <span style={{ marginLeft: "auto", color: A.inkMuted, fontStyle: "italic" }}>{note}</span>}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   A_DataPhilosophyArtboard — full reference page.
   Sits in the cover section so anyone landing on the file
   immediately understands the data-pre-population model.
   ────────────────────────────────────────────────────────────────── */
function A_DataPhilosophyArtboard() {
  const A = window.A_tokens;

  const ladder = [
    { kind: "plugin", weight: "PRIMARY",
      title: "Plugin / safety-kernel rule",
      what: "308 crop, input, and safety plugins shipped with the app. Compiled rules — REI, PHI, FRAC rotation, tank-mix gates, soil-temp gates, frost-date lookup, GPA dilution math.",
      examples: ["Earworm action threshold (6 moths/trap)", "Captan REI = 24 h", "Corn V8 side-dress window", "Roller-crimp window for cereal rye at anthesis"],
      always: "Always — no key, no network, no cap" },
    { kind: "data", weight: "PRIMARY",
      title: "Computed from your records",
      what: "Your scout counts, sprayer calibration, last year's harvest, soil tests, weather feed. Local SQLite — derivations run client-side.",
      examples: ["GPA 18.4 from your last UC-10 calibration", "Trap caught 8 since Sunday — your scout log", "Side-dress 80 lb N — your soil test", "Last lettuce cut was 9 days ago — your harvest log"],
      always: "Always — runs against your local DB" },
    { kind: "ai", weight: "OPTIONAL · ASSIST",
      title: "AI proposal",
      what: "Claude is offered for shaping, suggesting, and ranking — never for safety decisions. Bring-your-own key, monthly cap, per-endpoint quota.",
      examples: ["Order the planting list by your fertility approach", "Substitute K-Mag → Foliar K (matches your liquid-first preference)", "Read this photo of an unbarcoded jug", "Companion-plant a 3-sisters block from a sentence"],
      always: "Optional · gated on key · cap-aware · times out at 6 s" },
    { kind: "manual", weight: "LAST RESORT",
      title: "Manual entry / edit",
      what: "Every pre-populated value is editable. Form fields, drag-Gantt, the 'Manual entry' tab in stock-add. We never lock the user out of a typed override.",
      examples: ["Override the AI date proposal · drag the bar", "Edit an OCR'd label field before save", "Type a lot # that the photo couldn't see", "Skip the AI tier in the stock-add waterfall"],
      always: "Always — and we capture the override in the audit trail" },
  ];

  const degradation = [
    { trigger: "No key configured",
      effect: "All AI affordances vanish. Wizard shows manual-entry helper card. Stock-add's AI photo tab is greyed; the other four tabs work.",
      ux: "First-run onboarding presents the key as the 5th optional step." },
    { trigger: "Monthly cap reached",
      effect: "AI endpoints disable for the rest of the cycle. Deterministic defaults backfill silently.",
      ux: "Banner on Settings → AI. Wizard chat says 'cap reached — manual still works'." },
    { trigger: "Offline",
      effect: "AI calls skip the network. Stock-add AI photo queues OR the user picks Label OCR / Search / Manual.",
      ux: "TopBar pulse 'offline · queued'. Forms keep saving locally." },
    { trigger: "Rate-limited / timed out",
      effect: "Single endpoint falls back deterministically for ~10 min. Other endpoints unaffected.",
      ux: "Inline 'AI took too long — used the default' notice with a retry button." },
  ];

  return (
    <div className="dir-a" style={{
      width: 1440, height: 920, padding: "56px 64px",
      display: "flex", flexDirection: "column", gap: 24,
      background: `linear-gradient(180deg, ${A.paper} 0%, ${A.cream} 100%)`,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 24 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: A.inkMuted, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700 }}>
            Core principle · governs every screen
          </div>
          <div className="serif" style={{
            fontSize: 40, color: A.forestDeep, letterSpacing: "-0.02em",
            lineHeight: 1.05, marginTop: 8,
          }}>
            AI assists, never gates.
          </div>
          <div className="serif" style={{ fontSize: 17, color: A.ink, lineHeight: 1.45, marginTop: 12, maxWidth: 880 }}>
            Every form pre-populates as much as it can without typing. Quantities are usually the only thing the user enters. When a key is configured Claude proposes; when it isn't, deterministic plugin rules + your records fill the same slots. <span style={{ color: A.forestDeep, fontWeight: 600 }}>Manual entry is the floor — always reachable, never the default.</span>
          </div>
        </div>
        <div style={{
          padding: "12px 16px", border: `1px solid ${A.divider}`, borderRadius: 8,
          background: A.paper, fontSize: 12, color: A.inkSoft, lineHeight: 1.45,
          width: 280, flexShrink: 0,
        }}>
          <div style={{ fontSize: 10, color: A.inkMuted, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700, marginBottom: 5 }}>Why this matters</div>
          Sherry might have an API key; Marco (helper) might not; Dale (VDACS inspector) definitely won't. The app must feel finished for all three on first open, before they've typed anything.
        </div>
      </div>

      {/* The ladder */}
      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
          <div className="serif" style={{ fontSize: 22, color: A.forestDeep, letterSpacing: "-0.015em" }}>
            The four sources we draw from
          </div>
          <div style={{ fontSize: 12.5, color: A.inkMuted }}>
            Top to bottom — most preferred to least. Every field carries one of these badges so the user can see at a glance where the value came from.
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {ladder.map((step, i) => {
            const s = PROV_SOURCES[step.kind];
            const G = (window.Icon || {})[s.icon] || (() => null);
            return (
              <div key={step.kind} style={{
                background: A.paper, border: `1px solid ${A.divider}`,
                borderRadius: 10, padding: "16px 18px",
                display: "flex", flexDirection: "column", gap: 10, position: "relative",
                borderTop: `3px solid ${s.swatch}`,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 7, background: s.bg,
                    border: `1px solid ${s.bd}`, color: s.fg,
                    display: "grid", placeItems: "center",
                  }}>
                    <G size={14} stroke={s.fg} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 9.5, color: A.inkMuted, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                      {step.weight}
                    </div>
                    <div className="serif" style={{ fontSize: 14, color: A.forestDeep, lineHeight: 1.15, marginTop: 1, letterSpacing: "-0.005em" }}>
                      {step.title}
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: 11.5, color: A.inkSoft, lineHeight: 1.5 }}>
                  {step.what}
                </div>

                <div style={{
                  borderTop: `1px dashed ${A.dividerSoft}`, paddingTop: 8,
                  display: "flex", flexDirection: "column", gap: 5,
                }}>
                  <div style={{ fontSize: 9.5, color: A.inkMuted, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    Examples
                  </div>
                  {step.examples.map((e) => (
                    <div key={e} style={{ fontSize: 11, color: A.ink, paddingLeft: 11, position: "relative", lineHeight: 1.4 }}>
                      <span style={{ position: "absolute", left: 0, top: 6, width: 4, height: 4, borderRadius: 99, background: s.swatch }} />
                      {e}
                    </div>
                  ))}
                </div>

                <div style={{
                  marginTop: "auto", padding: "6px 8px", background: A.cream,
                  border: `1px solid ${A.dividerSoft}`, borderRadius: 4,
                  fontSize: 10.5, color: A.inkSoft, fontStyle: "italic",
                  display: "flex", alignItems: "center", gap: 5,
                }}>
                  <span style={{ width: 4, height: 4, borderRadius: 99, background: s.swatch }} />
                  {step.always}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Badge gallery + degradation map */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 16, alignItems: "stretch", flex: 1, minHeight: 0 }}>
        {/* Badge gallery */}
        <div style={{
          background: A.paper, border: `1px solid ${A.divider}`, borderRadius: 10,
          padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12,
        }}>
          <div>
            <div className="serif" style={{ fontSize: 17, color: A.forestDeep, letterSpacing: "-0.01em" }}>
              The badge — A_Provenance
            </div>
            <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 3 }}>
              Drop next to any pre-populated value. Three sizes — full, compact, in-table.
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <A_Provenance source="plugin" detail="corn-bb · v1.4" />
              <A_Provenance source="data" detail="your scout · May 24" />
              <A_Provenance source="ai" confidence={0.92} />
              <A_Provenance source="manual" detail="edited 2 min ago" />
              <A_Provenance source="fallback" detail="AI was off" />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, color: A.inkMuted, marginRight: 4, letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: 700 }}>compact</span>
              <A_Provenance source="plugin" compact />
              <A_Provenance source="data" compact />
              <A_Provenance source="ai" compact confidence={0.81} />
              <A_Provenance source="manual" compact />
            </div>
          </div>

          <div style={{
            padding: "10px 12px", background: A.cream,
            border: `1px solid ${A.dividerSoft}`, borderRadius: 6,
            display: "flex", flexDirection: "column", gap: 6,
          }}>
            <div style={{ fontSize: 10, color: A.inkMuted, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 700 }}>
              In a form row
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: A.paper, border: `1px solid ${A.dividerSoft}`, borderRadius: 5 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: A.inkMuted, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>Application rate</div>
                <div className="mono" style={{ fontSize: 13, color: A.ink, marginTop: 2 }}>1.0 qt/A</div>
              </div>
              <A_Provenance source="plugin" detail="atrazine-4l label" compact />
              <button style={{ ...A_ghostBtn, padding: "4px 9px", fontSize: 11 }}>Edit</button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: A.paper, border: `1px solid ${A.dividerSoft}`, borderRadius: 5 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: A.inkMuted, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>Sow date</div>
                <div className="mono" style={{ fontSize: 13, color: A.ink, marginTop: 2 }}>Jun 2 — 3 d after corn V2</div>
              </div>
              <A_Provenance source="ai" confidence={0.88} compact />
              <button style={{ ...A_ghostBtn, padding: "4px 9px", fontSize: 11 }}>Edit</button>
            </div>
          </div>

          <div style={{ fontSize: 10.5, color: A.inkMuted, lineHeight: 1.55, marginTop: "auto", paddingTop: 4, borderTop: `1px dashed ${A.dividerSoft}` }}>
            Helper-role hint: helpers cannot release plugin-restricted lots, and cannot override safety-kernel decisions even via manual entry. Owner is the only role that can edit AI fallback choices in the audit trail.
          </div>
        </div>

        {/* Degradation map */}
        <div style={{
          background: A.paper, border: `1px solid ${A.divider}`, borderRadius: 10,
          padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10,
        }}>
          <div>
            <div className="serif" style={{ fontSize: 17, color: A.forestDeep, letterSpacing: "-0.01em" }}>
              How it degrades — and where the user sees that
            </div>
            <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 3 }}>
              Failure of the AI tier never blocks a flow. Every trigger has a deterministic fallback and a small surface that communicates the swap.
            </div>
          </div>
          <div style={{
            display: "grid", gridTemplateColumns: "auto 1.2fr 1.2fr",
            border: `1px solid ${A.dividerSoft}`, borderRadius: 6, overflow: "hidden",
          }}>
            <div style={{ padding: "6px 10px", background: A.cream, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: A.inkMuted, borderRight: `1px solid ${A.dividerSoft}` }}>Trigger</div>
            <div style={{ padding: "6px 10px", background: A.cream, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: A.inkMuted, borderRight: `1px solid ${A.dividerSoft}` }}>Behind the scenes</div>
            <div style={{ padding: "6px 10px", background: A.cream, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: A.inkMuted }}>What Sherry sees</div>
            {degradation.map((d) => (
              <React.Fragment key={d.trigger}>
                <div style={{ padding: "8px 10px", borderTop: `1px solid ${A.dividerSoft}`, borderRight: `1px solid ${A.dividerSoft}`, fontSize: 11.5, color: A.ink, fontWeight: 600, whiteSpace: "nowrap" }}>
                  {d.trigger}
                </div>
                <div style={{ padding: "8px 10px", borderTop: `1px solid ${A.dividerSoft}`, borderRight: `1px solid ${A.dividerSoft}`, fontSize: 11.5, color: A.inkSoft, lineHeight: 1.45 }}>
                  {d.effect}
                </div>
                <div style={{ padding: "8px 10px", borderTop: `1px solid ${A.dividerSoft}`, fontSize: 11.5, color: A.inkSoft, lineHeight: 1.45 }}>
                  {d.ux}
                </div>
              </React.Fragment>
            ))}
          </div>

          <div style={{
            marginTop: 4, padding: "10px 12px",
            background: PROV_SOURCES.fallback.bg, border: `1px solid ${PROV_SOURCES.fallback.bd}`,
            borderRadius: 6, fontSize: 11.5, color: PROV_SOURCES.fallback.fg, lineHeight: 1.5,
            display: "flex", gap: 8, alignItems: "flex-start",
          }}>
            <Icon.Refresh size={14} stroke={PROV_SOURCES.fallback.fg} style={{ marginTop: 1, flexShrink: 0 }} />
            <span>
              <strong>Fallback is a real provenance state.</strong> When a field would have been AI-proposed but the deterministic default ran instead, the audit trail records both — and the user sees the <em>Fallback</em> badge with a one-tap "ask AI now" if they later add a key.
            </span>
          </div>
        </div>
      </div>

      <div style={{
        paddingTop: 10, borderTop: `1px solid ${A.dividerSoft}`,
        display: "flex", justifyContent: "space-between", alignItems: "center",
        fontSize: 11, color: A.inkMuted,
      }}>
        <div>Cross-refs · Settings → AI assistant · Stock add (5 methods) · Wizard (chat panel) · Plan v2 (per-planting provenance)</div>
        <div className="mono">A_Provenance · A_ProvenanceLegend · window.PROV_SOURCES</div>
      </div>
    </div>
  );
}

/* Globals */
Object.assign(window, {
  A_Provenance,
  A_ProvenanceLegend,
  A_DataPhilosophyArtboard,
  PROV_SOURCES,
});
