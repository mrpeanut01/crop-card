/* Direction A — Almanac · Planning Wizard
   Full-page wizard at /plan/wizard. Same top nav. Five steps share
   a chrome (stepper rail + chat panel). Steps:
     0 Season setup    — philosophy, fertility, irrigation, records
     1 Allocation      — what goes where  (deferred — second pass)
     2 Schedule        — when to plant each, with AI date proposals
     3 Inputs plan     — what to spray/fertilize per planting (deferred)
     4 Commit          — review + write to DB (deferred)
*/

/* ── Shared chrome ────────────────────────────────────────────── */
function AWizardHeader({ activeStepId }) {
  const A = window.A_tokens;
  const sp = MOCK.seasonPlan;

  const stateCfg = {
    "done":        { bg: A.forest,   fg: A.cream,    bd: A.forest,   ico: "Check" },
    "in-progress": { bg: A.wheat,    fg: A.cream,    bd: A.wheat,    ico: "ChevronRight" },
    "stale":       { bg: "#F1D9CE",  fg: "#8A341B",  bd: "#E2B69E",  ico: "Alert" },
    "pending":     { bg: A.paper,    fg: A.inkMuted, bd: A.divider,  ico: null },
    "active":      { bg: A.forest,   fg: A.cream,    bd: A.forest,   ico: null },
  };

  return (
    <div style={{ background: A.paper, borderBottom: `1px solid ${A.divider}` }}>
      {/* Title row */}
      <div style={{ padding: "16px 28px 12px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: A.inkMuted, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
            <Icon.Sprout size={12} stroke={A.forest} /> Season {sp.year} plan · wizard
          </div>
          <h1 className="serif" style={{ margin: "4px 0 0", fontSize: 22, color: A.forestDeep, letterSpacing: "-0.015em" }}>
            {({
              setup:    "Season setup",
              alloc:    "Allocate plantings to blocks",
              schedule: "Schedule planting dates",
              inputs:   "Plan inputs & shopping list",
              commit:   "Review & commit",
            })[activeStepId] || "Season plan"}
          </h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={{ ...A_ghostBtn, padding: "8px 12px", fontSize: 13 }}>
            <Icon.X size={13} /> Exit
          </button>
          <button style={{ ...A_ghostBtn, padding: "8px 12px", fontSize: 13 }}>
            <Icon.FileText size={13} /> Save & resume later
          </button>
        </div>
      </div>

      {/* Stepper */}
      <div style={{ padding: "0 28px 12px", display: "flex", alignItems: "center", gap: 0 }}>
        {sp.steps.map((s, i, arr) => {
          const isActive = s.id === activeStepId;
          const c = stateCfg[isActive ? "active" : s.state];
          const G = c.ico ? Icon[c.ico] : null;
          return (
            <React.Fragment key={s.id}>
              <button title={s.note + (s.when ? ` — ${s.when}` : "")} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 12px", border: "none", borderRadius: 8,
                background: isActive ? "#EFE6CC" : "transparent",
                fontFamily: "inherit", cursor: "pointer",
              }}>
                <span style={{
                  width: 24, height: 24, borderRadius: 99,
                  background: c.bg, border: `1.5px solid ${c.bd}`, color: c.fg,
                  display: "grid", placeItems: "center", fontSize: 10.5, fontWeight: 700,
                  flexShrink: 0,
                }}>
                  {G ? <G size={12} /> : (i + 1)}
                </span>
                <div style={{ textAlign: "left", lineHeight: 1.2 }}>
                  <div style={{ fontSize: 12.5, color: isActive ? A.forestDeep : A.ink, fontWeight: isActive ? 700 : 600 }}>{s.label}</div>
                  <div style={{ fontSize: 10.5, color: s.state === "stale" ? "#8A341B" : A.inkMuted, marginTop: 1 }}>
                    {s.state === "done" && `✓ ${s.when}`}
                    {s.state === "in-progress" && `${s.when} · in progress`}
                    {s.state === "stale" && `Stale · refresh`}
                    {s.state === "pending" && `Pending`}
                  </div>
                </div>
              </button>
              {i < arr.length - 1 && (
                <div style={{ flex: 1, minWidth: 16, height: 2, background: s.state === "done" ? A.forest : A.dividerSoft, opacity: s.state === "done" ? 0.4 : 1, borderRadius: 99 }} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

/* ── Chat rail (right side) — gated on AI availability ─────────── */
function AWizardChat({ enabled }) {
  const A = window.A_tokens;
  const m = MOCK.wizardChat;
  // Default to global AI flag if no explicit prop. Lets every wizard step
  // hide the chat in lockstep when the user has no API key configured.
  const isEnabled = enabled !== undefined ? enabled : (MOCK.aiEnabled !== false);

  // AI-off variant: show a compact panel that explains the missing key
  // and offers manual entry. Mirrors the offline-first ethos — wizard
  // must work fully without an API key.
  if (!isEnabled) {
    return (
      <div style={{
        width: 360, flexShrink: 0,
        borderLeft: `1px solid ${A.divider}`, background: A.paper,
        display: "flex", flexDirection: "column", height: "100%",
      }}>
        <div style={{ padding: "14px 18px 12px", borderBottom: `1px solid ${A.dividerSoft}`, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: A.dividerSoft, color: A.inkMuted, display: "grid", placeItems: "center" }}>
            <Icon.Leaf size={15} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="serif" style={{ fontSize: 14, color: A.inkSoft }}>Planning assistant</div>
            <div style={{ fontSize: 10.5, color: A.inkMuted, marginTop: 1 }}>off · manual mode</div>
          </div>
        </div>
        <div style={{ padding: 18, flex: 1, overflow: "auto" }}>
          <div style={{ padding: "14px 14px", background: A.cream, border: `1px dashed ${A.divider}`, borderRadius: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Icon.Info size={14} stroke={A.inkSoft} />
              <span style={{ fontSize: 12.5, color: A.inkSoft, fontWeight: 700 }}>AI assistant is off</span>
            </div>
            <div style={{ fontSize: 12, color: A.inkMuted, lineHeight: 1.55 }}>
              No Claude API key configured, or your monthly cap was reached. The wizard still works fully — every step
              supports manual entry: drag the Gantt bars, edit rows inline, or use the picker dialogs.
            </div>
            <a style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 10, fontSize: 12.5, color: A.forest, fontWeight: 600 }}>
              Set up your API key in Settings <Icon.ArrowRight size={12} />
            </a>
          </div>
          <div style={{ marginTop: 16 }}>
            <A_Kicker>Manual entry shortcuts</A_Kicker>
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                ["Drag any Gantt bar",  "Move the planting date · resize edges to adjust window"],
                ["Double-click a row",  "Open the full edit form for that planting"],
                ["+ Add planting row",  "Insert a new row at the bottom · no AI needed"],
                ["Import from last year","Settings → Records → CSV import"],
              ].map(([k, v]) => (
                <div key={k} style={{ padding: "8px 10px", background: A.paper, border: `1px solid ${A.dividerSoft}`, borderRadius: 6 }}>
                  <div style={{ fontSize: 12, color: A.ink, fontWeight: 600 }}>{k}</div>
                  <div style={{ fontSize: 11, color: A.inkMuted, marginTop: 2, lineHeight: 1.45 }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ padding: "10px 14px", borderTop: `1px solid ${A.dividerSoft}`, background: A.cream, fontSize: 11, color: A.inkMuted, display: "flex", alignItems: "center", gap: 6 }}>
          <Icon.Lock size={11} /> Offline-first · every wizard step writes locally first
        </div>
      </div>
    );
  }

  // AI-enabled variant (original)
  return (
    <div style={{
      width: 360, flexShrink: 0,
      borderLeft: `1px solid ${A.divider}`, background: A.paper,
      display: "flex", flexDirection: "column", height: "100%",
    }}>
      {/* Header */}
      <div style={{ padding: "14px 18px 12px", borderBottom: `1px solid ${A.dividerSoft}`, display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: A.forest, color: A.cream, display: "grid", placeItems: "center" }}>
          <Icon.Leaf size={15} />
        </div>
        <div style={{ flex: 1 }}>
          <div className="serif" style={{ fontSize: 14, color: A.forestDeep }}>Planning assistant</div>
          <div style={{ fontSize: 10.5, color: A.inkMuted, marginTop: 1 }}>haiku-4-5 · grounded on your plugins</div>
        </div>
        <button title="History" style={{ ...A_iconBtn, width: 28, height: 28 }}><Icon.FileText size={12} /></button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflow: "auto", padding: "14px 16px" }}>
        {m.map((msg, i) => (
          <div key={i} style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              {msg.role === "ai" ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: A.forestDeep, letterSpacing: "0.05em" }}>
                  <Icon.Leaf size={11} /> Assistant
                </span>
              ) : (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: A.inkSoft, letterSpacing: "0.05em" }}>
                  <Icon.User size={11} /> Sherry
                </span>
              )}
              <span style={{ fontSize: 10.5, color: A.inkMuted, fontFamily: "IBM Plex Mono" }}>{msg.time}</span>
            </div>
            <div style={{
              padding: "10px 12px", borderRadius: 8,
              background: msg.role === "ai" ? A.cream : "#EFE6CC",
              border: `1px solid ${msg.role === "ai" ? A.dividerSoft : "#E0D4AA"}`,
              fontSize: 12.5, color: A.ink, lineHeight: 1.5, whiteSpace: "pre-wrap",
            }}>
              {msg.text}
            </div>
            {msg.actions && (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                {msg.actions.map((a) => (
                  <button key={a.label} style={{
                    padding: "8px 12px", borderRadius: 6, fontSize: 12.5, fontWeight: 600,
                    background: a.kind === "accept" ? A.forest : "transparent",
                    color: a.kind === "accept" ? A.cream : A.forestDeep,
                    border: a.kind === "accept" ? "none" : `1px solid ${A.divider}`,
                    fontFamily: "inherit", textAlign: "left", display: "flex", alignItems: "center", gap: 7, cursor: "pointer",
                  }}>
                    {a.kind === "accept" && <Icon.Check size={13} />}
                    {a.kind === "modify" && <Icon.Wrench size={13} />}
                    {a.kind === "reject" && <Icon.X size={13} />}
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Composer */}
      <div style={{ padding: "12px 14px", borderTop: `1px solid ${A.dividerSoft}`, background: A.cream }}>
        <div style={{
          background: A.paper, border: `1px solid ${A.divider}`, borderRadius: 8,
          padding: "8px 10px", display: "flex", alignItems: "flex-end", gap: 8,
        }}>
          <textarea placeholder="Ask the assistant — e.g. 'push squash to Jun 8'…" style={{
            flex: 1, border: "none", background: "transparent", outline: "none",
            fontFamily: "inherit", fontSize: 12.5, color: A.ink, resize: "none",
            minHeight: 22, maxHeight: 80,
          }} />
          <button title="Send" style={{
            width: 32, height: 32, borderRadius: 6, background: A.forest, color: A.cream,
            border: "none", display: "grid", placeItems: "center", cursor: "pointer", flexShrink: 0,
          }}><Icon.ArrowRight size={14} /></button>
        </div>
        <div style={{ display: "flex", gap: 5, marginTop: 8, flexWrap: "wrap" }}>
          {["Re-derive schedule", "Check soil-temp gates", "Add a succession", "Explain this step"].map((q) => (
            <button key={q} title={`Quick prompt: ${q}`} style={{
              padding: "3px 9px", borderRadius: 99, background: A.paper, border: `1px solid ${A.divider}`,
              fontSize: 11, color: A.inkSoft, fontFamily: "inherit", cursor: "pointer",
            }}>{q}</button>
          ))}
        </div>
        <div style={{ marginTop: 8, fontSize: 10.5, color: A.inkMuted, display: "flex", alignItems: "center", gap: 5 }}>
          <Icon.Lock size={10} /> Assistant can only substitute within plugin rules — never bypasses safety.
        </div>
      </div>
    </div>
  );
}

/* ── Step nav (continue/back) ─────────────────────────────────── */
function AWizardFooter({ backLabel = "Back", nextLabel = "Continue", canContinue = true, summary = null }) {
  const A = window.A_tokens;
  return (
    <div style={{
      position: "sticky", bottom: 0, background: A.paper,
      borderTop: `1px solid ${A.divider}`, padding: "14px 28px",
      display: "flex", alignItems: "center", gap: 14,
    }}>
      <button style={A_ghostBtn}>
        <Icon.ChevronRight size={14} style={{ transform: "rotate(180deg)" }} /> {backLabel}
      </button>
      {summary && <div style={{ fontSize: 12.5, color: A.inkSoft }}>{summary}</div>}
      <button style={{ ...A_primaryBtn, opacity: canContinue ? 1 : 0.5, marginLeft: "auto" }} disabled={!canContinue}>
        {nextLabel} <Icon.ArrowRight size={14} />
      </button>
    </div>
  );
}

/* ── Step 0 · Season setup ────────────────────────────────────── */
function AWizardSetupScreen() {
  const A = window.A_tokens;
  const ss = MOCK.seasonSetup;

  const philOpts = [
    { id: "organic",      label: "Organic",       sub: "USDA NOP-aligned · no synthetics · approved-list only", icon: "Leaf" },
    { id: "ipm",          label: "IPM",           sub: "Integrated Pest Management · scout-driven · economic thresholds", icon: "Eye" },
    { id: "conventional", label: "Conventional",  sub: "Full chemistry palette · safety-kernel still enforced", icon: "Beaker" },
    { id: "transitioning",label: "Transitioning", sub: "Phase out synthetics on a 3-year clock per NOP §205.202", icon: "Sprout" },
  ];

  const tillOpts = [
    { id: "no-till",          label: "No-till",          sub: "Drilled into residue. Cover-crop termination + weed control via herbicide or roller-crimper. Soil structure stays intact.", icon: "Layers" },
    { id: "strip-till",       label: "Strip-till",       sub: "Narrow till strips for planting only. Mixed strategy — selective spray + residue mulch between rows.", icon: "Field" },
    { id: "reduced-till",     label: "Reduced-till",     sub: "Light cultivation (2-3 passes) combined with selective post-emerge sprays. Most flexible.", icon: "Tractor" },
    { id: "conventional-till",label: "Conventional till",sub: "Full prep + multiple inter-row cultivations. Mechanical weed control primary; herbicides supplementary.", icon: "Wrench" },
  ];

  // Computed implications based on philosophy × tillage interaction
  const implications = implicationsFor(ss.philosophy, ss.tillage);

  const fertOpts = [
    { id: "synthetic-led",            label: "Synthetic-led",         sub: "Urea/AN/UAN as primary N · supplemented with manure or cover" },
    { id: "balanced",                 label: "Balanced (recommended)", sub: "Synthetic + organic amendments + cover-crop credits stacked" },
    { id: "organic-amendment-led",    label: "Amendment-led",          sub: "Compost, manure, fish emulsion, kelp · cover credits dominate" },
  ];

  const irrOpts = [
    { id: "rainfed",              label: "Rainfed only" },
    { id: "rainfed-supplemental", label: "Rainfed + supplemental" },
    { id: "drip",                 label: "Drip lines" },
    { id: "overhead",             label: "Overhead sprinkler" },
  ];

  const recOpts = [
    { id: "minimal",         label: "Minimal",        sub: "Personal records only · no exports needed" },
    { id: "csa-disclosure",  label: "CSA disclosure", sub: "Member-facing transparency · CSV summary per planting" },
    { id: "vdacs-audit",     label: "VDACS audit",    sub: "Full pesticide record per FR-09 · 2-yr retention · PDF export" },
  ];

  return (
    <div className="dir-a" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <A_TopBar active="plan" />
      <AWizardHeader activeStepId="setup" />
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Main */}
        <div style={{ flex: 1, overflow: "auto", padding: "24px 32px 24px", background: A.cream }}>
          <div style={{ maxWidth: 760 }}>
            <p style={{ fontSize: 14, color: A.inkSoft, lineHeight: 1.55, marginTop: 0 }}>
              These six answers shape every downstream step — what crops we allocate, what fertility plan we build,
              which products the safety kernel even lets you reach for. <strong>Carry-forward</strong> uses last year's
              answers as defaults.
            </p>

            <AWizardField label="Crop-protection philosophy" hint="Drives the product allow-list — what insecticides, herbicides, and fungicides the safety kernel even lets you reach for. Change mid-season triggers re-validation.">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {philOpts.map((o) => {
                  const G = Icon[o.icon];
                  const sel = o.id === ss.philosophy;
                  return (
                    <button key={o.id} style={tileBtnA(sel, A)}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 5 }}>
                        <div style={{
                          width: 30, height: 30, borderRadius: 6,
                          background: sel ? A.forest : "#E5EEDF", color: sel ? A.cream : A.forest,
                          display: "grid", placeItems: "center",
                        }}><G size={15} /></div>
                        <span className="serif" style={{ fontSize: 15.5, color: A.ink, fontWeight: 600 }}>{o.label}</span>
                        {sel && <Icon.Check size={15} style={{ marginLeft: "auto", color: A.forest }} />}
                      </div>
                      <div style={{ fontSize: 12, color: A.inkMuted, lineHeight: 1.45 }}>{o.sub}</div>
                    </button>
                  );
                })}
              </div>
            </AWizardField>

            <AWizardField label="Tillage strategy" hint="Determines how weeds get controlled — mechanical (cultivation) vs. chemical (herbicide) vs. residue/cover-based. Interacts with the philosophy above.">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {tillOpts.map((o) => {
                  const G = Icon[o.icon];
                  const sel = o.id === ss.tillage;
                  return (
                    <button key={o.id} style={tileBtnA(sel, A)}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 5 }}>
                        <div style={{
                          width: 30, height: 30, borderRadius: 6,
                          background: sel ? A.forest : "#E5EEDF", color: sel ? A.cream : A.forest,
                          display: "grid", placeItems: "center",
                        }}><G size={15} /></div>
                        <span className="serif" style={{ fontSize: 15.5, color: A.ink, fontWeight: 600 }}>{o.label}</span>
                        {sel && <Icon.Check size={15} style={{ marginLeft: "auto", color: A.forest }} />}
                      </div>
                      <div style={{ fontSize: 12, color: A.inkMuted, lineHeight: 1.45 }}>{o.sub}</div>
                    </button>
                  );
                })}
              </div>
            </AWizardField>

            {/* Implications card — what philosophy × tillage enables/restricts */}
            <div style={{
              padding: "16px 18px", marginBottom: 22,
              background: implications.warn ? "#FBF1E5" : "#EFF6E9",
              border: `1px solid ${implications.warn ? "#E0C988" : "#C9DBC0"}`,
              borderLeft: `4px solid ${implications.warn ? A.wheat : A.forest}`,
              borderRadius: 8,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                {implications.warn
                  ? <Icon.Alert size={15} stroke={A.wheat} />
                  : <Icon.CheckCircle size={15} stroke={A.forest} />}
                <span style={{ fontSize: 11, fontWeight: 700, color: implications.warn ? "#8A6722" : A.forestDeep, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                  {implications.warn ? "Guardrails — review before continuing" : "Guardrails in effect"}
                </span>
                <span className="serif" style={{ marginLeft: "auto", fontSize: 13.5, color: A.ink }}>
                  {implications.title}
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <div style={{ fontSize: 11, color: A.inkMuted, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>What this enables</div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: A.ink, lineHeight: 1.55 }}>
                    {implications.enables.map((e, i) => <li key={i} style={{ marginBottom: 3 }}>{e}</li>)}
                  </ul>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: A.inkMuted, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>What gets restricted</div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: A.ink, lineHeight: 1.55 }}>
                    {implications.restricts.map((r, i) => <li key={i} style={{ marginBottom: 3 }}>{r}</li>)}
                  </ul>
                </div>
              </div>
              {implications.notes && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${implications.warn ? "#E0C988" : "#C9DBC0"}`, fontSize: 11.5, color: A.inkSoft, fontStyle: "italic", lineHeight: 1.5 }}>
                  {implications.notes}
                </div>
              )}
            </div>

            <AWizardField label="Fertility approach" hint="Sets N source priority and override thresholds.">
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                {fertOpts.map((o) => {
                  const sel = o.id === ss.fertilityApproach;
                  return (
                    <button key={o.id} style={{
                      ...rowBtnA(sel, A), display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, alignItems: "center", textAlign: "left",
                    }}>
                      <span style={{
                        width: 18, height: 18, borderRadius: 99,
                        border: `2px solid ${sel ? A.forest : A.divider}`,
                        background: sel ? A.forest : "transparent",
                        display: "grid", placeItems: "center", flexShrink: 0,
                      }}>{sel && <span style={{ width: 7, height: 7, borderRadius: 99, background: A.cream }} />}</span>
                      <div>
                        <div style={{ fontSize: 14, color: A.ink, fontWeight: 600 }}>{o.label}</div>
                        <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 2 }}>{o.sub}</div>
                      </div>
                      {sel && <Icon.Check size={14} stroke={A.forest} />}
                    </button>
                  );
                })}
              </div>
            </AWizardField>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
              <AWizardField label="Irrigation strategy" hint="Sets DTM adjustments + drought-risk scout cadence.">
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {irrOpts.map((o) => {
                    const sel = o.id === ss.irrigationStrategy;
                    return (
                      <button key={o.id} style={chipBtnA(sel, A)}>{o.label}</button>
                    );
                  })}
                </div>
              </AWizardField>

              <AWizardField label="Record-keeping tier" hint="Determines export columns + retention rules.">
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {recOpts.map((o) => {
                    const sel = o.id === ss.recordKeepingTier;
                    return (
                      <button key={o.id} title={o.sub} style={chipBtnA(sel, A)}>{o.label}</button>
                    );
                  })}
                </div>
              </AWizardField>
            </div>

            <AWizardField label="Currently transitioning to organic?" hint="Sets the 3-year synthetic-phaseout clock per NOP §205.202.">
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {[["No", false], ["Yes", true]].map(([l, v]) => {
                  const sel = ss.transitioning === v;
                  return <button key={l} style={chipBtnA(sel, A)}>{l}</button>;
                })}
                {ss.transitioning && (
                  <div style={{ marginLeft: 12, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12.5, color: A.inkMuted }}>Started year</span>
                    <input type="number" defaultValue={2024} style={{
                      width: 80, padding: "6px 8px", border: `1px solid ${A.divider}`, borderRadius: 6,
                      background: A.paper, color: A.ink, fontFamily: "IBM Plex Mono, monospace", fontSize: 13,
                    }} />
                  </div>
                )}
              </div>
            </AWizardField>

            <AWizardField label="Helper users this season" hint="Helpers can record sprays + scout notes but cannot override custom rates.">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button style={{ ...A_iconBtn, width: 34, height: 34 }}><Icon.Plus size={14} style={{ transform: "rotate(45deg)" }} /></button>
                <span className="mono" style={{ fontSize: 18, color: A.ink, fontWeight: 700, minWidth: 32, textAlign: "center" }}>{ss.helperRoles}</span>
                <button style={{ ...A_iconBtn, width: 34, height: 34 }}><Icon.Plus size={14} /></button>
                <a style={{ marginLeft: 8, fontSize: 12.5, color: A.forest, fontWeight: 600 }}>Invite a helper →</a>
              </div>
            </AWizardField>
          </div>
        </div>
        <AWizardChat />
      </div>
      <AWizardFooter
        backLabel="Cancel"
        nextLabel="Continue to allocation"
        summary={<>Carry-forward from 2025 · <strong>4 of 6</strong> fields match last year</>}
      />
    </div>
  );
}

function AWizardField({ label, hint, children }) {
  const A = window.A_tokens;
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ marginBottom: 10 }}>
        <div className="serif" style={{ fontSize: 16, color: A.forestDeep, letterSpacing: "-0.01em" }}>{label}</div>
        {hint && <div style={{ fontSize: 12, color: A.inkMuted, marginTop: 3, maxWidth: 600 }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function tileBtnA(selected, A) {
  return {
    textAlign: "left", padding: "12px 14px",
    background: selected ? "#EFE6CC" : A.paper,
    border: selected ? `2px solid ${A.forest}` : `1px solid ${A.divider}`,
    borderRadius: 8, fontFamily: "inherit", cursor: "pointer",
  };
}
function rowBtnA(selected, A) {
  return {
    padding: "10px 14px", background: selected ? "#EFE6CC" : A.paper,
    border: selected ? `1px solid ${A.forest}` : `1px solid ${A.divider}`,
    borderRadius: 8, fontFamily: "inherit", cursor: "pointer",
  };
}
function chipBtnA(selected, A) {
  return {
    padding: "7px 14px", borderRadius: 99,
    background: selected ? A.forest : A.paper,
    border: `1px solid ${selected ? A.forest : A.divider}`,
    color: selected ? A.cream : A.inkSoft,
    fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
  };
}

/* ── Step 2 · Schedule ────────────────────────────────────────── */
function AWizardScheduleScreen({ aiEnabled }) {
  const A = window.A_tokens;
  const m = MOCK;
  const rows = m.scheduleProposals;
  const proposedCount = rows.filter((r) => r.status === "proposed").length;
  const [scheduleZoom, setScheduleZoom] = React.useState("month");
  // Gantt zoom data — same rows, different axis ranges + bar percentages.
  // Lets the user see a month detail, the whole season, or a full-year view.
  const gantt = ({
    month: {
      axis: ["May 8", "May 15", "May 22", "May 29", "Jun 5", "Jun 12", "Jun 19", "Jun 26"],
      todayPct: 37,
      bars: {
        a1: [{ s: 4,  e: 100, label: "planted ✓ · growing through window", tone: A.forest, dim: true }],
        a2: [{ s: 36, e: 60,  label: "→ sow window opens", tone: "#7a3a4d", marker: true }, { s: 60, e: 100, label: "vine + pod fill", tone: "#7a3a4d", dim: true }],
        a3: [{ s: 50, e: 70,  label: "→ sow window opens", tone: "#a85a1f", marker: true }, { s: 70, e: 100, label: "vine extension", tone: "#a85a1f", dim: true }],
        b1: [{ s: 40, e: 56,  label: "→ transplant", tone: "#a23a3a", marker: true }, { s: 56, e: 100, label: "fruit set onward", tone: "#a23a3a", dim: true }],
        b2: [{ s: 40, e: 56,  label: "→ transplant border", tone: "#d99a3a", marker: true }, { s: 56, e: 100, label: "season-long bloom", tone: "#d99a3a", dim: true }],
        d1: [{ s: 0,  e: 30,  label: "planted ✓ · cut & come again", tone: "#4a8b54", dim: true }, { s: 30, e: 60, label: "harvest peak", tone: A.wheat, dim: true }],
        g1: [{ s: 0,  e: 100, label: "planted ✓ · V6 growing", tone: "#8a5a2c", dim: true }],
      },
    },
    season: {
      axis: ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"],
      todayPct: 28,
      bars: {
        a1: [{ s: 22, e: 26, label: "sow ✓", tone: "#c9961f", marker: true }, { s: 26, e: 82, label: "V → R6 grain fill", tone: "#c9961f", dim: true }, { s: 82, e: 92, label: "harvest", tone: A.wheat, dim: true }],
        a2: [{ s: 30, e: 34, label: "→ sow", tone: "#7a3a4d", marker: true }, { s: 34, e: 75, label: "vine + pod fill", tone: "#7a3a4d", dim: true }, { s: 75, e: 82, label: "harvest", tone: A.wheat, dim: true }],
        a3: [{ s: 36, e: 40, label: "→ sow", tone: "#a85a1f", marker: true }, { s: 40, e: 90, label: "vine extension", tone: "#a85a1f", dim: true }, { s: 90, e: 100, label: "harvest", tone: A.wheat, dim: true }],
        b1: [{ s: 32, e: 36, label: "→ transplant", tone: "#a23a3a", marker: true }, { s: 36, e: 70, label: "fruit set + pick", tone: "#a23a3a", dim: true }, { s: 70, e: 85, label: "harvest", tone: A.wheat, dim: true }],
        b2: [{ s: 32, e: 100, label: "season-long bloom", tone: "#d99a3a", dim: true }],
        d1: [{ s: 0, e: 28, label: "planted ✓ · grow", tone: "#4a8b54", dim: true }, { s: 28, e: 40, label: "harvest peak", tone: A.wheat, dim: true }],
        g1: [{ s: 18, e: 22, label: "sow ✓", tone: "#8a5a2c", marker: true }, { s: 22, e: 84, label: "V → R6 grain fill", tone: "#8a5a2c", dim: true }, { s: 84, e: 94, label: "harvest", tone: A.wheat, dim: true }],
      },
    },
    year: {
      axis: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
      todayPct: 40,
      bars: {
        a1: [{ s: 36, e: 88, label: "Bloody Butcher Corn · sow → R6 → harvest", tone: "#c9961f", dim: true }],
        a2: [{ s: 40, e: 80, label: "Cherokee Bean", tone: "#7a3a4d", dim: true }],
        a3: [{ s: 42, e: 92, label: "Seminole Pumpkin", tone: "#a85a1f", dim: true }],
        b1: [{ s: 40, e: 82, label: "Brandywine Tomato", tone: "#a23a3a", dim: true }],
        b2: [{ s: 40, e: 92, label: "French Marigold", tone: "#d99a3a", dim: true }],
        d1: [{ s: 24, e: 50, label: "Lettuce mix (spring)", tone: "#4a8b54", dim: true }, { s: 70, e: 92, label: "Lettuce mix (fall succession)", tone: "#4a8b54", dim: true }],
        g1: [{ s: 34, e: 90, label: "Painted Mtn Corn", tone: "#8a5a2c", dim: true }],
      },
    },
  })[scheduleZoom];

  return (
    <div className="dir-a" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <A_TopBar active="plan" />
      <AWizardHeader activeStepId="schedule" />
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ flex: 1, overflow: "auto", padding: "20px 28px", background: A.cream }}>
          <div style={{ maxWidth: 840 }}>
            {/* Stale callout */}
            <div style={{
              padding: "14px 18px", marginBottom: 18,
              background: "#F1D9CE", border: `1px solid #E2B69E`,
              borderRadius: 10, display: "flex", alignItems: "flex-start", gap: 12,
            }}>
              <Icon.Alert size={18} stroke="#8A341B" style={{ marginTop: 2 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, color: "#6E2A13", fontWeight: 700 }}>Schedule is stale on Block A</div>
                <div style={{ fontSize: 12.5, color: "#6E2A13", marginTop: 3, lineHeight: 1.5 }}>
                  You added <strong>Cherokee Bean</strong> and <strong>Seminole Pumpkin</strong> to the Three Sisters
                  polyculture after the last schedule commit. The assistant re-derived sowing dates from the 3-sisters
                  companion plugin — 2 proposals below.
                </div>
              </div>
              <button style={{ ...A_primaryBtn, padding: "8px 12px", fontSize: 13, flexShrink: 0 }}>
                Accept both <Icon.Check size={13} />
              </button>
            </div>

            {/* Calendar — one row per planting, like Plan v2's combined timeline */}
            <A_Card style={{ marginBottom: 16 }} padded={false}>
              <div style={{ padding: "14px 18px 10px", borderBottom: `1px solid ${A.dividerSoft}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <h3 className="serif" style={{ margin: 0, fontSize: 16, color: A.forestDeep }}>Sow & transplant timeline</h3>
                  <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 2 }}>
                    <Icon.Wrench size={11} style={{ verticalAlign: "middle", marginRight: 4 }} />
                    Drag bars to adjust dates · drag edges to resize · double-click a row to edit · works fully offline
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {/* Zoom */}
                  <div style={{ display: "flex", gap: 0, background: A.cream, border: `1px solid ${A.divider}`, borderRadius: 99, padding: 2 }}>
                    {[
                      ["month",  "Month"],
                      ["season", "Season"],
                      ["year",   "Year"],
                    ].map(([z, l]) => {
                      const sel = scheduleZoom === z;
                      return (
                        <button key={z} onClick={() => setScheduleZoom(z)} style={{
                          padding: "5px 12px", borderRadius: 99, fontSize: 11.5, fontWeight: 600,
                          background: sel ? A.forest : "transparent",
                          color: sel ? A.cream : A.inkSoft,
                          border: "none", fontFamily: "inherit", cursor: "pointer",
                        }}>{l}</button>
                      );
                    })}
                  </div>
                  {/* Scroll pager (placeholder — for ranges wider than fit) */}
                  <button title="Pan earlier" style={{ ...A_iconBtn, width: 28, height: 28 }}>
                    <Icon.ChevronRight size={13} style={{ transform: "rotate(180deg)" }} />
                  </button>
                  <button title="Pan later" style={{ ...A_iconBtn, width: 28, height: 28 }}>
                    <Icon.ChevronRight size={13} />
                  </button>
                </div>
              </div>

              {/* X-axis */}
              <div style={{ display: "grid", gridTemplateColumns: "200px 1fr 36px", gap: 14, padding: "10px 18px 4px", borderBottom: `1px solid ${A.dividerSoft}` }}>
                <div />
                <div style={{ position: "relative", height: 18 }}>
                  {gantt.axis.map((d, i) => (
                    <span key={d + i} style={{
                      position: "absolute", left: `${(i / (gantt.axis.length - 1)) * 100}%`, top: 0,
                      fontSize: 10.5, color: A.inkMuted, fontWeight: 600, letterSpacing: "0.04em",
                      fontFamily: "IBM Plex Mono", transform: "translateX(-4px)",
                    }}>{d}</span>
                  ))}
                </div>
                <div />
              </div>

              {/* Rows — drag-friendly */}
              <div style={{ padding: "8px 18px 12px" }}>
                {rows.map((r, i) => {
                  const bars = (gantt.bars[r.plantingId]) || [{ s: 0, e: 100, label: r.crop, tone: r.color, dim: true }];
                  return (
                    <div key={r.plantingId} className="gantt-row" style={{
                      display: "grid", gridTemplateColumns: "200px 1fr 36px", gap: 14, alignItems: "center",
                      padding: "8px 0", borderTop: i === 0 ? "none" : `1px dashed ${A.dividerSoft}`,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: r.color, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, color: A.ink, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.crop}>{r.crop}</div>
                          <div style={{ fontSize: 10.5, color: A.inkMuted, marginTop: 1 }}>{r.block}</div>
                        </div>
                        {r.status === "proposed" && <A_Pill tone="wheat">Proposed</A_Pill>}
                        {r.status === "locked" && <A_Pill tone="neutral">Locked</A_Pill>}
                      </div>
                      <div style={{ position: "relative", height: 26, background: A.cream, borderRadius: 4, border: `1px solid ${A.dividerSoft}`, cursor: "default" }}>
                        {/* today marker behind bars */}
                        <div style={{ position: "absolute", left: `${gantt.todayPct}%`, top: -3, bottom: -3, borderLeft: `1.5px solid ${A.rust}`, opacity: 0.6, zIndex: 0 }} />
                        {bars.map((b, j) => {
                          const isAction = b.marker;
                          const isLocked = r.status === "locked";
                          return (
                            <div key={j} title={`${b.label} — drag to move, drag edges to resize`} style={{
                              position: "absolute", left: `${b.s}%`, width: `${Math.max(2, b.e - b.s)}%`, top: 3, bottom: 3,
                              background: b.tone, opacity: b.dim ? 0.7 : 1,
                              borderRadius: 3,
                              border: isAction ? `1.5px dashed ${A.ink}` : "none",
                              display: "flex", alignItems: "center", padding: "0 8px",
                              color: "white", fontSize: 10, fontWeight: 600, overflow: "hidden", whiteSpace: "nowrap",
                              zIndex: 1,
                              cursor: isLocked ? "not-allowed" : "grab",
                            }}>
                              {/* Left drag handle */}
                              {!isLocked && (
                                <span title="Drag to resize left" style={{
                                  position: "absolute", left: 0, top: 0, bottom: 0, width: 4,
                                  borderLeft: `2px solid rgba(255,255,255,0.55)`, cursor: "ew-resize", borderRadius: "3px 0 0 3px",
                                }} />
                              )}
                              {b.label}
                              {/* Right drag handle */}
                              {!isLocked && (
                                <span title="Drag to resize right" style={{
                                  position: "absolute", right: 0, top: 0, bottom: 0, width: 4,
                                  borderRight: `2px solid rgba(255,255,255,0.55)`, cursor: "ew-resize", borderRadius: "0 3px 3px 0",
                                }} />
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {/* Per-row edit */}
                      <button title="Edit row · dates, area, variety" style={{
                        ...A_iconBtn, width: 28, height: 28, opacity: r.status === "locked" ? 0.4 : 1,
                      }}>
                        <Icon.Wrench size={13} />
                      </button>
                    </div>
                  );
                })}
                {/* Add planting row */}
                <button style={{
                  width: "100%", marginTop: 10, padding: "10px 14px",
                  background: "transparent", border: `1px dashed ${A.divider}`, borderRadius: 6,
                  color: A.forest, fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                }}>
                  <Icon.Plus size={13} /> Add planting row manually
                </button>
              </div>

              {/* Today legend */}
              <div style={{ padding: "8px 18px 14px", display: "flex", alignItems: "center", gap: 14, fontSize: 10.5, color: A.inkMuted, fontFamily: "IBM Plex Mono", borderTop: `1px dashed ${A.dividerSoft}` }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 2, background: A.rust }} /> Today (May 26)</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, border: `1.5px dashed ${A.ink}`, borderRadius: 2 }} /> Sow/transplant action</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, background: A.forest, opacity: 0.7, borderRadius: 2 }} /> Growing window</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, background: A.wheat, opacity: 0.7, borderRadius: 2 }} /> Harvest peak</span>
              </div>
            </A_Card>

            {/* Proposals table */}
            <h3 className="serif" style={{ margin: "12px 0 10px", fontSize: 17, color: A.forestDeep }}>
              All plantings · <span style={{ color: A.inkMuted, fontWeight: 400 }}>{proposedCount} pending proposals</span>
            </h3>
            <A_Card padded={false}>
              <div style={{ display: "grid", gridTemplateColumns: "1.5fr 0.9fr 0.9fr 1.8fr 1.1fr", padding: "10px 16px", background: A.cream, borderBottom: `1px solid ${A.divider}`, fontSize: 10.5, color: A.inkMuted, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                <span>Planting</span><span>Current</span><span>Suggested</span><span>Reason</span><span style={{ textAlign: "right" }}>Action</span>
              </div>
              {rows.map((r, i) => (
                <div key={r.plantingId} style={{
                  display: "grid", gridTemplateColumns: "1.5fr 0.9fr 0.9fr 1.8fr 1.1fr", padding: "14px 16px", alignItems: "center",
                  borderTop: i === 0 ? "none" : `1px solid ${A.dividerSoft}`,
                  background: r.status === "proposed" ? "#FBF1E5" : "transparent",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 8, height: 26, borderRadius: 2, background: r.color }} />
                    <div>
                      <div style={{ fontSize: 13.5, color: A.ink, fontWeight: 600 }}>{r.crop}</div>
                      <div style={{ fontSize: 11.5, color: A.inkMuted }}>{r.block}</div>
                    </div>
                  </div>
                  <div className="mono" style={{ fontSize: 12.5, color: r.status === "proposed" ? A.inkMuted : A.ink, textDecoration: r.status === "proposed" ? "line-through" : "none" }}>{r.current}</div>
                  <div className="mono" style={{ fontSize: 12.5, color: r.suggested ? A.forestDeep : A.inkMuted, fontWeight: r.suggested ? 700 : 400 }}>
                    {r.suggested || "—"}
                  </div>
                  <div style={{ fontSize: 12, color: A.inkSoft, lineHeight: 1.4 }}>{r.reason}</div>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 5 }}>
                    {r.status === "locked" && <A_Pill tone="neutral">Locked · planted</A_Pill>}
                    {r.status === "ok" && <A_Pill tone="forest">Holds</A_Pill>}
                    {r.status === "proposed" && (
                      <>
                        <button style={{ ...A_ghostBtn, padding: "5px 9px", fontSize: 11.5 }}>
                          <Icon.X size={11} /> Skip
                        </button>
                        <button style={{ ...A_primaryBtn, padding: "5px 10px", fontSize: 11.5 }}>
                          <Icon.Check size={11} /> Accept
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </A_Card>
          </div>
        </div>
        <AWizardChat enabled={aiEnabled} />
      </div>
      <AWizardFooter
        backLabel="← Back to allocation"
        nextLabel="Continue to inputs plan"
        summary={<>{proposedCount > 0 ? <><strong>{proposedCount} proposals</strong> pending · accept or skip each above</> : "All caught up — no schedule conflicts"}</>}
        canContinue={proposedCount === 0}
      />
    </div>
  );
}

window.A_WizardSetupScreen = AWizardSetupScreen;

/* Implications matrix — philosophy × tillage interaction.
   Tells the user, before they continue, what guardrails their two
   answers actually put in place. Surfaces "hard" combos (Organic +
   No-till) as warnings so they can recalibrate expectations.
*/
function implicationsFor(philosophy, tillage) {
  const orgapproved = "247 OMRI-listed products only";
  const ompiActive = "Synthetic clock active — phaseout deadline tracked per planting";

  // Pre-resolve common phrases
  const phil = {
    organic: { allow: orgapproved, restrict: "All synthetics blocked at the kernel", N: "Manure / fish / kelp / compost only" },
    ipm:     { allow: "Full IRAC + HRAC palette, scout-gated", restrict: "Spray needs scout count over action threshold", N: "Synthetic + organic stacked" },
    conventional: { allow: "Full chemistry palette", restrict: "Safety kernel still enforces decon + drift + PHI", N: "Synthetic-led available" },
    transitioning: { allow: "Synthetics allowed during clock", restrict: ompiActive, N: "Compost-heavy + synthetic taper" },
  }[philosophy];

  const till = {
    "no-till":           { weedCtrl: "herbicide-led (or roller-crimper for organic)", passes: "0 cultivations" },
    "strip-till":        { weedCtrl: "mixed — selective spray + residue mulch",        passes: "1 strip pass" },
    "reduced-till":      { weedCtrl: "cultivation + selective post-emerge",            passes: "2–3 cultivations" },
    "conventional-till": { weedCtrl: "mechanical cultivation primary",                 passes: "4–6 cultivations" },
  }[tillage];

  // Hard combinations
  const isHard = (philosophy === "organic" && tillage === "no-till");

  const title = `${({ organic: "Organic", ipm: "IPM", conventional: "Conventional", transitioning: "Transitioning" })[philosophy]} · ${({ "no-till": "No-till", "strip-till": "Strip-till", "reduced-till": "Reduced-till", "conventional-till": "Conventional till" })[tillage]}`;

  const enables = [
    `Inputs: ${phil.allow}`,
    `Weed control: ${till.weedCtrl}`,
    `Fertility default: ${phil.N}`,
    `Expected cultivation: ${till.passes} per crop`,
  ];

  const restricts = [];
  if (philosophy === "organic") {
    restricts.push("All synthetic insecticides, herbicides, fungicides hidden from product picker");
    restricts.push("Conventional cover-crop burndown (glyphosate / paraquat) unavailable");
  } else if (philosophy === "ipm") {
    restricts.push("Insecticide flows require a scout count ≥ action threshold");
    restricts.push("Calendar sprays without a pest record are blocked");
  } else if (philosophy === "transitioning") {
    restricts.push("Synthetic applications tracked against the 3-year clock");
    restricts.push("Any synthetic spray reset the affected planting's organic eligibility");
  } else {
    restricts.push("None at the philosophy level — safety kernel still enforces every spray");
  }

  if (tillage === "no-till" && philosophy !== "organic") {
    restricts.push("Cultivation-based weed control assumed off — IPM scout cadence increases");
  } else if (tillage === "no-till" && philosophy === "organic") {
    restricts.push("Inter-row cultivation off + no synthetic burndown → roller-crimper or occultation required for cover termination");
  } else if (tillage === "conventional-till") {
    restricts.push("Cover-crop residue benefits reduced — soil-moisture risk in dry years");
  }

  let notes = null;
  if (isHard) {
    notes = "Hard combo: Organic + No-till has no herbicide fallback for cover-crop termination. Roller-crimper at flowering OR 6-week occultation is required. Plan ahead — windows are narrow.";
  } else if (philosophy === "transitioning") {
    notes = "Every synthetic application is logged with a timestamp; the planning assistant will warn before each one so you don't accidentally restart the 3-year clock on an organic-eligible planting.";
  } else if (philosophy === "ipm" && tillage === "reduced-till") {
    notes = "This is the most flexible default for diversified small-plot growing. The planning assistant will lean on cultivation timing first, sprays second.";
  }

  return { title, enables, restricts, notes, warn: isHard };
}

window.A_implicationsFor = implicationsFor;
window.A_WizardScheduleScreen = AWizardScheduleScreen;
window.A_WizardHeader = AWizardHeader;
window.A_WizardChat = AWizardChat;
window.A_WizardFooter = AWizardFooter;
window.A_WizardField = AWizardField;
window.A_chipBtn = chipBtnA;
window.A_rowBtn = rowBtnA;
window.A_tileBtn = tileBtnA;
