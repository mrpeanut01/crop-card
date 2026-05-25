/* Direction A — Almanac · First-run onboarding (Phase 5 persona)
   The "Sherry, day 1, empty database" screen. Replaces Today on the
   very first login. Linear-feeling but jumpable; each step has a
   clear what/why; the AI assistant offers to pre-populate from a
   sample plan or last year's CSV.
*/

function AOnboardingScreen() {
  const A = window.A_tokens;
  const ob = MOCK.onboarding;

  const doneCount = ob.steps.filter((s) => s.done).length;
  const total = ob.steps.length;
  const pct = Math.round((doneCount / total) * 100);
  const currentStep = ob.steps.find((s) => s.current) || ob.steps.find((s) => !s.done);

  return (
    <div className="dir-a" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <A_TopBar active="today" />

      <div style={{ flex: 1, overflow: "auto", padding: "32px 28px 40px" }}>
        <div style={{ maxWidth: 1080, margin: "0 auto" }}>

          {/* Hero — welcome */}
          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 30, alignItems: "center", marginBottom: 28 }}>
            <div>
              <div style={{ fontSize: 11, color: A.inkMuted, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                <Icon.Sun size={12} stroke={A.wheat} /> First-run setup
              </div>
              <h1 className="serif" style={{ margin: "8px 0 0", fontSize: 44, lineHeight: 1.05, color: A.forestDeep, letterSpacing: "-0.025em" }}>
                Welcome, {ob.user.split(" ")[0]}.
              </h1>
              <p style={{ fontSize: 15.5, color: A.inkSoft, marginTop: 12, lineHeight: 1.5, maxWidth: 540 }}>
                Six small steps to turn your paper field card into a working record system. About <strong>fifteen minutes</strong>.
                You can leave and come back — your progress saves automatically.
              </p>
            </div>
            {/* Progress dial */}
            <div style={{ background: A.paper, border: `1px solid ${A.divider}`, borderRadius: 14, padding: 22, textAlign: "center" }}>
              <svg width="120" height="120" viewBox="0 0 120 120" style={{ display: "block", margin: "0 auto 10px" }}>
                <circle cx="60" cy="60" r="50" fill="none" stroke={A.dividerSoft} strokeWidth="10" />
                <circle cx="60" cy="60" r="50" fill="none" stroke={A.forest} strokeWidth="10"
                  strokeDasharray={`${(pct / 100) * 314.16} 314.16`}
                  strokeDashoffset="0" strokeLinecap="round"
                  transform="rotate(-90 60 60)" />
                <text x="60" y="58" textAnchor="middle" fontSize="28" fontWeight="700" fontFamily="Source Serif 4" fill={A.forestDeep}>{doneCount}</text>
                <text x="60" y="76" textAnchor="middle" fontSize="11" fill={A.inkMuted} fontFamily="IBM Plex Sans">of {total}</text>
              </svg>
              <div style={{ fontSize: 13, color: A.ink, fontWeight: 600 }}>{ob.farm}</div>
              <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 2 }}>est. {pct < 100 ? `${15 - Math.round((pct / 100) * 15)} min left` : "complete"}</div>
            </div>
          </div>

          {/* Two-col layout: steps + shortcut sidebar */}
          <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 18 }}>

            {/* Step cards */}
            <div>
              <h2 className="serif" style={{ margin: "0 0 14px", fontSize: 18, color: A.forestDeep, letterSpacing: "-0.01em" }}>Your setup</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {ob.steps.map((s, i) => {
                  const G = Icon[s.icon];
                  const isCurrent = s.current;
                  const isDone = s.done;
                  return (
                    <div key={s.id} style={{
                      background: isCurrent ? A.paper : (isDone ? A.cream : A.paper),
                      border: `1px solid ${isCurrent ? A.forest : A.divider}`,
                      borderLeft: isCurrent ? `4px solid ${A.forest}` : `1px solid ${A.divider}`,
                      borderRadius: 10, padding: "16px 18px",
                      display: "grid", gridTemplateColumns: "auto 36px 1fr auto", gap: 14, alignItems: "center",
                      opacity: isDone && !isCurrent ? 0.78 : 1,
                    }}>
                      {/* Status circle */}
                      <span style={{
                        width: 26, height: 26, borderRadius: 99,
                        background: isDone ? A.forest : (isCurrent ? A.wheat : A.paper),
                        border: `1.5px solid ${isDone ? A.forest : (isCurrent ? A.wheat : A.divider)}`,
                        color: (isDone || isCurrent) ? A.cream : A.inkMuted,
                        display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700,
                      }}>
                        {isDone ? <Icon.Check size={13} /> : (i + 1)}
                      </span>
                      {/* Icon */}
                      <div style={{
                        width: 36, height: 36, borderRadius: 8,
                        background: isCurrent ? "#E5EEDF" : A.cream,
                        color: isCurrent ? A.forest : A.inkMuted,
                        display: "grid", placeItems: "center",
                      }}><G size={17} /></div>
                      {/* Label + detail */}
                      <div>
                        <div className="serif" style={{ fontSize: 15.5, color: isDone ? A.inkSoft : A.ink, letterSpacing: "-0.01em", textDecoration: isDone && !isCurrent ? "line-through" : "none" }}>{s.label}</div>
                        <div style={{ fontSize: 12.5, color: A.inkMuted, marginTop: 3, lineHeight: 1.4 }}>{s.detail}</div>
                      </div>
                      {/* Action */}
                      {isCurrent && (
                        <button style={{ ...A_primaryBtn, padding: "9px 14px", fontSize: 13.5 }}>
                          Start <Icon.ArrowRight size={13} />
                        </button>
                      )}
                      {!isCurrent && !isDone && (
                        <button style={{ ...A_ghostBtn, padding: "8px 12px", fontSize: 13 }}>
                          Open
                        </button>
                      )}
                      {isDone && (
                        <a style={{ fontSize: 12.5, color: A.forest, fontWeight: 600 }}>Edit →</a>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* Skip strip */}
              <div style={{ marginTop: 16, padding: "12px 14px", background: A.paper, border: `1px dashed ${A.divider}`, borderRadius: 8, display: "flex", alignItems: "center", gap: 10 }}>
                <Icon.ChevronRight size={13} stroke={A.inkMuted} />
                <span style={{ fontSize: 12.5, color: A.inkSoft, flex: 1 }}>
                  Already set up your blocks in a spreadsheet? <a style={{ color: A.forest, fontWeight: 600 }}>Skip ahead and import a CSV →</a>
                </span>
              </div>
            </div>

            {/* Right side: AI assistant + shortcuts */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* AI offer card — make optionality + fallback explicit */}
              <A_Card style={{ borderColor: A.forest, borderLeft: `4px solid ${A.forest}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: A.forest, color: A.cream, display: "grid", placeItems: "center" }}>
                    <Icon.Sparkle size={15} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="serif" style={{ fontSize: 14, color: A.forestDeep, fontWeight: 600 }}>Planning assistant · optional</div>
                    <div style={{ fontSize: 10.5, color: A.inkMuted }}>bring-your-own Claude key · capped spend</div>
                  </div>
                  {window.A_Provenance && <window.A_Provenance source="ai" compact />}
                </div>
                <p style={{ margin: "0 0 10px", fontSize: 12.5, color: A.inkSoft, lineHeight: 1.5 }}>
                  Want Claude to seed a sample farm with mock blocks, scout history, and a starter plan you can edit?
                  Or paste an API key to enable AI proposals later — every screen works without one.
                </p>
                <div style={{
                  padding: "8px 10px", background: A.cream,
                  border: `1px solid ${A.dividerSoft}`, borderRadius: 5,
                  fontSize: 11, color: A.inkSoft, lineHeight: 1.45, marginBottom: 10,
                  display: "flex", gap: 6, alignItems: "flex-start",
                }}>
                  <Icon.Info size={12} stroke={A.inkSoft} style={{ marginTop: 2, flexShrink: 0 }} />
                  <span><strong style={{ color: A.forestDeep }}>Without a key:</strong> 308 plugins, calibration math, safety kernel, calendar derivations, CSV import — all still work. AI only assists; never gates.</span>
                </div>
                <button style={{ ...A_primaryBtn, width: "100%", justifyContent: "center", padding: "10px 14px" }}>
                  <Icon.Sprout size={13} /> Seed a sample plan with Claude
                </button>
                <button style={{ ...A_ghostBtn, width: "100%", marginTop: 8, justifyContent: "center", padding: "8px 12px" }}>
                  Skip · I'll add a key later (or never)
                </button>
              </A_Card>

              {/* Shortcuts */}
              <A_Card>
                <A_Kicker>Shortcuts</A_Kicker>
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                  {ob.tips.map((t, i) => (
                    <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                      <span style={{ width: 6, height: 6, borderRadius: 99, background: A.wheat, marginTop: 7, flexShrink: 0 }} />
                      <span style={{ fontSize: 12.5, color: A.inkSoft, lineHeight: 1.5 }}>{t.text}</span>
                    </div>
                  ))}
                </div>
              </A_Card>

              {/* Why this matters */}
              <A_Card style={{ background: A.cream }}>
                <A_Kicker>Why these six</A_Kicker>
                <div style={{ marginTop: 10, fontSize: 12.5, color: A.inkSoft, lineHeight: 1.55 }}>
                  Every CropCard feature roots in three primitives: <strong>blocks</strong> (where you grow),
                  <strong> plantings</strong> (what's in them), and <strong>sprayers</strong> (calibrated equipment).
                  Once those three exist, the calendar drives everything else — today's tasks, harvest windows,
                  decon alerts, audit-ready records.
                </div>
                <a style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 12, fontSize: 12.5, color: A.forest, fontWeight: 600 }}>
                  Read the 2-min explainer <Icon.ArrowRight size={12} />
                </a>
              </A_Card>
            </div>
          </div>

          {/* Footer reassurance */}
          <div style={{ marginTop: 28, paddingTop: 18, borderTop: `1px solid ${A.divider}`, fontSize: 12, color: A.inkMuted, textAlign: "center", lineHeight: 1.5 }}>
            <Icon.Lock size={11} style={{ verticalAlign: "middle", marginRight: 5 }} />
            Your data lives on your device first; sync to the cloud is opt-in. You can delete the sample plan any time from Settings.
          </div>
        </div>
      </div>
    </div>
  );
}

window.A_OnboardingScreen = AOnboardingScreen;
