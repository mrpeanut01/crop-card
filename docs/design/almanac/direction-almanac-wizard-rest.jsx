/* Direction A — Almanac · Planning Wizard Steps 1, 3, 4
   Reuses chrome from direction-almanac-wizard.jsx: AWizardHeader,
   AWizardChat, AWizardFooter, A_TopBar. Each step is the wizard
   shell with a different center column.
*/

/* ── Step 1 · Allocation ──────────────────────────────────────── */
function AWizardAllocationScreen() {
  const A = window.A_tokens;
  const m = MOCK;
  const ap = m.allocationPlan;

  return (
    <div className="dir-a" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <A_TopBar active="plan" />
      <A_WizardHeader activeStepId="alloc" />
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ flex: 1, overflow: "auto", padding: "22px 28px", background: A.cream }}>

          {/* AI summary banner */}
          <div style={{
            padding: "14px 18px", marginBottom: 18, borderRadius: 10,
            background: A.paper, border: `1px solid ${A.divider}`, borderLeft: `4px solid ${A.forest}`,
            display: "grid", gridTemplateColumns: "1fr auto auto auto auto", gap: 22, alignItems: "center",
          }}>
            <div>
              <div style={{ fontSize: 11, color: A.inkMuted, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700 }}>AI allocation · run May 14 · refined 2× since</div>
              <div className="serif" style={{ fontSize: 15.5, color: A.forestDeep, marginTop: 2 }}>11 plantings proposed across 7 blocks · 2 deferred</div>
            </div>
            {[
              ["Accepted", ap.summary.accepted, A.forest],
              ["Pending",  ap.summary.pending,  A.wheat],
              ["Blocks",   ap.summary.blocks,   A.inkSoft],
              ["Violations", ap.rotationViolations.length, A.forest],
            ].map(([k, v, c]) => (
              <div key={k} style={{ textAlign: "center", paddingLeft: 18, borderLeft: `1px solid ${A.dividerSoft}` }}>
                <div className="serif" style={{ fontSize: 22, color: c, lineHeight: 1, fontWeight: 600 }}>{v}</div>
                <div style={{ fontSize: 10.5, color: A.inkMuted, marginTop: 3, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>{k}</div>
              </div>
            ))}
          </div>

          {/* Block grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 18 }}>
            {ap.proposals.map((bp) => {
              const block = m.blocks.find((b) => b.id === bp.blockId);
              return (
                <A_Card key={bp.blockId} padded={false}>
                  <div style={{ padding: "12px 16px 10px", borderBottom: `1px solid ${A.dividerSoft}`, display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 8, height: 28, borderRadius: 2, background: block.color }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="serif" style={{ fontSize: 15.5, color: A.ink, letterSpacing: "-0.01em" }}>{block.label}</div>
                      <div style={{ fontSize: 11, color: A.inkMuted, marginTop: 1 }}>{block.acres} ac · {bp.title}</div>
                    </div>
                    <A_Pill tone="forest">{bp.plantings.length}</A_Pill>
                  </div>
                  <div>
                    {bp.plantings.map((p, i) => {
                      const tone = ({ accepted: "forest", "auto-companion": "wheat", "carry-forward": "sky", perennial: "neutral", pending: "wheat" })[p.status] || "neutral";
                      return (
                        <div key={p.id} style={{
                          padding: "10px 16px", borderTop: i === 0 ? "none" : `1px dashed ${A.dividerSoft}`,
                          display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center",
                        }}>
                          <div>
                            <div style={{ fontSize: 13, color: A.ink, fontWeight: 600 }}>{p.crop}</div>
                            <div style={{ fontSize: 11, color: A.inkMuted, marginTop: 2 }}>{p.role} · <span className="mono">{p.pop}</span></div>
                          </div>
                          <A_Pill tone={tone}>{p.status}</A_Pill>
                        </div>
                      );
                    })}
                    {bp.note && (
                      <div style={{ padding: "9px 16px", borderTop: `1px dashed ${A.dividerSoft}`, fontSize: 11.5, color: A.inkSoft, display: "flex", alignItems: "flex-start", gap: 6, background: "#FBF5E6" }}>
                        <Icon.Info size={11} style={{ marginTop: 2, flexShrink: 0 }} />
                        <span>{bp.note}</span>
                      </div>
                    )}
                  </div>
                </A_Card>
              );
            })}
          </div>

          {/* Unallocated */}
          <A_Card padded={false} style={{ borderColor: "#E2B69E" }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid #E2B69E`, background: "#FBF1E5", display: "flex", alignItems: "center", gap: 10 }}>
              <Icon.Alert size={15} stroke="#8A341B" />
              <span className="serif" style={{ fontSize: 15, color: "#6E2A13" }}>Unallocated · {ap.unallocated.length}</span>
              <span style={{ marginLeft: "auto", fontSize: 12, color: "#8A341B" }}>AI couldn't place these — review or defer</span>
            </div>
            {ap.unallocated.map((u, i) => (
              <div key={u.id} style={{
                padding: "14px 18px", borderTop: i === 0 ? "none" : `1px solid ${A.dividerSoft}`,
                display: "grid", gridTemplateColumns: "1fr auto auto", gap: 14, alignItems: "center",
              }}>
                <div>
                  <div style={{ fontSize: 13.5, color: A.ink, fontWeight: 600 }}>{u.crop}</div>
                  <div style={{ fontSize: 12, color: A.inkSoft, marginTop: 3, lineHeight: 1.4 }}>{u.reason}</div>
                </div>
                <button style={{ ...A_ghostBtn, padding: "6px 10px", fontSize: 12 }}>
                  <Icon.Plus size={12} /> Add a block
                </button>
                <button style={{ ...A_primaryBtn, padding: "6px 10px", fontSize: 12, background: A.wheat }}>
                  <Icon.ArrowRight size={12} /> Defer to fall
                </button>
              </div>
            ))}
          </A_Card>
        </div>
        <A_WizardChat />
      </div>
      <A_WizardFooter
        backLabel="← Season setup"
        nextLabel="Continue to schedule"
        summary={<><strong>9 accepted</strong> · 2 deferred · 0 conflicts. Pre-validates the schedule step.</>}
      />
    </div>
  );
}

/* ── Step 3 · Inputs Plan ─────────────────────────────────────── */
function AWizardInputsScreen() {
  const A = window.A_tokens;
  const m = MOCK;
  const ip = m.inputsPlanData;

  return (
    <div className="dir-a" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <A_TopBar active="plan" />
      <A_WizardHeader activeStepId="inputs" />
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1.55fr 1fr", overflow: "hidden" }}>

          {/* Left: per-planting application stack */}
          <div style={{ overflow: "auto", padding: "20px 24px 24px", background: A.cream }}>
            {/* AI substitution note */}
            <div style={{
              padding: "12px 14px", marginBottom: 14, borderRadius: 8,
              background: "#EFF6E9", border: `1px solid #C9DBC0`, borderLeft: `3px solid ${A.forest}`,
              display: "flex", gap: 10, alignItems: "flex-start",
            }}>
              <Icon.Leaf size={14} stroke={A.forest} style={{ marginTop: 2 }} />
              <div style={{ flex: 1, fontSize: 12.5, color: A.forestDeep, lineHeight: 1.5 }}>
                <strong>AI substitutions applied.</strong> {ip.aiNote}
              </div>
              <button style={{ ...A_ghostBtn, padding: "4px 9px", fontSize: 11, background: A.paper }}>Revert all</button>
            </div>

            {/* Per-planting cards */}
            {ip.perPlanting.map((pp) => (
              <APPlantingCard key={pp.plantingId} pp={pp} />
            ))}

            {/* Warnings */}
            {ip.warnings.length > 0 && (
              <A_Card padded={false} style={{ marginTop: 4 }}>
                <div style={{ padding: "10px 16px", background: "#FBF5E6", borderBottom: `1px solid ${A.dividerSoft}`, fontSize: 11, color: A.inkMuted, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                  Warnings · {ip.warnings.length}
                </div>
                {ip.warnings.map((w, i) => (
                  <div key={i} style={{ padding: "10px 16px", borderTop: i === 0 ? "none" : `1px solid ${A.dividerSoft}`, display: "flex", alignItems: "flex-start", gap: 8 }}>
                    {w.level === "warn"
                      ? <Icon.Alert size={14} stroke={A.wheat} style={{ marginTop: 2, flexShrink: 0 }} />
                      : <Icon.Info size={14} stroke={A.sky} style={{ marginTop: 2, flexShrink: 0 }} />}
                    <span style={{ fontSize: 12, color: A.ink, lineHeight: 1.5 }}>{w.text}</span>
                  </div>
                ))}
              </A_Card>
            )}
          </div>

          {/* Right: shopping list */}
          <div style={{ borderLeft: `1px solid ${A.divider}`, background: A.paper, overflow: "auto" }}>
            <div style={{ padding: "16px 18px 12px", borderBottom: `1px solid ${A.dividerSoft}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <A_Kicker>Shopping list</A_Kicker>
                <div className="serif" style={{ fontSize: 16, color: A.forestDeep, marginTop: 2 }}>{ip.shoppingList.filter((s) => s.status === "short").length} items short</div>
              </div>
              <button style={{ ...A_ghostBtn, padding: "6px 10px", fontSize: 12 }}>
                <Icon.FileText size={12} /> Export CSV
              </button>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ color: A.inkMuted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
                  <th style={{ textAlign: "left", padding: "8px 16px" }}>Item</th>
                  <th style={{ textAlign: "right", padding: "8px 8px" }}>Need</th>
                  <th style={{ textAlign: "right", padding: "8px 8px" }}>On hand</th>
                  <th style={{ textAlign: "right", padding: "8px 16px" }}>Short by</th>
                </tr>
              </thead>
              <tbody>
                {ip.shoppingList.map((s, i) => (
                  <tr key={s.item} style={{ borderTop: `1px solid ${A.dividerSoft}`, background: s.status === "short" ? "#FBF5E6" : "transparent" }}>
                    <td style={{ padding: "9px 16px", color: A.ink, fontWeight: 500 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {s.status === "short" && <span style={{ width: 6, height: 6, borderRadius: 99, background: A.wheat, flexShrink: 0 }} />}
                        {s.item}
                      </div>
                    </td>
                    <td className="mono" style={{ padding: "9px 8px", textAlign: "right", color: A.ink }}>{s.total}</td>
                    <td className="mono" style={{ padding: "9px 8px", textAlign: "right", color: A.inkMuted }}>{s.onHand}</td>
                    <td className="mono" style={{ padding: "9px 16px", textAlign: "right", color: s.status === "short" ? "#8A6722" : A.inkMuted, fontWeight: s.status === "short" ? 700 : 500 }}>{s.shortfall}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: "12px 16px", borderTop: `1px solid ${A.dividerSoft}`, background: A.cream, fontSize: 11.5, color: A.inkSoft, display: "flex", gap: 6, alignItems: "flex-start" }}>
              <Icon.Info size={12} style={{ marginTop: 2, flexShrink: 0 }} />
              <span>Quantities derive from per-application rates × accepted area. Updates live as you accept or revert AI substitutions on the left.</span>
            </div>
          </div>

        </div>
        <A_WizardChat />
      </div>
      <A_WizardFooter
        backLabel="← Schedule"
        nextLabel="Continue to commit"
        summary={<><strong>28 applications</strong> · 14 scout cadences · 6 items to reorder</>}
      />
    </div>
  );
}

function APPlantingCard({ pp }) {
  const A = window.A_tokens;
  const [open, setOpen] = React.useState(pp.expanded);
  const typeColor = {
    fertility: A.sky, herbicide: A.rust, insecticide: A.wheat, fungicide: "#6B5AA8",
    planting: A.forest, scout: A.forestDeep,
  };
  return (
    <A_Card padded={false} style={{ marginBottom: 10 }}>
      <button onClick={() => setOpen(!open)} style={{
        width: "100%", textAlign: "left", padding: "12px 16px", background: "transparent",
        border: "none", borderRadius: 10, display: "flex", alignItems: "center", gap: 10,
        fontFamily: "inherit", cursor: "pointer",
      }}>
        <Icon.ChevronRight size={14} style={{ color: A.inkMuted, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.1s" }} />
        <span className="serif" style={{ fontSize: 15, color: A.ink, letterSpacing: "-0.01em" }}>{pp.crop}</span>
        <span style={{ fontSize: 11.5, color: A.inkMuted, marginLeft: 4 }}>{pp.applications.length} applications · {pp.scoutCadence.length} scout cadences</span>
        {pp.warnings.length > 0 && <A_Pill tone="wheat">{pp.warnings.length} note</A_Pill>}
      </button>
      {open && (
        <div style={{ borderTop: `1px solid ${A.dividerSoft}` }}>
          {pp.applications.map((a, i) => {
            const tone = ({ completed: "neutral", accepted: "forest", substituted: "sky", pending: "wheat" })[a.status] || "neutral";
            return (
              <div key={a.id} style={{
                padding: "10px 16px 10px 38px", borderTop: i === 0 ? "none" : `1px dashed ${A.dividerSoft}`,
                display: "grid", gridTemplateColumns: "60px 14px 1fr auto auto", gap: 10, alignItems: "center",
              }}>
                <div className="mono" style={{ fontSize: 11.5, color: a.status === "completed" ? A.forest : A.inkSoft }}>{a.when}</div>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: typeColor[a.type] || A.inkMuted }} />
                <div>
                  <div style={{ fontSize: 13, color: A.ink, fontWeight: 500 }}>{a.product}</div>
                  <div style={{ fontSize: 11, color: A.inkMuted, marginTop: 1 }}>
                    <span className="mono">{a.rate}</span> · {a.source}
                    {a.was && <span> · <em style={{ color: A.sky }}>was {a.was}</em></span>}
                  </div>
                </div>
                <A_Pill tone={tone}>{a.status}</A_Pill>
                <span style={{ fontSize: 10.5, color: A.inkMuted, fontFamily: "IBM Plex Mono", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>{a.type}</span>
              </div>
            );
          })}
          {pp.scoutCadence.length > 0 && (
            <div style={{ padding: "10px 16px 12px 38px", borderTop: `1px dashed ${A.dividerSoft}`, background: A.cream }}>
              <div style={{ fontSize: 10.5, color: A.inkMuted, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Scout cadence</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {pp.scoutCadence.map((sc, i) => (
                  <span key={i} style={{
                    display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px",
                    background: A.paper, border: `1px solid ${A.divider}`, borderRadius: 99, fontSize: 11, color: A.ink,
                  }}>
                    <Icon.Eye size={10} stroke={A.forest} /> {sc.kind} · <span className="mono" style={{ color: A.inkMuted }}>{sc.freq} from {sc.from}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {pp.warnings.length > 0 && (
            <div style={{ padding: "10px 16px 10px 38px", borderTop: `1px dashed ${A.dividerSoft}`, background: "#FBF5E6", fontSize: 12, color: "#8A6722", display: "flex", gap: 8, alignItems: "flex-start" }}>
              <Icon.Info size={13} style={{ marginTop: 2, flexShrink: 0 }} />
              <span>{pp.warnings[0].text}</span>
            </div>
          )}
        </div>
      )}
    </A_Card>
  );
}

/* ── Step 4 · Commit ──────────────────────────────────────────── */
function AWizardCommitScreen() {
  const A = window.A_tokens;
  const m = MOCK;
  const cs = m.commitSummary;
  const allValid = cs.steps.every((s) => s.status === "valid") && cs.blockedBy.length === 0;

  return (
    <div className="dir-a" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <A_TopBar active="plan" />
      <A_WizardHeader activeStepId="commit" />
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ flex: 1, overflow: "auto", padding: "24px 32px", background: A.cream }}>
          <div style={{ maxWidth: 680, margin: "0 auto" }}>

            {/* Headline */}
            <h2 className="serif" style={{ margin: "0 0 8px", fontSize: 26, color: A.forestDeep, letterSpacing: "-0.02em" }}>
              {allValid ? "Ready to commit" : "Resolve blockers first"}
            </h2>
            <p style={{ fontSize: 14, color: A.inkSoft, margin: "0 0 22px", lineHeight: 1.5 }}>
              Commit writes everything to your records. After commit, plantings appear in <strong>Plan</strong>; tasks land
              on <strong>Today</strong>; applications populate the <strong>Spray / Insecticide / Fungicide</strong> flows.
              You can still refine individual rows — staleness propagates back to the workflow strip.
            </p>

            {/* Step-by-step review */}
            <A_Card padded={false} style={{ marginBottom: 14 }}>
              <div style={{ padding: "12px 18px", background: A.cream, borderBottom: `1px solid ${A.divider}`, fontSize: 11, color: A.inkMuted, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                Review · 4 steps validated
              </div>
              {cs.steps.map((s, i) => (
                <div key={s.label} style={{
                  display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 12, alignItems: "center",
                  padding: "12px 18px", borderTop: i === 0 ? "none" : `1px solid ${A.dividerSoft}`,
                }}>
                  <span style={{
                    width: 26, height: 26, borderRadius: 99,
                    background: s.status === "valid" ? A.forest : A.wheat,
                    color: A.cream, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700,
                  }}><Icon.Check size={13} /></span>
                  <div>
                    <div style={{ fontSize: 14, color: A.ink, fontWeight: 600 }}>{i + 1}. {s.label}</div>
                    <div style={{ fontSize: 12, color: A.inkMuted, marginTop: 2 }}>{s.count}</div>
                  </div>
                  <A_Pill tone="forest"><Icon.Check size={10} /> {s.status}</A_Pill>
                  <a style={{ fontSize: 12, color: A.forest, fontWeight: 600 }}>Edit →</a>
                </div>
              ))}
            </A_Card>

            {/* What gets created */}
            <A_Card padded={false} style={{ marginBottom: 14 }}>
              <div style={{ padding: "12px 18px", background: A.cream, borderBottom: `1px solid ${A.divider}`, fontSize: 11, color: A.inkMuted, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                What this commit creates
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: A.dividerSoft }}>
                {[
                  ["Plantings",     cs.toCreate.plantings,    "Sprout"],
                  ["Tasks",         cs.toCreate.tasks,        "Calendar"],
                  ["Applications",  cs.toCreate.applications, "Spray"],
                  ["Scout cadences",cs.toCreate.scoutCadences,"Eye"],
                  ["Shopping items",cs.toCreate.shoppingItems,"Box"],
                  ["Carry-forwards", `${cs.carryForward.covers + cs.carryForward.perennials}`, "ArrowRight"],
                ].map(([k, v, ic]) => {
                  const G = Icon[ic];
                  return (
                    <div key={k} style={{ background: A.paper, padding: "14px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 26, height: 26, borderRadius: 6, background: "#E5EEDF", color: A.forest, display: "grid", placeItems: "center" }}>
                          <G size={13} />
                        </div>
                        <div className="serif" style={{ fontSize: 22, color: A.forestDeep, fontWeight: 600, lineHeight: 1 }}>{v}</div>
                      </div>
                      <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 6, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>{k}</div>
                    </div>
                  );
                })}
              </div>
            </A_Card>

            {/* AI final check */}
            <div style={{
              padding: "14px 18px", marginBottom: 16, borderRadius: 10,
              background: "#EFF6E9", border: `1px solid #C9DBC0`, borderLeft: `4px solid ${A.forest}`,
              display: "flex", gap: 10, alignItems: "flex-start",
            }}>
              <Icon.CheckCircle size={16} stroke={A.forest} style={{ marginTop: 2, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: A.forestDeep, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>Final validation pass</div>
                <div style={{ fontSize: 12.5, color: A.forestDeep, lineHeight: 1.5 }}>{cs.aiFinalCheck}</div>
              </div>
            </div>

            {/* Big commit */}
            <button style={{
              width: "100%", padding: "16px",
              background: A.forest, color: A.cream, border: "none", borderRadius: 10,
              fontSize: 16, fontWeight: 700, letterSpacing: "0.01em",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              cursor: "pointer", fontFamily: "inherit",
            }}>
              <Icon.Check size={18} /> Commit season plan · 2026
            </button>
            <div style={{ marginTop: 10, fontSize: 11.5, color: A.inkMuted, textAlign: "center", lineHeight: 1.5 }}>
              You can refine any planting later. Re-running a wizard step never overwrites existing records — it proposes diffs.
            </div>
          </div>
        </div>
        <A_WizardChat />
      </div>
      <A_WizardFooter
        backLabel="← Inputs plan"
        nextLabel="Commit & open Today"
        summary={<>4 of 4 steps valid · 0 blockers</>}
      />
    </div>
  );
}

window.A_WizardAllocationScreen = AWizardAllocationScreen;
window.A_WizardInputsScreen = AWizardInputsScreen;
window.A_WizardCommitScreen = AWizardCommitScreen;
