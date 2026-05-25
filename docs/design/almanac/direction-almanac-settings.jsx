/* Direction A — Almanac · Settings sub-screens
   Builds out the 11 cards currently framed-out on the Settings index.
   Each sub-screen takes the same shell (header + breadcrumbed back +
   save-changes sticky footer) and a focused body.

   Wired to A_Settings* on window for the canvas. */

/* ── Shell ─────────────────────────────────────────────────────── */
function ASettingsShell({ title, kicker, badge, dirty, children, hideFooter }) {
  const A = window.A_tokens;
  return (
    <div className="dir-a" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <A_TopBar active="settings" />
      <div style={{ background: A.paper, borderBottom: `1px solid ${A.divider}` }}>
        <div style={{ padding: "14px 28px", display: "flex", alignItems: "center", gap: 14 }}>
          <button title="Back to Settings" style={A_iconBtn}>
            <Icon.ChevronRight size={16} style={{ transform: "rotate(180deg)" }} />
          </button>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 11, color: A.inkMuted, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>
              Settings · {kicker}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h1 className="serif" style={{ margin: "2px 0 0", fontSize: 26, color: A.forestDeep, letterSpacing: "-0.015em", lineHeight: 1.1 }}>{title}</h1>
              {badge}
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            {dirty && <span style={{ fontSize: 11.5, color: A.wheat, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>● Unsaved</span>}
          </div>
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "22px 28px 28px", background: A.cream }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          {children}
        </div>
      </div>
      {!hideFooter && (
        <div style={{
          borderTop: `1px solid ${A.divider}`, background: A.paper, padding: "12px 28px",
          display: "flex", justifyContent: "flex-end", gap: 10
        }}>
          <button style={A_ghostBtn}>Cancel</button>
          <button style={A_primaryBtn}>Save changes</button>
        </div>
      )}
    </div>
  );
}

const _sKic = () => ({ fontSize: 11, fontWeight: 700, color: "#7A7F75", letterSpacing: "0.08em", textTransform: "uppercase" });
const _sMono = { fontFamily: "IBM Plex Mono, ui-monospace, monospace" };
const _sInput = {
  border: `1px solid ${window.A_tokens.divider}`, background: window.A_tokens.paper,
  color: window.A_tokens.ink, padding: "8px 10px", borderRadius: 6,
  fontSize: 13.5, fontFamily: "inherit", outline: "none", width: "100%"
};

function SField({ label, hint, required, children }) {
  const A = window.A_tokens;
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={_sKic()}>{label}</span>
        {required && <span style={{ fontSize: 10, color: A.rust, fontWeight: 700 }}>· required</span>}
        {hint && <span style={{ fontSize: 10.5, color: A.inkMuted, marginLeft: "auto", ..._sMono }}>{hint}</span>}
      </div>
      {children}
    </label>
  );
}

function SSection({ title, sub, right, children }) {
  const A = window.A_tokens;
  return (
    <A_Card padded={false} style={{ marginBottom: 14 }}>
      <div style={{
        padding: "13px 18px 11px", borderBottom: `1px solid ${A.dividerSoft}`,
        display: "flex", alignItems: "center", gap: 10
      }}>
        <div style={{ flex: 1 }}>
          <h3 className="serif" style={{ margin: 0, fontSize: 16, color: A.forestDeep, letterSpacing: "-0.01em" }}>{title}</h3>
          {sub && <div style={{ fontSize: 12, color: A.inkMuted, marginTop: 3 }}>{sub}</div>}
        </div>
        {right}
      </div>
      <div style={{ padding: "16px 18px" }}>{children}</div>
    </A_Card>
  );
}

/* ═══════════════════ 1 · Account & sign-in ════════════════════ */
function ASettingsAccountScreen() {
  const A = window.A_tokens;
  const u = MOCK.settingsData.user;
  return (
    <ASettingsShell title="Account & sign-in" kicker="Owner profile" dirty>
      <SSection title="Profile" sub="Visible to helpers in your farm.">
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 18, alignItems: "center" }}>
          <div style={{ width: 64, height: 64, borderRadius: 99, background: A.wheat, color: A.cream, display: "grid", placeItems: "center", fontSize: 26, fontWeight: 700 }}>{u.name[0]}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <SField label="Display name"><input style={_sInput} defaultValue={u.name} /></SField>
            <SField label="Email" hint="magic-link sign-in"><input style={_sInput} defaultValue={u.email} /></SField>
            <SField label="Time zone"><select style={_sInput} defaultValue="EST"><option>America/New_York (EST)</option></select></SField>
            <SField label="Display units"><select style={_sInput} defaultValue="us"><option value="us">US (acre · lb · °F)</option><option>Metric</option></select></SField>
          </div>
        </div>
      </SSection>

      <SSection title="Sign-in security" sub="Magic-link (no password) · optional 2FA when shipped.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <SField label="Sign-in method"><select style={_sInput} defaultValue="magic"><option value="magic">Magic-link email</option><option>Magic-link + passkey (coming)</option></select></SField>
          <SField label="Last sign-in" hint="HMAC cookie session"><input style={{ ..._sInput, ..._sMono }} defaultValue={u.lastLogin} disabled /></SField>
        </div>
        <div style={{ marginTop: 14 }}>
          <div style={_sKic()}>Active sessions · {u.sessions}</div>
          <div style={{ marginTop: 8, border: `1px solid ${A.dividerSoft}`, borderRadius: 8, overflow: "hidden" }}>
            {[
              { device: "MacBook Pro · Safari 17.4", where: "Loudoun, VA", when: "now · this session", current: true },
              { device: "iPhone 14 · CropCard PWA",   where: "Loudoun, VA", when: "today 6:22 AM", current: false },
            ].map((s, i) => (
              <div key={s.device} style={{
                padding: "10px 14px", borderTop: i === 0 ? "none" : `1px solid ${A.dividerSoft}`,
                display: "flex", alignItems: "center", gap: 12
              }}>
                <Icon.User size={15} stroke={A.inkSoft} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: A.ink, fontWeight: 600 }}>{s.device}</div>
                  <div style={{ fontSize: 11.5, color: A.inkMuted, ..._sMono }}>{s.where} · {s.when}</div>
                </div>
                {s.current ? <A_Pill tone="forest">This device</A_Pill>
                  : <button style={{ ...A_ghostBtn, padding: "5px 10px", fontSize: 11.5 }}>Sign out</button>}
              </div>
            ))}
          </div>
          <button style={{ ...A_ghostBtn, marginTop: 10, padding: "6px 12px", fontSize: 12 }}>
            <Icon.Lock size={11} /> Sign out everywhere
          </button>
        </div>
      </SSection>

      <SSection title="Data export" sub="GDPR-style download · CSV + JSON + plugin snapshot.">
        <div style={{ display: "flex", gap: 10 }}>
          <button style={A_ghostBtn}><Icon.FileText size={13} /> Download account data</button>
          <button style={A_ghostBtn}><Icon.FileText size={13} /> Download VDACS audit pack</button>
        </div>
      </SSection>
    </ASettingsShell>
  );
}

/* ═══════════════════ 2 · Farm & blocks ════════════════════════ */
function ASettingsFarmScreen() {
  const A = window.A_tokens;
  const blocks = [
    { id: "A", crop: "Three Sisters", acres: 1.1, soil: "Catlett loam", irr: "drip", color: "#4F7A52" },
    { id: "B", crop: "Tomato + marigold", acres: 0.3, soil: "Catlett loam", irr: "drip", color: "#A64A2A" },
    { id: "C", crop: "Cover crop · fallow", acres: 1.2, soil: "Penn silt loam", irr: "none", color: "#9C8147" },
    { id: "D", crop: "Lettuce succession", acres: 0.3, soil: "Penn silt loam", irr: "overhead", color: "#6F8FA8" },
    { id: "E", crop: "Hops (perennial)", acres: 0.5, soil: "Catlett loam", irr: "drip", color: "#8A5A2C" },
    { id: "F", crop: "Apple orchard", acres: 1.2, soil: "Penn silt loam", irr: "drip", color: "#5F8045" },
    { id: "G", crop: "Painted Mtn corn", acres: 0.8, soil: "Catlett loam", irr: "drip", color: "#B8893C" },
  ];
  const total = blocks.reduce((s, b) => s + b.acres, 0).toFixed(1);

  return (
    <ASettingsShell title="Farm & blocks" kicker="Field geometry">
      <SSection title="Farm details" sub="Used by frost-date lookup, weather, and inspector links.">
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 12 }}>
          <SField label="Farm name"><input style={_sInput} defaultValue="Loudoun Home Farm" /></SField>
          <SField label="County"><input style={_sInput} defaultValue="Loudoun, VA" /></SField>
          <SField label="USDA hardiness"><select style={_sInput} defaultValue="7a"><option>7a</option><option>7b</option></select></SField>
        </div>
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <SField label="Lat / Long" hint="for frost + GDD"><input style={{ ..._sInput, ..._sMono }} defaultValue="39.1157, -77.5636" /></SField>
          <SField label="Last frost · spring"><input style={_sInput} defaultValue="May 5" /></SField>
          <SField label="First frost · fall"><input style={_sInput} defaultValue="Oct 14" /></SField>
        </div>
      </SSection>

      <SSection
        title={`Blocks · ${blocks.length} · ${total} ac total`}
        sub="Click a block to edit boundary, soil zone, irrigation, or rotation history."
        right={<button style={{ ...A_primaryBtn, padding: "6px 12px", fontSize: 12 }}><Icon.Plus size={11} /> New block</button>}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {/* Map */}
          <div style={{
            position: "relative", aspectRatio: "1 / 1", borderRadius: 8,
            background: "linear-gradient(180deg, #DCE6CF 0%, #C5D4B6 100%)",
            border: `1px solid ${A.divider}`, overflow: "hidden"
          }}>
            {/* Faux field shapes */}
            {[
              { x: 12, y: 14, w: 26, h: 22, c: "#4F7A52", label: "A" },
              { x: 40, y: 14, w: 16, h: 14, c: "#A64A2A", label: "B" },
              { x: 58, y: 12, w: 26, h: 26, c: "#9C8147", label: "C" },
              { x: 12, y: 40, w: 14, h: 14, c: "#6F8FA8", label: "D" },
              { x: 28, y: 40, w: 18, h: 16, c: "#8A5A2C", label: "E" },
              { x: 50, y: 42, w: 26, h: 24, c: "#5F8045", label: "F" },
              { x: 20, y: 60, w: 22, h: 18, c: "#B8893C", label: "G" },
            ].map((p) => (
              <div key={p.label} style={{
                position: "absolute", left: `${p.x}%`, top: `${p.y}%`, width: `${p.w}%`, height: `${p.h}%`,
                background: p.c, opacity: 0.78, borderRadius: 4,
                border: `1.5px solid ${p.c}`,
                display: "grid", placeItems: "center",
                color: A.cream, fontWeight: 800, fontSize: 13
              }}>{p.label}</div>
            ))}
            <div style={{
              position: "absolute", left: 10, top: 10,
              ..._sMono, fontSize: 10, color: A.forestDeep,
              background: "rgba(255,255,255,0.7)", padding: "2px 7px", borderRadius: 4
            }}>map view · {total} ac</div>
            <div style={{
              position: "absolute", right: 10, bottom: 10, display: "flex", gap: 6
            }}>
              <button style={{ ...A_ghostBtn, padding: "4px 8px", fontSize: 11 }}><Icon.Map size={11} /> Edit boundaries</button>
            </div>
          </div>
          {/* Block list */}
          <div style={{ border: `1px solid ${A.dividerSoft}`, borderRadius: 8, overflow: "hidden" }}>
            {blocks.map((b, i) => (
              <div key={b.id} style={{
                padding: "10px 14px", borderTop: i === 0 ? "none" : `1px solid ${A.dividerSoft}`,
                display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 12, alignItems: "center"
              }}>
                <div style={{ width: 26, height: 26, borderRadius: 5, background: b.color, color: A.cream, display: "grid", placeItems: "center", fontWeight: 700, fontSize: 12 }}>{b.id}</div>
                <div>
                  <div style={{ fontSize: 12.5, color: A.ink, fontWeight: 600 }}>{b.crop}</div>
                  <div style={{ ..._sMono, fontSize: 10.5, color: A.inkMuted, marginTop: 2 }}>{b.soil} · {b.irr}</div>
                </div>
                <span style={{ ..._sMono, fontSize: 11.5, color: A.inkSoft }}>{b.acres} ac</span>
                <Icon.ChevronRight size={13} stroke={A.inkMuted} />
              </div>
            ))}
          </div>
        </div>
      </SSection>
    </ASettingsShell>
  );
}

/* ═══════════════════ 3 · Helpers & invites ════════════════════ */
function ASettingsHelpersScreen() {
  const A = window.A_tokens;
  const helpers = [
    { name: "Marco V.",   email: "marco@loudoun-home.farm", role: "helper",    lastSeen: "today · 7:14 AM", since: "Feb 2025", canEdit: false },
  ];
  const invites = [
    { email: "dale.inspector@vdacs.virginia.gov", role: "inspector", expires: "in 4 d", sent: "May 19", token: "8b3e…f1c0" },
  ];
  return (
    <ASettingsShell title="Helpers & invites" kicker="Tenant access" badge={<A_Pill tone="wheat">{invites.length} pending</A_Pill>}>
      <SSection title="Roles" sub="Server-enforced. Helpers can't edit locked records or override custom rates.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {[
            { role: "Owner",     count: 1,  blurb: "Full edit. Manages safety bypasses + billing.", color: A.forest },
            { role: "Helper",    count: 1,  blurb: "Spray + scout + harvest. No bypasses. No billing.", color: A.sky },
            { role: "Inspector", count: 0,  blurb: "Read-only · time-boxed link · no login.", color: A.wheat },
          ].map((r) => (
            <div key={r.role} style={{ padding: "10px 12px", border: `1px solid ${A.dividerSoft}`, borderRadius: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12.5, color: A.ink, fontWeight: 700 }}>{r.role}</span>
                <span style={{ ..._sMono, fontSize: 11, color: r.color, fontWeight: 700 }}>{r.count}</span>
              </div>
              <div style={{ fontSize: 11.5, color: A.inkSoft, marginTop: 4, lineHeight: 1.45 }}>{r.blurb}</div>
            </div>
          ))}
        </div>
      </SSection>

      <SSection
        title={`Active helpers · ${helpers.length}`}
        right={<button style={{ ...A_primaryBtn, padding: "6px 12px", fontSize: 12 }}><Icon.Plus size={11} /> Invite helper</button>}>
        {helpers.map((h, i) => (
          <div key={h.email} style={{
            padding: "10px 0", borderTop: i === 0 ? "none" : `1px solid ${A.dividerSoft}`,
            display: "grid", gridTemplateColumns: "auto 1fr auto auto auto", gap: 12, alignItems: "center"
          }}>
            <div style={{ width: 36, height: 36, borderRadius: 99, background: A.sky, color: A.cream, display: "grid", placeItems: "center", fontWeight: 700, fontSize: 14 }}>{h.name[0]}</div>
            <div>
              <div style={{ fontSize: 13, color: A.ink, fontWeight: 600 }}>{h.name}</div>
              <div style={{ fontSize: 11.5, color: A.inkMuted, ..._sMono }}>{h.email}</div>
            </div>
            <A_Pill tone="sky">{h.role}</A_Pill>
            <span style={{ ..._sMono, fontSize: 11, color: A.inkSoft }}>last seen {h.lastSeen}</span>
            <button style={{ ...A_ghostBtn, padding: "5px 10px", fontSize: 11.5 }}>Manage</button>
          </div>
        ))}
      </SSection>

      <SSection title={`Pending invites · ${invites.length}`} sub="Tokens are SHA-256 hashed in the DB. Plain token shows once at send.">
        {invites.map((inv) => (
          <div key={inv.token} style={{
            padding: "10px 12px", border: `1px solid ${A.divider}`, borderRadius: 8, background: "#FBF5E6",
            display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 12, alignItems: "center"
          }}>
            <div>
              <div style={{ fontSize: 13, color: A.ink, fontWeight: 600 }}>{inv.email}</div>
              <div style={{ ..._sMono, fontSize: 11, color: A.inkSoft, marginTop: 2 }}>token {inv.token} · sent {inv.sent}</div>
            </div>
            <A_Pill tone="wheat">{inv.role}</A_Pill>
            <span style={{ ..._sMono, fontSize: 11, color: A.wheat, fontWeight: 600 }}>expires {inv.expires}</span>
            <div style={{ display: "flex", gap: 6 }}>
              <button style={{ ...A_ghostBtn, padding: "5px 10px", fontSize: 11.5 }}>Resend</button>
              <button style={{ ...A_ghostBtn, padding: "5px 10px", fontSize: 11.5, color: A.rust }}>Revoke</button>
            </div>
          </div>
        ))}
      </SSection>
    </ASettingsShell>
  );
}

/* ═══════════════════ 4 · Sprayers & calibration ════════════════ */
function ASettingsSprayersScreen() {
  const A = window.A_tokens;
  const sprayers = [
    { id: "S1", name: "Tow boom · 80 gal",   nozzles: "TeeJet TT11003 · 8 nozzles", lastCal: "May 4", gpa: 18.4, status: "ok",     lastSpray: "atrazine + 2,4-D" },
    { id: "S2", name: "Backpack · 4 gal",    nozzles: "TeeJet AI80015 · 1 nozzle",  lastCal: "Apr 22", gpa: 31.2, status: "decon", lastSpray: "Roundup PowerMax (needs decon → orchard)" },
    { id: "S3", name: "ATV mounted · 25 gal", nozzles: "TeeJet XR8002 · 4 nozzles",  lastCal: "Mar 10 (stale)", gpa: 22.0, status: "stale" },
  ];
  return (
    <ASettingsShell
      title="Sprayers & calibration"
      kicker="Equipment"
      badge={<A_Pill tone="rust">1 decon needed</A_Pill>}>

      <SSection title="UC-10 · 1/128-acre calibration" sub="Re-calibrate quarterly or after a nozzle swap. Locks the dilution table for that sprayer until done.">
        <div style={{ padding: "12px 14px", background: "#EFF6E9", border: `1px solid #C9DBC0`, borderRadius: 8, fontSize: 12.5, color: A.forestDeep, lineHeight: 1.55 }}>
          <strong>How it works:</strong> spray water into a 18.5 × 18.5 ft square (1/128 ac) at your typical pace. The ounces caught = your GPA. CropCard locks the dilution math against this GPA until you re-calibrate.
          <button style={{
            marginTop: 8, background: A.forest, color: A.cream, border: "none",
            padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 6
          }}><Icon.Tool size={12} /> Open calibration wizard</button>
        </div>
      </SSection>

      <SSection
        title={`Sprayers · ${sprayers.length}`}
        right={<button style={{ ...A_primaryBtn, padding: "6px 12px", fontSize: 12 }}><Icon.Plus size={11} /> Add sprayer</button>}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sprayers.map((s) => {
            const statusColor = s.status === "ok" ? A.forest : s.status === "decon" ? A.rust : A.wheat;
            const statusBg = s.status === "ok" ? "#EFF6E9" : s.status === "decon" ? "#FBE9DE" : "#FBF5E6";
            const statusLabel = s.status === "ok" ? "Calibrated · OK" : s.status === "decon" ? "Decon required" : "Re-calibrate";
            return (
              <div key={s.id} style={{
                padding: "12px 14px", border: `1px solid ${A.dividerSoft}`, borderRadius: 8,
                display: "grid", gridTemplateColumns: "1fr auto auto", gap: 14, alignItems: "center"
              }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="serif" style={{ fontSize: 15, color: A.ink, fontWeight: 600 }}>{s.name}</span>
                    <span style={{ ..._sMono, fontSize: 11, color: A.inkMuted }}>· {s.id}</span>
                  </div>
                  <div style={{ ..._sMono, fontSize: 11.5, color: A.inkSoft, marginTop: 3 }}>{s.nozzles}</div>
                  <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 3 }}>
                    Last calibrated · <span style={{ ..._sMono, color: A.inkSoft }}>{s.lastCal}</span>
                    {" · "}GPA <span style={{ ..._sMono, color: A.ink, fontWeight: 600 }}>{s.gpa}</span>
                    {s.lastSpray && <> · last spray <span style={{ ..._sMono, color: s.status === "decon" ? A.rust : A.inkSoft }}>{s.lastSpray}</span></>}
                  </div>
                </div>
                <span style={{
                  padding: "4px 10px", borderRadius: 99,
                  background: statusBg, color: statusColor,
                  fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase",
                  border: `1px solid ${statusColor}33`
                }}>{statusLabel}</span>
                <button style={{ ...A_ghostBtn, padding: "6px 10px", fontSize: 11.5 }}>
                  {s.status === "decon" ? <><Icon.Tool size={11} /> Decon wizard</> :
                   s.status === "stale" ? <><Icon.Tool size={11} /> Re-calibrate</> :
                   <>Manage</>}
                </button>
              </div>
            );
          })}
        </div>
      </SSection>
    </ASettingsShell>
  );
}

/* ═══════════════════ 5 · Plugins & crop library ════════════════ */
function ASettingsPluginsScreen() {
  const A = window.A_tokens;
  const counts = { total: 308, crops: 137, herbicides: 64, insecticides: 41, fungicides: 28, fertilizers: 18, companions: 20, failures: 0, updates: 2, drafts: 3 };
  const drafts = [
    { name: "Surround WP", source: "AI photo · May 22", status: "Pending curator", lacks: "REI value" },
    { name: "Hudson Valley Marigold mix", source: "Manual entry · May 14", status: "Pending curator", lacks: "Active ingredient list" },
    { name: "Cueva 1% Cu octanoate", source: "Search · Claude lookup", status: "Pending curator", lacks: "Tank-mix incompatibility list" },
  ];
  return (
    <ASettingsShell title="Plugins & crop library" kicker="Catalog" badge={<A_Pill tone="wheat">{counts.updates} updates</A_Pill>}>
      <SSection title="Plugin inventory" sub="All data-only. Plugin engine validates on registration; no JS executes from plugin files.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
          {[
            ["Crops", counts.crops], ["Herbicides", counts.herbicides], ["Insecticides", counts.insecticides],
            ["Fungicides", counts.fungicides], ["Fertilizers", counts.fertilizers], ["Companions", counts.companions]
          ].map(([k, v]) => (
            <div key={k} style={{ padding: "10px 12px", background: A.cream, border: `1px solid ${A.dividerSoft}`, borderRadius: 8 }}>
              <div className="serif" style={{ fontSize: 22, color: A.forestDeep, lineHeight: 1, fontWeight: 600, letterSpacing: "-0.02em" }}>{v}</div>
              <div style={{ fontSize: 10.5, color: A.inkMuted, marginTop: 4, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>{k}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <button style={A_ghostBtn}><Icon.Search size={13} /> Browse marketplace</button>
          <button style={A_ghostBtn}><Icon.Plus size={13} /> Upload plugin JSON</button>
          <button style={A_ghostBtn}><Icon.FileText size={13} /> Plugin spec docs</button>
        </div>
      </SSection>

      <SSection title={`Pending draft plugins · ${drafts.length}`} sub="Stock entries that aren't EPA-registered yet. Curator review before safety-kernel eligibility.">
        <div style={{ border: `1px solid ${A.dividerSoft}`, borderRadius: 8, overflow: "hidden" }}>
          {drafts.map((d, i) => (
            <div key={d.name} style={{
              padding: "10px 14px", borderTop: i === 0 ? "none" : `1px solid ${A.dividerSoft}`,
              display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 12, alignItems: "center"
            }}>
              <div>
                <div style={{ fontSize: 13, color: A.ink, fontWeight: 600 }}>{d.name}</div>
                <div style={{ ..._sMono, fontSize: 11, color: A.inkMuted, marginTop: 2 }}>{d.source}</div>
              </div>
              <div style={{ fontSize: 11.5, color: A.wheat }}>
                <strong>{d.status}</strong> · missing: {d.lacks}
              </div>
              <button style={{ ...A_ghostBtn, padding: "5px 10px", fontSize: 11.5 }}>Review</button>
            </div>
          ))}
        </div>
      </SSection>

      <SSection title="Updates available · 2" sub="Plugin maintainers occasionally push label corrections.">
        {[
          { name: "atrazine-4l (Drexel)", from: "1.2.0", to: "1.2.1", note: "Adds 24-hr REI exception for spot-treat." },
          { name: "apple-orchard", from: "1.3.0", to: "1.4.0", note: "Goldrush variety added · pick window refined." },
        ].map((u, i) => (
          <div key={u.name} style={{
            padding: "10px 0", borderTop: i === 0 ? "none" : `1px solid ${A.dividerSoft}`,
            display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12, alignItems: "center"
          }}>
            <div>
              <div style={{ ..._sMono, fontSize: 12.5, color: A.ink, fontWeight: 600 }}>{u.name}</div>
              <div style={{ fontSize: 11.5, color: A.inkSoft, marginTop: 2 }}>{u.note}</div>
            </div>
            <span style={{ ..._sMono, fontSize: 11.5, color: A.inkMuted }}>{u.from} → <strong style={{ color: A.forestDeep }}>{u.to}</strong></span>
            <button style={{ ...A_ghostBtn, padding: "5px 10px", fontSize: 11.5 }}>Update</button>
          </div>
        ))}
      </SSection>
    </ASettingsShell>
  );
}

/* ═══════════════════ 6 · Records & retention ═══════════════════ */
function ASettingsRecordsScreen() {
  const A = window.A_tokens;
  return (
    <ASettingsShell title="Records & retention" kicker="Compliance & audit">
      <SSection title="Retention policy" sub="VDACS expects 2 years. CropCard retains the spray + harvest hash chain for 7 years.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {[
            { k: "Spray events", v: "7 yr", note: "FR-09 lock + hash chain" },
            { k: "Harvest events", v: "7 yr", note: "Full provenance" },
            { k: "Scout events", v: "3 yr", note: "Trend analysis" },
            { k: "Application photos", v: "1 yr", note: "Optional · disable per-event" },
          ].map((r) => (
            <div key={r.k} style={{ padding: "10px 12px", background: A.cream, border: `1px solid ${A.dividerSoft}`, borderRadius: 8 }}>
              <div className="serif" style={{ fontSize: 20, color: A.forestDeep, lineHeight: 1, fontWeight: 600 }}>{r.v}</div>
              <div style={{ fontSize: 11, color: A.ink, marginTop: 5, fontWeight: 700 }}>{r.k}</div>
              <div style={{ fontSize: 10.5, color: A.inkMuted, marginTop: 2 }}>{r.note}</div>
            </div>
          ))}
        </div>
      </SSection>

      <SSection title="Lock window" sub="FR-09 · spray records become immutable after this many hours. Server-enforced regardless of UI.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 14, alignItems: "center" }}>
          <SField label="Lock after" hint="hours">
            <input style={{ ..._sInput, ..._sMono }} defaultValue="48" type="number" />
          </SField>
          <div style={{ padding: "10px 12px", background: "#FBF5E6", border: `1px solid #E2D3A4`, borderRadius: 6, fontSize: 11.5, color: "#8A6722", lineHeight: 1.5 }}>
            <strong>Important:</strong> setting below 24h surfaces a curator warning. Setting above 96h triggers a VDACS escalation review (events should be locked promptly).
          </div>
        </div>
      </SSection>

      <SSection title="Hash chain integrity" sub="Every record signs the previous record's hash. A tampered row breaks the chain.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 10 }}>
          {[
            { k: "Chain length", v: "2,418 records" },
            { k: "Last verified", v: "today · 8:40 AM" },
            { k: "Oldest record", v: "Mar 12, 2024" },
          ].map((r) => (
            <div key={r.k}>
              <div style={_sKic()}>{r.k}</div>
              <div style={{ ..._sMono, fontSize: 13, color: A.ink, marginTop: 3 }}>{r.v}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={A_ghostBtn}><Icon.Lock size={12} /> Re-verify chain</button>
          <button style={A_ghostBtn}><Icon.FileText size={12} /> Download VDACS audit pack</button>
          <button style={A_ghostBtn}><Icon.Plus size={12} /> Create inspector link</button>
        </div>
      </SSection>
    </ASettingsShell>
  );
}

/* ═══════════════════ 7 · AI assistant ═════════════════════════ */
function ASettingsAIScreen() {
  const A = window.A_tokens;
  const ai = MOCK.aiSettings;
  return (
    <ASettingsShell
      title="AI planning assistant"
      kicker="Claude"
      badge={MOCK.aiEnabled ? <A_Pill tone="forest"><Icon.Check size={10} /> Active</A_Pill> : <A_Pill tone="rust">No key</A_Pill>}>

      <SSection title="API key & cap" sub="Stored locally · never sent to the CropCard server.">
        <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16 }}>
          <SField label="Claude API key" hint="sk-ant-…">
            <input style={{ ..._sInput, ..._sMono }} type="password" defaultValue={ai.keyMasked || "sk-ant-•••••••••••••••••"} />
          </SField>
          <SField label="Model">
            <select style={_sInput} defaultValue={ai.model}>
              <option>claude-haiku-4-5</option>
              <option>claude-sonnet-4-5</option>
            </select>
          </SField>
        </div>
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
            <span style={_sKic()}>Monthly cap · USD</span>
            <span style={{ ..._sMono, fontSize: 12, color: A.ink, fontWeight: 600 }}>${ai.monthlyCapUSD}.00</span>
          </div>
          <div style={{ height: 8, background: A.cream, borderRadius: 99, position: "relative", overflow: "hidden", border: `1px solid ${A.divider}` }}>
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(ai.spendThisMonth / ai.monthlyCapUSD) * 100}%`, background: A.forest }} />
          </div>
          <div style={{ marginTop: 4, display: "flex", justifyContent: "space-between", fontSize: 10.5, color: A.inkMuted, ..._sMono }}>
            <span>$0</span><span>${ai.spendThisMonth} spent · {ai.callsThisMonth} calls</span><span>${ai.monthlyCapUSD} cap</span>
          </div>
        </div>
      </SSection>

      <SSection title="Per-endpoint daily quota" sub="Each AI endpoint has its own cap. Hitting a quota falls back to deterministic mode for the rest of the day.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {[
            { e: "/api/plan/allocate",        quota: 10, used: 4 },
            { e: "/api/plan/schedule",        quota: 10, used: 2 },
            { e: "/api/plan/inputs",          quota: 10, used: 6 },
            { e: "/api/plan/inputs/refine",   quota: 10, used: 1 },
            { e: "/api/stock/extract-photo",  quota: 30, used: 13, label: "Stock photo extract" },
            { e: "/api/stock/search-web",     quota: 20, used: 5,  label: "Search → web lookup" },
          ].map((q) => (
            <div key={q.e} style={{
              display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center",
              padding: "9px 12px", border: `1px solid ${A.dividerSoft}`, borderRadius: 6
            }}>
              <div>
                <div style={{ fontSize: 12.5, color: A.ink, fontWeight: 600 }}>{q.label || q.e}</div>
                <div style={{ ..._sMono, fontSize: 10.5, color: A.inkMuted, marginTop: 2 }}>{q.label ? q.e : ""}</div>
              </div>
              <span style={{ ..._sMono, fontSize: 11.5, color: q.used >= q.quota * 0.8 ? A.wheat : A.forestDeep, fontWeight: 600 }}>
                {q.used}/{q.quota}
              </span>
            </div>
          ))}
        </div>
      </SSection>

      <SSection title="What's gated vs always-works" sub="Deterministic fallbacks ensure CropCard remains usable when AI is off, offline, or rate-limited.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <div style={_sKic()}>Gated by AI</div>
            <div style={{ marginTop: 6 }}>
              {ai.gatedFeatures.map((g, i) => (
                <div key={i} style={{ fontSize: 12, color: A.ink, lineHeight: 1.7, paddingLeft: 14, position: "relative" }}>
                  <span style={{ position: "absolute", left: 0, top: 8, width: 5, height: 5, borderRadius: 99, background: A.forest }} />
                  {g}
                </div>
              ))}
            </div>
          </div>
          <div style={{ paddingLeft: 18, borderLeft: `1px solid ${A.dividerSoft}` }}>
            <div style={_sKic()}>Always works</div>
            <div style={{ marginTop: 6 }}>
              {ai.keepWorking.map((k, i) => (
                <div key={i} style={{ fontSize: 12, color: A.ink, lineHeight: 1.7, paddingLeft: 14, position: "relative" }}>
                  <Icon.Check size={11} stroke={A.forest} style={{ position: "absolute", left: -2, top: 6 }} />
                  {k}
                </div>
              ))}
            </div>
          </div>
        </div>
      </SSection>
    </ASettingsShell>
  );
}

/* ═══════════════════ 8 · Integrations ═════════════════════════ */
function ASettingsIntegrationsScreen() {
  const A = window.A_tokens;
  const integrations = [
    { id: "weather", name: "Weather · NOAA + NEWA",   status: "connected", note: "Drives FHB + PM forecasts · 8 mi station radius", since: "Mar 2024" },
    { id: "soil",    name: "Soil-test · UMD Extension", status: "connected", note: "Last test Apr 2025 · pulls organic-matter + P + K + pH per block", since: "Apr 2024" },
    { id: "usda",    name: "USDA · soil-survey + frost", status: "connected", note: "Catlett + Penn silt loam zones · last-frost-safe dates", since: "Mar 2024" },
    { id: "vdacs",   name: "VDACS · inspector links",    status: "connected", note: "Time-boxed read-only audit links", since: "Mar 2024" },
    { id: "qb",      name: "Quickbooks · sales + COGS",  status: "planned",   note: "Will feed harvest sales → P&L · gated behind owner consent", since: null },
    { id: "csa",     name: "CSA member portal (Mailchimp)", status: "planned", note: "Weekly harvest broadcast + member ratings", since: null },
    { id: "fsa",     name: "FSA crop-reporting",         status: "planned",   note: "Acreage report 578 auto-fill", since: null },
  ];
  return (
    <ASettingsShell title="Integrations" kicker="Connected services">
      <SSection title="Active integrations">
        {integrations.filter((i) => i.status === "connected").map((it, i) => (
          <div key={it.id} style={{
            padding: "12px 0", borderTop: i === 0 ? "none" : `1px solid ${A.dividerSoft}`,
            display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 14, alignItems: "center"
          }}>
            <div style={{ width: 36, height: 36, borderRadius: 7, background: "#E5EEDF", color: A.forest, display: "grid", placeItems: "center" }}>
              <Icon.Cloud size={16} />
            </div>
            <div>
              <div style={{ fontSize: 13.5, color: A.ink, fontWeight: 600 }}>{it.name}</div>
              <div style={{ fontSize: 11.5, color: A.inkSoft, marginTop: 2 }}>{it.note}</div>
              <div style={{ ..._sMono, fontSize: 10.5, color: A.inkMuted, marginTop: 2 }}>connected since {it.since}</div>
            </div>
            <A_Pill tone="forest"><Icon.Check size={10} /> connected</A_Pill>
            <button style={{ ...A_ghostBtn, padding: "5px 10px", fontSize: 11.5 }}>Manage</button>
          </div>
        ))}
      </SSection>

      <SSection title="Planned integrations" sub="On the roadmap. Open issues in the repo to track or sponsor a particular one.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {integrations.filter((i) => i.status === "planned").map((it) => (
            <div key={it.id} style={{
              padding: "10px 12px", background: A.cream, border: `1px dashed ${A.divider}`, borderRadius: 8,
              display: "grid", gridTemplateColumns: "auto 1fr", gap: 10
            }}>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: A.dividerSoft, color: A.inkSoft, display: "grid", placeItems: "center" }}>
                <Icon.Cloud size={13} />
              </div>
              <div>
                <div style={{ fontSize: 12.5, color: A.ink, fontWeight: 600 }}>{it.name}</div>
                <div style={{ fontSize: 11, color: A.inkMuted, marginTop: 3, lineHeight: 1.4 }}>{it.note}</div>
              </div>
            </div>
          ))}
        </div>
      </SSection>
    </ASettingsShell>
  );
}

/* ═══════════════════ 9 · Plan & billing ══════════════════════════ */
function ASettingsBillingScreen() {
  const A = window.A_tokens;
  return (
    <ASettingsShell title="Plan & billing" kicker="Subscription">
      <SSection title="Current plan" sub="Single-tenant. SQLite + Litestream to Azure Blob.">
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 18 }}>
          <div style={{ padding: "16px 18px", background: "#EFF6E9", border: `1.5px solid ${A.forest}`, borderRadius: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="serif" style={{ fontSize: 20, color: A.forestDeep, letterSpacing: "-0.015em" }}>Solo</span>
              <A_Pill tone="forest">Current</A_Pill>
            </div>
            <div style={{ marginTop: 6, ..._sMono, fontSize: 13, color: A.forestDeep, fontWeight: 600 }}>$12/mo · 1 owner · unlimited helpers</div>
            <ul style={{ margin: "10px 0 0", paddingLeft: 18, color: A.inkSoft, fontSize: 12.5, lineHeight: 1.7 }}>
              <li>Full safety kernel + plugin engine</li>
              <li>Offline-first PWA</li>
              <li>VDACS audit pack export</li>
              <li>BYO Claude key (no AI fees from us)</li>
            </ul>
          </div>
          <div>
            <div style={_sKic()}>Storage</div>
            <div style={{ ..._sMono, fontSize: 13, color: A.ink, marginTop: 4 }}>~$1.10/mo · Azure Blob</div>
            <div style={{ marginTop: 12, ..._sKic() }}>Bandwidth</div>
            <div style={{ ..._sMono, fontSize: 13, color: A.ink, marginTop: 4 }}>~$0.80/mo · scale-to-zero</div>
            <div style={{ marginTop: 12, ..._sKic() }}>Next invoice</div>
            <div style={{ ..._sMono, fontSize: 13, color: A.ink, marginTop: 4 }}>Jun 1 · $12.00</div>
          </div>
        </div>
      </SSection>

      <SSection title="Usage counters · this month" sub="Tracked per-owner under owner_usage_counters table (Phase 18g).">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {[
            ["Spray events",   42, 200, A.forest],
            ["Harvest events", 18, 200, A.forest],
            ["AI calls (allocate)", 6, 60, A.sky],
            ["AI calls (inputs)",  18, 60, A.sky],
          ].map(([k, v, cap, c]) => (
            <div key={k} style={{ padding: "10px 12px", background: A.cream, border: `1px solid ${A.dividerSoft}`, borderRadius: 8 }}>
              <div style={{ ..._sKic(), color: "#7A7F75" }}>{k}</div>
              <div style={{ marginTop: 4, display: "flex", alignItems: "baseline", gap: 6 }}>
                <span className="serif" style={{ fontSize: 22, color: c, fontWeight: 600, letterSpacing: "-0.02em" }}>{v}</span>
                <span style={{ ..._sMono, fontSize: 11.5, color: A.inkMuted }}>/ {cap}</span>
              </div>
              <div style={{ marginTop: 6, height: 5, background: A.dividerSoft, borderRadius: 99, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(v / cap * 100)}%`, background: c }} />
              </div>
            </div>
          ))}
        </div>
      </SSection>

      <SSection title="Payment method">
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 14px", border: `1px solid ${A.dividerSoft}`, borderRadius: 8 }}>
          <div style={{ width: 40, height: 28, borderRadius: 4, background: A.forestDeep, color: A.cream, display: "grid", placeItems: "center", fontSize: 10, fontWeight: 700, ..._sMono }}>VISA</div>
          <div style={{ flex: 1 }}>
            <div style={{ ..._sMono, fontSize: 12.5, color: A.ink, fontWeight: 600 }}>•••• 4082</div>
            <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 2 }}>Sherry M. · expires 09/2027</div>
          </div>
          <button style={{ ...A_ghostBtn, padding: "5px 10px", fontSize: 11.5 }}>Update</button>
        </div>
      </SSection>

      <SSection title="Upgrade paths" sub="If you outgrow Solo. We don't push them — single-replica is the right shape for one farm.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {[
            { name: "Co-op",  price: "$36/mo", who: "2-5 farms sharing curators · separate tenant DBs · still single-writer per farm" },
            { name: "Hosted", price: "$120/mo", who: "We host + back up · multi-writer scale, Postgres + Litestream replacement · contact us" },
          ].map((p) => (
            <div key={p.name} style={{ padding: "12px 14px", border: `1px solid ${A.dividerSoft}`, borderRadius: 8 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span className="serif" style={{ fontSize: 16, color: A.forestDeep }}>{p.name}</span>
                <span style={{ ..._sMono, fontSize: 12.5, color: A.ink, fontWeight: 600 }}>{p.price}</span>
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: A.inkSoft, lineHeight: 1.5 }}>{p.who}</div>
            </div>
          ))}
        </div>
      </SSection>
    </ASettingsShell>
  );
}

/* ═══════════════════ 10 · Advanced & danger ═══════════════════ */
function ASettingsAdvancedScreen() {
  const A = window.A_tokens;
  const adv = MOCK.settingsData.advanced;
  return (
    <ASettingsShell title="Advanced & export-all" kicker="Danger zone" hideFooter>
      <SSection title="Diagnostics" sub="Server-reported. Paste into a bug report.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
          {[
            ["Build version",    adv.buildVersion],
            ["Rules version",    adv.rulesVersion],
            ["Plugin failures",  adv.pluginFailures],
            ["Tenant ID",        adv.tenantId],
            ["Last Litestream backup", adv.lastBackup],
            ["Storage tier",     "SQLite · Litestream → Azure Blob"],
          ].map(([k, v]) => (
            <div key={k}>
              <div style={_sKic()}>{k}</div>
              <div style={{ ..._sMono, fontSize: 12.5, color: A.ink, marginTop: 3 }}>{v}</div>
            </div>
          ))}
        </div>
        <button style={{ ...A_ghostBtn, marginTop: 14, padding: "6px 12px", fontSize: 12 }}>
          <Icon.FileText size={12} /> Copy diagnostics to clipboard
        </button>
      </SSection>

      <SSection title="Bulk export" sub="Pulls everything for this owner_id. Useful for moving farms or year-end archive.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {[
            { name: "Spray events",     fmt: "CSV + signed JSON", size: "1.2 MB" },
            { name: "Harvest events",   fmt: "CSV + signed JSON", size: "640 KB" },
            { name: "Plan + commits",   fmt: "JSON snapshot",     size: "180 KB" },
            { name: "Plugin snapshot",  fmt: "tarball",           size: "3.4 MB" },
            { name: "Blocks + geometry",fmt: "GeoJSON",           size: "12 KB" },
            { name: "Full account · everything", fmt: "tar.gz",   size: "~ 5.3 MB" },
          ].map((e) => (
            <div key={e.name} style={{
              padding: "10px 12px", border: `1px solid ${A.dividerSoft}`, borderRadius: 8,
              display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center"
            }}>
              <div>
                <div style={{ fontSize: 12.5, color: A.ink, fontWeight: 600 }}>{e.name}</div>
                <div style={{ ..._sMono, fontSize: 10.5, color: A.inkMuted, marginTop: 2 }}>{e.fmt} · {e.size}</div>
              </div>
              <button style={{ ...A_ghostBtn, padding: "5px 9px", fontSize: 11 }}><Icon.FileText size={11} /></button>
            </div>
          ))}
        </div>
      </SSection>

      <A_Card padded={false} style={{ borderColor: "#E2B69E", borderWidth: 1.5 }}>
        <div style={{ padding: "13px 18px 11px", background: "#FBF1E5", borderBottom: `1px solid #E2B69E` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon.Alert size={15} stroke={A.rust} />
            <h3 className="serif" style={{ margin: 0, fontSize: 16, color: "#8A341B", letterSpacing: "-0.01em" }}>Danger zone</h3>
          </div>
          <div style={{ fontSize: 11.5, color: "#8A341B", marginTop: 4 }}>Irreversible operations · double-confirm required.</div>
        </div>
        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          {[
            { title: "Transfer farm ownership",  desc: "Re-assigns this owner_id to another user. Spray records remain locked under the original signer; helpers stay attached.", btn: "Transfer…" },
            { title: "Reset plugin overrides",   desc: "Removes all your custom plugin overrides. Crop + input plugins fall back to marketplace defaults.", btn: "Reset…" },
            { title: "Delete all data",          desc: "Erases everything: spray records, harvest events, blocks, plugins, sessions. VDACS hash chain is also destroyed — you can never prove tampering didn't happen.", btn: "Delete…", danger: true },
          ].map((d) => (
            <div key={d.title} style={{
              padding: "10px 12px", border: `1px solid ${d.danger ? "#E2B69E" : A.dividerSoft}`, borderRadius: 8,
              display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center"
            }}>
              <div>
                <div style={{ fontSize: 13, color: d.danger ? "#8A341B" : A.ink, fontWeight: 700 }}>{d.title}</div>
                <div style={{ fontSize: 11.5, color: A.inkSoft, marginTop: 3, lineHeight: 1.45 }}>{d.desc}</div>
              </div>
              <button style={{
                background: d.danger ? "#A64A2A" : "transparent",
                color: d.danger ? A.cream : A.rust,
                border: d.danger ? "none" : `1px solid ${A.rust}`,
                padding: "6px 12px", borderRadius: 6,
                fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit"
              }}>{d.btn}</button>
            </div>
          ))}
        </div>
      </A_Card>
    </ASettingsShell>
  );
}

window.A_SettingsAccount      = ASettingsAccountScreen;
window.A_SettingsFarm         = ASettingsFarmScreen;
window.A_SettingsHelpers      = ASettingsHelpersScreen;
window.A_SettingsSprayers     = ASettingsSprayersScreen;
window.A_SettingsPlugins      = ASettingsPluginsScreen;
window.A_SettingsRecords      = ASettingsRecordsScreen;
window.A_SettingsAI           = ASettingsAIScreen;
window.A_SettingsIntegrations = ASettingsIntegrationsScreen;
window.A_SettingsBilling      = ASettingsBillingScreen;
window.A_SettingsAdvanced     = ASettingsAdvancedScreen;
