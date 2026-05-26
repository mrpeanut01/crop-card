/* Direction A — Almanac · Inventory system (unified)
   ────────────────────────────────────────────────────
   This file aligns every inventory-bearing surface in CropCard around
   one canonical pattern:

       Taxonomy → List → Detail → Edit/Add → (back to List)

   The pattern is shared, the *fields* differ per inventory type:

   ┌───────────────┬─────────────────────────────────────────────────┐
   │ Pesticide     │ AI · MoA · REI · PHI · EPA · signal · rate range │
   │ Fertility     │ NPK · density · OMRI · application rate          │
   │ Seed & starts │ Variety · germ% · year · treated · source · GMO   │
   │ Crop plugin   │ Archetype · varieties · stages · pests (catalog) │
   │ Sprayer       │ Nozzle · tank · last calibrated · GPA (asset)    │
   └───────────────┴─────────────────────────────────────────────────┘

   Stock = lots on hand (instances).  Plugins = catalog (definitions).
   Today they live in different screens with different chrome; this
   spec collapses them into one tabbed surface where Stock is "lots"
   and Plugins is "catalog" — same row anatomy, same actions, only
   the column set + detail-card slots change. */


/* ── Inventory-shared tokens ─────────────────────────────────── */
const _invMono = { fontFamily: "IBM Plex Mono, ui-monospace, monospace" };
const _invKicker = (extra = {}) => ({
  fontSize: 10.5, fontWeight: 700, color: "#7A7F75",
  letterSpacing: "0.1em", textTransform: "uppercase", ...extra
});
const _invInput = {
  border: `1px solid ${window.A_tokens.divider}`,
  background: window.A_tokens.paper,
  color: window.A_tokens.ink,
  padding: "9px 11px", borderRadius: 6,
  fontSize: 13, fontFamily: "inherit", outline: "none", width: "100%"
};

/* The 5 canonical inventory types — colour/icon are stable so the
   user learns "wheat triangle = insecticide" once and it never moves. */
const INV_TYPES = {
  pesticide: { label: "Pesticide",  short: "pest",    icon: "Spray",    tone: "rust",
               note: "Herbicide · insecticide · fungicide · adjuvant" },
  fertility: { label: "Fertility",  short: "fert",    icon: "Sprout",   tone: "forest",
               note: "Synthetic, mineral, biological, compost" },
  seed:      { label: "Seed & starts", short: "seed", icon: "Bucket",   tone: "wheat",
               note: "Seed · transplants · companion starts" },
  crop:      { label: "Crop plugins", short: "crop",  icon: "Leaf",     tone: "sky",
               note: "Catalog · archetype-keyed renderers" },
  sprayer:   { label: "Sprayers",   short: "equip",   icon: "Tool",     tone: "neutral",
               note: "Tow boom · backpack · spot · ATV" },
};

/* ── Shared inventory chrome ─────────────────────────────────── */
function InvKVP({ k, v, mono, tone }) {
  const A = window.A_tokens;
  return (
    <div>
      <div style={_invKicker()}>{k}</div>
      <div style={{
        marginTop: 3, fontSize: 13, color: tone || A.ink,
        ...(mono ? _invMono : {}),
        fontWeight: mono ? 500 : 400
      }}>{v}</div>
    </div>
  );
}

function InvField({ label, required, hint, derived, locked, children }) {
  const A = window.A_tokens;
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={_invKicker()}>{label}</span>
        {required && <span style={{ fontSize: 9, color: A.rust, fontWeight: 700, letterSpacing: "0.06em" }}>REQUIRED</span>}
        {derived && (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 3,
            fontSize: 9, color: A.forest, fontWeight: 700, letterSpacing: "0.06em"
          }}>
            <Icon.Sparkle size={9} stroke={A.forest} /> FROM PLUGIN
          </span>
        )}
        {locked && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9, color: A.inkMuted, fontWeight: 700, letterSpacing: "0.06em" }}>
            <Icon.Lock size={9} /> KERNEL-LOCKED
          </span>
        )}
        {hint && <span style={{ marginLeft: "auto", fontSize: 10.5, color: A.inkMuted, ..._invMono }}>{hint}</span>}
      </div>
      {children}
    </label>
  );
}

function InvSection({ title, sub, right, dense, children }) {
  const A = window.A_tokens;
  return (
    <A_Card padded={false} style={{ marginBottom: 12 }}>
      <div style={{
        padding: dense ? "10px 16px 8px" : "12px 18px 10px",
        borderBottom: `1px solid ${A.dividerSoft}`,
        display: "flex", alignItems: "center", gap: 10
      }}>
        <div style={{ flex: 1 }}>
          <div className="serif" style={{ fontSize: 15, color: A.forestDeep, letterSpacing: "-0.01em" }}>{title}</div>
          {sub && <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 2 }}>{sub}</div>}
        </div>
        {right}
      </div>
      <div style={{ padding: dense ? "12px 16px" : "14px 18px" }}>{children}</div>
    </A_Card>
  );
}

/* Type chip — colour-coded inventory type pill. Reused in lists, detail
   headers, and the edit form's type selector. */
function InvTypeChip({ id, active, onClick, count }) {
  const A = window.A_tokens;
  const t = INV_TYPES[id]; if (!t) return null;
  const G = Icon[t.icon] || Icon.Box;
  return (
    <button onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      padding: "7px 12px",
      background: active ? A.forest : A.paper,
      color: active ? A.cream : A.inkSoft,
      border: `1px solid ${active ? A.forest : A.divider}`,
      borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
      fontSize: 12.5, fontWeight: 600
    }}>
      <G size={14} stroke={active ? A.cream : A.inkSoft} />
      <span>{t.label}</span>
      {count != null && (
        <span style={{
          ..._invMono, fontSize: 10.5,
          color: active ? A.cream : A.inkMuted,
          opacity: active ? 0.9 : 1
        }}>{count}</span>
      )}
    </button>
  );
}

/* ════════════════════════════════════════════════════════════════
   ARTBOARD 1 · Inventory taxonomy & data model
   The "read me first" diagram for the whole section.
   ════════════════════════════════════════════════════════════════ */
function A_InventoryTaxonomy() {
  const A = window.A_tokens;

  // Field-coverage matrix: rows are fields, columns are the 5 inv types.
  // Cells: "■" = required, "·" = optional, "—" = not applicable.
  const fields = [
    { f: "Name / brand",          p: "■", fe: "■", s: "■", c: "■", sp: "■" },
    { f: "Manufacturer / source", p: "■", fe: "■", s: "■", c: "·", sp: "■" },
    { f: "Unit of measure",       p: "■", fe: "■", s: "■", c: "—", sp: "—" },
    { f: "On-hand quantity",      p: "■", fe: "■", s: "■", c: "—", sp: "—" },
    { f: "Reorder threshold",     p: "■", fe: "■", s: "·", c: "—", sp: "—" },
    { f: "Storage location",      p: "■", fe: "·", s: "·", c: "—", sp: "■" },
    { f: "Lot # (per receipt)",   p: "■", fe: "·", s: "■", c: "—", sp: "—" },
    { f: "Expiration date",       p: "■", fe: "·", s: "·", c: "—", sp: "—" },
    { f: "EPA reg #",             p: "■", fe: "—", s: "—", c: "—", sp: "—" },
    { f: "Signal word",           p: "■", fe: "—", s: "—", c: "—", sp: "—" },
    { f: "REI · PHI · MoA group", p: "■", fe: "—", s: "—", c: "—", sp: "—" },
    { f: "Rate range",            p: "■", fe: "■", s: "—", c: "—", sp: "—" },
    { f: "Active ingredient(s)",  p: "■", fe: "—", s: "—", c: "—", sp: "—" },
    { f: "Tank-mix gates",        p: "■", fe: "—", s: "—", c: "—", sp: "—" },
    { f: "NPK · S · Ca · Mg",     p: "—", fe: "■", s: "—", c: "—", sp: "—" },
    { f: "Density (if liquid)",   p: "·", fe: "■", s: "—", c: "—", sp: "—" },
    { f: "OMRI / organic",        p: "·", fe: "·", s: "·", c: "—", sp: "—" },
    { f: "Variety / cultivar",    p: "—", fe: "—", s: "■", c: "■", sp: "—" },
    { f: "Germ % · year tested",  p: "—", fe: "—", s: "■", c: "—", sp: "—" },
    { f: "Treated? (seed)",       p: "—", fe: "—", s: "■", c: "—", sp: "—" },
    { f: "Archetype renderer",    p: "—", fe: "—", s: "—", c: "■", sp: "—" },
    { f: "Growth stages",         p: "—", fe: "—", s: "—", c: "■", sp: "—" },
    { f: "Last calibrated",       p: "—", fe: "—", s: "—", c: "—", sp: "■" },
    { f: "Nozzle · GPA · tank",   p: "—", fe: "—", s: "—", c: "—", sp: "■" },
  ];

  // What each type's add-flow methods look like (which of the 5 entry
  // methods are even applicable per type).
  const methods = [
    ["Barcode scan",    "■", "■", "■", "—", "—"],
    ["Label OCR",       "■", "■", "·", "—", "—"],
    ["AI photo",        "■", "■", "■", "—", "—"],
    ["Search catalog",  "■", "■", "■", "■", "·"],
    ["Manual entry",    "■", "■", "■", "■", "■"],
  ];

  const cell = (v) => {
    const tone = v === "■" ? A.forest : v === "·" ? A.inkMuted : "transparent";
    return (
      <span style={{
        display: "inline-block", width: 16, height: 16, lineHeight: "16px",
        textAlign: "center", color: tone,
        fontFamily: "IBM Plex Mono, monospace", fontSize: 13, fontWeight: 700
      }}>{v}</span>
    );
  };

  return (
    <div className="dir-a" style={{
      width: 1440, height: 920,
      padding: "32px 36px",
      background: `linear-gradient(180deg, ${A.cream} 0%, #EFE6CC 100%)`,
      display: "flex", flexDirection: "column", gap: 18, overflow: "hidden"
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 18 }}>
        <div>
          <div style={_invKicker()}>09 · Inventory system</div>
          <h1 className="serif" style={{
            margin: "6px 0 0", fontSize: 36, color: A.forestDeep,
            letterSpacing: "-0.02em", lineHeight: 1.05
          }}>One pattern. Five payloads.</h1>
          <p style={{ margin: "8px 0 0", fontSize: 14, color: A.inkSoft, lineHeight: 1.5, maxWidth: 920 }}>
            Stock-on-hand and the plugin catalog share the same shell: list → detail → edit/add. What differs per inventory type is the data the form collects and the constraints the safety kernel enforces. This page is the contract every inventory screen below conforms to.
          </p>
        </div>
        <div style={{
          marginLeft: "auto", padding: "10px 14px",
          background: A.paper, border: `1px solid ${A.divider}`, borderRadius: 8,
          display: "flex", flexDirection: "column", gap: 4, minWidth: 220
        }}>
          <div style={_invKicker()}>Pattern owner</div>
          <div style={{ fontSize: 12.5, color: A.ink, fontWeight: 600 }}>InventoryShell · v2</div>
          <div style={{ fontSize: 11, color: A.inkMuted, ..._invMono }}>src/lib/inventory/*</div>
          <div style={{ fontSize: 11, color: A.inkMuted, ..._invMono }}>Zod schemas per type</div>
        </div>
      </div>

      {/* Type strip */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10
      }}>
        {Object.entries(INV_TYPES).map(([id, t]) => {
          const G = Icon[t.icon] || Icon.Box;
          return (
            <div key={id} style={{
              padding: "14px 16px", background: A.paper,
              border: `1px solid ${A.divider}`, borderRadius: 10,
              display: "flex", flexDirection: "column", gap: 8
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 7,
                  background: "#E5EEDF", color: A.forest,
                  display: "grid", placeItems: "center"
                }}><G size={16} /></div>
                <div style={{ flex: 1 }}>
                  <div className="serif" style={{ fontSize: 16, color: A.forestDeep, letterSpacing: "-0.01em" }}>{t.label}</div>
                  <div style={{ fontSize: 10.5, color: A.inkMuted, ..._invMono }}>{id}</div>
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: A.inkSoft, lineHeight: 1.45 }}>{t.note}</div>
            </div>
          );
        })}
      </div>

      {/* Two columns: field matrix · entry-method matrix */}
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 14, flex: 1, minHeight: 0 }}>
        {/* Field matrix */}
        <A_Card padded={false} style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ padding: "11px 16px", borderBottom: `1px solid ${A.dividerSoft}` }}>
            <div className="serif" style={{ fontSize: 15, color: A.forestDeep, letterSpacing: "-0.01em" }}>
              Field coverage — what the canonical form captures per type
            </div>
            <div style={{ fontSize: 11, color: A.inkMuted, marginTop: 2 }}>
              <span style={{ color: A.forest, fontWeight: 700 }}>■</span> required &nbsp;·&nbsp;
              <span style={{ color: A.inkMuted, fontWeight: 700 }}>·</span> optional &nbsp;·&nbsp;
              <span style={{ color: A.inkMuted }}>blank</span> n/a
            </div>
          </div>
          <div style={{ overflow: "auto", flex: 1 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead style={{ position: "sticky", top: 0, background: A.cream, zIndex: 1 }}>
                <tr>
                  <th style={{ textAlign: "left", padding: "8px 14px", ..._invKicker(), color: A.inkMuted }}>Field</th>
                  <th style={{ textAlign: "center", padding: "8px 4px", ..._invKicker(), color: A.inkMuted }}>Pesticide</th>
                  <th style={{ textAlign: "center", padding: "8px 4px", ..._invKicker(), color: A.inkMuted }}>Fertility</th>
                  <th style={{ textAlign: "center", padding: "8px 4px", ..._invKicker(), color: A.inkMuted }}>Seed</th>
                  <th style={{ textAlign: "center", padding: "8px 4px", ..._invKicker(), color: A.inkMuted }}>Crop</th>
                  <th style={{ textAlign: "center", padding: "8px 14px", ..._invKicker(), color: A.inkMuted }}>Sprayer</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((row, i) => (
                  <tr key={row.f} style={{ borderTop: `1px solid ${A.dividerSoft}` }}>
                    <td style={{ padding: "6px 14px", fontSize: 12, color: A.ink }}>{row.f}</td>
                    <td style={{ padding: "6px 4px", textAlign: "center" }}>{cell(row.p)}</td>
                    <td style={{ padding: "6px 4px", textAlign: "center" }}>{cell(row.fe)}</td>
                    <td style={{ padding: "6px 4px", textAlign: "center" }}>{cell(row.s)}</td>
                    <td style={{ padding: "6px 4px", textAlign: "center" }}>{cell(row.c)}</td>
                    <td style={{ padding: "6px 14px", textAlign: "center" }}>{cell(row.sp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </A_Card>

        {/* Right column: entry-method matrix + state machine */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
          {/* Entry method matrix */}
          <A_Card padded={false}>
            <div style={{ padding: "11px 16px", borderBottom: `1px solid ${A.dividerSoft}` }}>
              <div className="serif" style={{ fontSize: 15, color: A.forestDeep, letterSpacing: "-0.01em" }}>
                Entry methods — which apply per type
              </div>
              <div style={{ fontSize: 11, color: A.inkMuted, marginTop: 2 }}>
                Same 5-method picker; type controls which tiles render.
              </div>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: A.cream }}>
                  <th style={{ textAlign: "left", padding: "7px 14px", ..._invKicker(), color: A.inkMuted }}>Method</th>
                  <th style={{ textAlign: "center", padding: "7px 4px", ..._invKicker(), color: A.inkMuted }}>P</th>
                  <th style={{ textAlign: "center", padding: "7px 4px", ..._invKicker(), color: A.inkMuted }}>F</th>
                  <th style={{ textAlign: "center", padding: "7px 4px", ..._invKicker(), color: A.inkMuted }}>S</th>
                  <th style={{ textAlign: "center", padding: "7px 4px", ..._invKicker(), color: A.inkMuted }}>C</th>
                  <th style={{ textAlign: "center", padding: "7px 14px", ..._invKicker(), color: A.inkMuted }}>Sp</th>
                </tr>
              </thead>
              <tbody>
                {methods.map(([m, ...cells]) => (
                  <tr key={m} style={{ borderTop: `1px solid ${A.dividerSoft}` }}>
                    <td style={{ padding: "7px 14px", fontSize: 12, color: A.ink }}>{m}</td>
                    {cells.map((v, i) => (
                      <td key={i} style={{ padding: "7px 4px", textAlign: "center" }}>{cell(v)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </A_Card>

          {/* State machine */}
          <A_Card style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div className="serif" style={{ fontSize: 15, color: A.forestDeep, letterSpacing: "-0.01em" }}>
              Lifecycle — same for every type
            </div>
            <div style={{ fontSize: 11, color: A.inkMuted, marginTop: 2 }}>
              Catalog + on-hand are separate models that share the same chrome.
            </div>
            <div style={{
              marginTop: 12, padding: "12px 14px",
              background: A.cream, borderRadius: 8, fontSize: 12,
              ..._invMono, color: A.inkSoft, lineHeight: 1.7
            }}>
              <div>list ── (row) ──▸ detail</div>
              <div>detail ── edit ──▸ form ── save ──▸ list</div>
              <div>list ── add ──▸ method picker ──▸ form ──▸ list</div>
              <div style={{ marginTop: 6 }}>
                <span style={{ color: A.forestDeep, fontWeight: 700 }}>plugins:</span> catalog rows · no lot panel
              </div>
              <div>
                <span style={{ color: A.forestDeep, fontWeight: 700 }}>stock:</span> instance rows · lot panel · linked to catalog
              </div>
            </div>
            <div style={{ marginTop: "auto", paddingTop: 10, fontSize: 11, color: A.inkMuted }}>
              <Icon.Lock size={11} stroke={A.inkSoft} style={{ verticalAlign: "-1px", marginRight: 4 }} />
              Pesticide and crop catalog rows are <strong style={{ color: A.forestDeep }}>safety-kernel-linked</strong>: edits to MoA / REI / PHI require curator sign-off, not just a save.
            </div>
          </A_Card>
        </div>
      </div>
    </div>
  );
}


/* ════════════════════════════════════════════════════════════════
   ARTBOARD 2-5 · Unified Inventory List (parameterized)
   Same chrome, type controls columns + KPIs.  Each artboard below
   instantiates this with a different "type" prop.
   ════════════════════════════════════════════════════════════════ */
function A_InventoryList({ type = "pesticide" }) {
  const A = window.A_tokens;
  const t = INV_TYPES[type];

  /* Per-type config — KPIs, columns, mock rows */
  const config = {
    pesticide: {
      kpis: [
        ["SKUs",       12, A.forestDeep, "Box"],
        ["Short",       3, A.rust,       "Alert"],
        ["Expiring 30d", 1, A.wheat,      "CloudRain"],
        ["Lots",       14, A.inkSoft,    "Layers"],
      ],
      cols: ["Item · AI", "MoA", "Signal", "On hand", "Lots", "Expires"],
      rows: [
        { name: "Inspire Super",          ai: "difenoconazole + cyprodinil", moa: "FRAC 3+9",  sig: "Caution", on: "16 fl oz",  lots: 1, exp: "Aug 2026",  status: "expiring", subType: "fung" },
        { name: "Lannate LV",             ai: "methomyl",                    moa: "IRAC 1A",   sig: "Danger",  on: "2.5 gal",   lots: 1, exp: "Sep 2027",  status: "ok",       subType: "insect", restricted: true },
        { name: "Surround WP",            ai: "kaolin clay",                 moa: "OMRI",      sig: "Caution", on: "10 lb",     lots: 1, exp: "—",         status: "short",    subType: "insect" },
        { name: "Roundup PowerMax 3",     ai: "glyphosate 41%",              moa: "HRAC 9",    sig: "Caution", on: "1.2 gal",   lots: 1, exp: "Oct 2027",  status: "short",    subType: "herb" },
        { name: "Atrazine 4L",            ai: "atrazine",                    moa: "HRAC 5",    sig: "Caution", on: "1.5 gal",   lots: 1, exp: "Jul 2028",  status: "ok",       subType: "herb", restricted: true },
        { name: "Imidan 70-W",            ai: "phosmet",                     moa: "IRAC 1B",   sig: "Warning", on: "5.0 lb",    lots: 1, exp: "Mar 2028",  status: "ok",       subType: "insect" },
        { name: "Captan 80WDG",           ai: "captan",                      moa: "FRAC M4",   sig: "Caution", on: "8 lb",      lots: 2, exp: "Apr 2027",  status: "ok",       subType: "fung" },
        { name: "2,4-D Amine",            ai: "2,4-D",                       moa: "HRAC 4",    sig: "Danger",  on: "0.6 gal",   lots: 1, exp: "May 2027",  status: "short",    subType: "herb" },
      ],
    },
    fertility: {
      kpis: [
        ["SKUs",       7, A.forestDeep, "Box"],
        ["Short",      2, A.rust,       "Alert"],
        ["OMRI",       5, A.forest,     "Check"],
        ["Tons total", 1.8, A.inkSoft,  "Layers"],
      ],
      cols: ["Item", "NPK", "Form", "OMRI", "On hand", "Reorder at"],
      rows: [
        { name: "Urea (46-0-0)",            npk: "46-0-0",    form: "Granular",  omri: false, on: "180 lb",  reorder: "300 lb", status: "short" },
        { name: "DAP (18-46-0)",            npk: "18-46-0",   form: "Granular",  omri: false, on: "240 lb",  reorder: "150 lb", status: "ok" },
        { name: "Potassium Sulfate",        npk: "0-0-50 +18S", form: "Granular", omri: true,  on: "60 lb",   reorder: "80 lb",  status: "short" },
        { name: "Compost — manure-based",   npk: "1-1-1",     form: "Bulk yd³",  omri: true,  on: "4 yd³",   reorder: "2 yd³",  status: "ok" },
        { name: "Fish hydrolysate 2-4-1",   npk: "2-4-1",     form: "Liquid 9.2 lb/gal", omri: true, on: "12 gal", reorder: "8 gal", status: "ok" },
        { name: "Pelletized chicken litter",npk: "4-3-2",     form: "Pellet",    omri: true,  on: "320 lb",  reorder: "200 lb", status: "ok" },
        { name: "Gypsum (Ca sulfate)",      npk: "0-0-0 +22Ca +17S", form: "Granular", omri: true, on: "100 lb", reorder: "50 lb",  status: "ok" },
      ],
    },
    seed: {
      kpis: [
        ["SKUs",         9, A.forestDeep, "Box"],
        ["Short",        3, A.rust,       "Alert"],
        ["Germ retest",  2, A.wheat,      "Calendar"],
        ["OP / Heirloom", 7, A.forest,    "Sprout"],
      ],
      cols: ["Variety", "Origin", "Germ % · year", "Treated", "On hand", "Source"],
      rows: [
        { name: "Cherokee Trail-of-Tears Bean",    origin: "Heirloom · OP",        germ: "92% · 2025", treated: false, on: "0 lb",    src: "Saved · Sherry" ,   status: "short" },
        { name: "Seminole Pumpkin",                origin: "Heirloom · OP",        germ: "88% · 2024", treated: false, on: "0 lb",    src: "SESE",              status: "short" },
        { name: "Painted Mountain Corn",           origin: "OP",                   germ: "94% · 2025", treated: false, on: "3.5 lb",  src: "Adaptive Seeds",    status: "ok" },
        { name: "Bloody Butcher Dent Corn",        origin: "Heirloom · OP",        germ: "85% · 2024", treated: false, on: "5 lb",    src: "SESE",              status: "ok",  retest: true },
        { name: "Provider Bush Bean",              origin: "OP",                   germ: "96% · 2025", treated: false, on: "2 lb",    src: "Johnny's",          status: "ok" },
        { name: "Lemon Cucumber",                  origin: "OP",                   germ: "90% · 2024", treated: false, on: "12 g",    src: "Saved",             status: "ok",  retest: true },
        { name: "Saladin Lettuce",                 origin: "OP",                   germ: "98% · 2025", treated: false, on: "8 g",     src: "Johnny's",          status: "ok" },
        { name: "French Marigold (Sparky)",        origin: "Companion · F1",       germ: "—",          treated: false, on: "0 plants", src: "Local nursery",    status: "short" },
        { name: "Diatect-V Sweet Corn",            origin: "Hybrid · F1",          germ: "92% · 2025", treated: true,  on: "1 lb",    src: "Twilley",           status: "ok" },
      ],
    },
    crop: {
      kpis: [
        ["Loaded",   137, A.forestDeep, "Box"],
        ["Drafts",     3, A.wheat,      "FileText"],
        ["Updates",    2, A.sky,        "ArrowRight"],
        ["Failures",   0, A.forest,     "Check"],
      ],
      cols: ["Plugin id", "Archetype", "Varieties", "Source", "Status", "Version"],
      rows: [
        { name: "bean.cherokee-trail",       arch: "Dry-seed legume",       vars: 1,  src: "core",        status: "loaded", ver: "1.4.0" },
        { name: "corn.bloody-butcher",       arch: "Row-grain · pollination", vars: 1, src: "core",       status: "loaded", ver: "1.6.2" },
        { name: "corn.painted-mountain",     arch: "Row-grain · pollination", vars: 1, src: "core",       status: "loaded", ver: "1.6.0" },
        { name: "pumpkin.seminole",          arch: "Winter squash + cure",  vars: 1,  src: "core",        status: "loaded", ver: "1.3.1" },
        { name: "tomato.heirloom-pack",      arch: "Continuous-harvest",    vars: 12, src: "marketplace", status: "loaded", ver: "2.1.0", updateTo: "2.2.0" },
        { name: "lettuce.cut-and-come",      arch: "Cut-and-come-again",    vars: 8,  src: "core",        status: "loaded", ver: "1.2.0" },
        { name: "apple.orchard",             arch: "Tree fruit · multi-pick", vars: 6, src: "core",       status: "loaded", ver: "1.3.0", updateTo: "1.4.0" },
        { name: "marigold.companion",        arch: "Companion · insectary", vars: 3,  src: "marketplace", status: "loaded", ver: "1.0.4" },
        { name: "rye-vetch.cover",           arch: "Cover crop · termination", vars: 2, src: "core",      status: "loaded", ver: "1.1.0" },
        { name: "alfalfa.orchardgrass-mix",  arch: "Forage cutting cycle",  vars: 1,  src: "core",        status: "loaded", ver: "1.0.0" },
        { name: "marigold.hudson-mix",       arch: "Companion · insectary", vars: 1,  src: "draft",       status: "draft", ver: "0.1.0" },
      ],
    },
    sprayer: {
      kpis: [
        ["Sprayers",   3, A.forestDeep, "Box"],
        ["Decon",      1, A.rust,       "Alert"],
        ["Stale cal",  1, A.wheat,      "Calendar"],
        ["Ready",      1, A.forest,     "Check"],
      ],
      cols: ["Sprayer", "Nozzle", "Tank", "Last cal", "GPA", "Status"],
      rows: [
        { name: "Tow boom · 80 gal",   noz: "TeeJet TT11003",   tank: "80 gal",  cal: "May 4",  gpa: 18.4, status: "ok",    last: "atrazine + 2,4-D" },
        { name: "Backpack · 4 gal",    noz: "Cone · adjustable", tank: "4 gal",  cal: "Apr 2",  gpa: 22.0, status: "stale", last: "glyphosate spot" },
        { name: "ATV spot · 25 gal",   noz: "TeeJet AIXR 8002",  tank: "25 gal", cal: "Mar 22", gpa: 16.8, status: "decon", last: "Lannate (RUP)" },
      ],
    },
  }[type];

  const counts = {
    pesticide: 12, fertility: 7, seed: 9, crop: 137, sprayer: 3
  };

  return (
    <div className="dir-a" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <A_TopBar active={type === "crop" ? "settings" : type === "sprayer" ? "settings" : "stock"} />
      <div style={{ flex: 1, overflow: "auto", padding: "26px 28px 32px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>

          {/* Header */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 18 }}>
            <div>
              <div style={_invKicker()}>Inventory · {t.label}</div>
              <h1 className="serif" style={{
                margin: "6px 0 0", fontSize: 32, color: A.forestDeep,
                letterSpacing: "-0.02em", lineHeight: 1.05
              }}>
                {type === "crop" ? "Crop plugin catalog." : `${t.label}.`}
              </h1>
              <div style={{ marginTop: 6, color: A.inkSoft, fontSize: 13.5 }}>
                {type === "crop"
                  ? <>137 loaded · 3 drafts pending curator · 2 updates available. Plugins are JSON; the engine validates schema, then registers.</>
                  : type === "sprayer"
                  ? <>Track calibration, last application, and decon status. Calibration drift &gt; 30 d locks a sprayer out of RUP applications.</>
                  : <>{t.note}.</>}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={A_ghostBtn}><Icon.FileText size={14} /> Export CSV</button>
              <button style={A_primaryBtn}><Icon.Plus size={14} /> {type === "crop" ? "Upload plugin" : type === "sprayer" ? "Add sprayer" : "Add item"}</button>
            </div>
          </div>

          {/* Type swap — same chrome across all inventory types.
              This is the streamlining: one place, all inventory. */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            {Object.keys(INV_TYPES).map((id) => (
              <InvTypeChip
                key={id} id={id} active={id === type}
                count={counts[id]}
              />
            ))}
            <span style={{ flex: 1 }} />
            {/* Toggle: instances vs catalog — only relevant when both exist for a type */}
            {(type === "pesticide" || type === "fertility" || type === "seed") && (
              <div style={{ display: "inline-flex", border: `1px solid ${A.divider}`, borderRadius: 7, overflow: "hidden" }}>
                {[
                  { id: "stock", label: "Lots on hand" },
                  { id: "catalog", label: "Catalog (plugin)" }
                ].map((m, i) => (
                  <button key={m.id} style={{
                    padding: "7px 12px", fontSize: 12, fontFamily: "inherit",
                    border: "none", cursor: "pointer",
                    background: i === 0 ? A.forest : A.paper,
                    color: i === 0 ? A.cream : A.inkSoft,
                    fontWeight: 600
                  }}>{m.label}</button>
                ))}
              </div>
            )}
          </div>

          {/* KPI strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
            {config.kpis.map(([k, v, c, ic]) => {
              const G = Icon[ic] || Icon.Box;
              return (
                <A_Card key={k} padded={false} style={{ padding: "11px 14px", display: "flex", alignItems: "center", gap: 11 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 8, background: "#E5EEDF", color: c, display: "grid", placeItems: "center" }}>
                    <G size={16} />
                  </div>
                  <div>
                    <div className="serif" style={{ fontSize: 22, color: c, lineHeight: 1, fontWeight: 600, letterSpacing: "-0.02em" }}>{v}</div>
                    <div style={_invKicker({ marginTop: 3 })}>{k}</div>
                  </div>
                </A_Card>
              );
            })}
          </div>

          {/* Search + sub-filter row — same shape per type, filters vary */}
          <A_Card padded={false} style={{ marginBottom: 12 }}>
            <div style={{
              padding: "9px 14px", display: "flex", alignItems: "center", gap: 10,
              borderBottom: `1px solid ${A.dividerSoft}`
            }}>
              <Icon.Search size={14} stroke={A.inkSoft} />
              <input placeholder={`Search ${t.label.toLowerCase()}…`} style={{
                flex: 1, border: "none", outline: "none", background: "transparent",
                fontSize: 13.5, color: A.ink, fontFamily: "inherit"
              }} />
              <span style={{ fontSize: 11, color: A.inkMuted, ..._invMono }}>{config.rows.length} of {counts[type]}</span>
            </div>
            <div style={{ padding: "8px 14px", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {/* Type-specific sub-filters */}
              {type === "pesticide" && ["All", "Herbicide", "Insecticide", "Fungicide", "Restricted-use", "Expiring 30 d", "OMRI"].map((c, i) => (
                <button key={c} style={subFilterChip(i === 0, A)}>{c}</button>
              ))}
              {type === "fertility" && ["All", "Granular", "Liquid", "Bulk / compost", "OMRI", "Short"].map((c, i) => (
                <button key={c} style={subFilterChip(i === 0, A)}>{c}</button>
              ))}
              {type === "seed" && ["All", "OP / Heirloom", "Hybrid F1", "Treated", "Untreated", "Germ retest due"].map((c, i) => (
                <button key={c} style={subFilterChip(i === 0, A)}>{c}</button>
              ))}
              {type === "crop" && ["All", "Core", "Marketplace", "Draft", "Updates available", "By archetype…"].map((c, i) => (
                <button key={c} style={subFilterChip(i === 0, A)}>{c}</button>
              ))}
              {type === "sprayer" && ["All", "Ready", "Stale calibration", "Decon needed", "RUP-cleared"].map((c, i) => (
                <button key={c} style={subFilterChip(i === 0, A)}>{c}</button>
              ))}
            </div>
          </A_Card>

          {/* The table */}
          <A_Card padded={false}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: A.cream }}>
                  {config.cols.map((c, i) => (
                    <th key={c} style={{
                      textAlign: i === config.cols.length - 1 ? "right" : "left",
                      padding: `10px ${i === 0 ? "14px" : i === config.cols.length - 1 ? "14px" : "8px"}`,
                      ..._invKicker(), color: A.inkMuted
                    }}>{c}</th>
                  ))}
                  <th style={{ width: 30 }}></th>
                </tr>
              </thead>
              <tbody>
                {config.rows.map((r, i) => <InventoryRow key={r.name} r={r} type={type} idx={i} />)}
              </tbody>
            </table>
          </A_Card>
        </div>
      </div>
    </div>
  );
}

function subFilterChip(active, A) {
  return {
    padding: "4px 10px", borderRadius: 99,
    border: `1px solid ${active ? A.forest : A.divider}`,
    background: active ? "#E5EEDF" : A.paper,
    color: active ? A.forestDeep : A.inkSoft,
    fontSize: 11.5, fontWeight: active ? 600 : 500,
    cursor: "pointer", fontFamily: "inherit"
  };
}

function InventoryRow({ r, type, idx }) {
  const A = window.A_tokens;
  const bg = r.status === "short" ? "#FBF1E5"
           : r.status === "expiring" ? "#FBF5E6"
           : r.status === "draft" ? "#F4ECD8"
           : r.status === "decon" ? "#F1D9CE"
           : r.status === "stale" ? "#FBF5E6"
           : "transparent";

  const subTone = r.subType === "herb" ? "rust" : r.subType === "insect" ? "wheat" : r.subType === "fung" ? "sky" : "neutral";
  const subLabel = r.subType === "herb" ? "Herbicide" : r.subType === "insect" ? "Insecticide" : r.subType === "fung" ? "Fungicide" : null;

  const td = (children, extra = {}) => (
    <td style={{ padding: "11px 8px", ...extra }}>{children}</td>
  );

  // The rightmost (action) column varies by type — but always something
  const action = r.status === "short" || r.status === "decon"
    ? <button style={{ ...A_primaryBtn, padding: "5px 10px", fontSize: 11, background: r.status === "decon" ? A.rust : A.wheat }}>
        {r.status === "decon" ? "Decon" : "Reorder"}
      </button>
    : r.updateTo
    ? <button style={{ ...A_ghostBtn, padding: "5px 10px", fontSize: 11 }}>Update</button>
    : <Icon.ChevronRight size={13} stroke={A.inkMuted} />;

  return (
    <tr style={{ borderTop: `1px solid ${A.dividerSoft}`, background: bg, cursor: "pointer" }}>
      {/* Column 1 — name + secondary line */}
      {td(
        <>
          <div style={{ fontSize: 13, color: A.ink, fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
            {r.name}
            {r.restricted && (
              <span style={{ fontSize: 9, color: A.rust, fontWeight: 700, letterSpacing: "0.04em", border: `1px solid ${A.rust}`, padding: "1px 4px", borderRadius: 3 }}>RUP</span>
            )}
            {r.treated && (
              <span style={{ fontSize: 9, color: "#8A6722", fontWeight: 700, letterSpacing: "0.04em", border: "1px solid #E2D3A4", padding: "1px 4px", borderRadius: 3 }}>TREATED</span>
            )}
            {r.retest && (
              <span style={{ fontSize: 9, color: A.wheat, fontWeight: 700, letterSpacing: "0.04em" }}>↻ retest</span>
            )}
          </div>
          {type === "pesticide" && r.ai && (
            <div style={{ ..._invMono, fontSize: 11, color: A.inkMuted, marginTop: 2 }}>{r.ai}</div>
          )}
          {type === "seed" && r.origin && (
            <div style={{ fontSize: 11, color: A.inkMuted, marginTop: 2 }}>{r.origin}</div>
          )}
          {type === "crop" && (
            <div style={{ ..._invMono, fontSize: 11, color: A.forestDeep, marginTop: 2 }}>{r.name}</div>
          )}
        </>,
        { padding: "11px 14px" }
      )}

      {/* Columns 2-5 vary by type */}
      {type === "pesticide" && (<>
        {td(<><div style={{ ..._invMono, fontSize: 12, color: A.ink }}>{r.moa}</div>{subLabel && <div style={{ marginTop: 3 }}><A_Pill tone={subTone}>{subLabel}</A_Pill></div>}</>)}
        {td(<span style={{ fontSize: 12, color: r.sig === "Danger" ? A.rust : r.sig === "Warning" ? A.wheat : A.inkSoft, fontWeight: 600 }}>{r.sig}</span>)}
        {td(<span style={{ ..._invMono, fontSize: 13, color: r.status === "short" ? A.rust : A.ink, fontWeight: 600 }}>{r.on}</span>, { textAlign: "right" })}
        {td(<span style={{ ..._invMono, fontSize: 12, color: A.inkMuted }}>{r.lots}</span>, { textAlign: "right" })}
        {td(<span style={{ ..._invMono, fontSize: 12, color: r.status === "expiring" ? A.wheat : A.inkMuted }}>{r.exp}</span>, { padding: "11px 14px" })}
      </>)}

      {type === "fertility" && (<>
        {td(<span style={{ ..._invMono, fontSize: 13, color: A.forestDeep, fontWeight: 700 }}>{r.npk}</span>)}
        {td(<span style={{ fontSize: 12, color: A.inkSoft }}>{r.form}</span>)}
        {td(r.omri ? <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: A.forest, fontWeight: 700 }}><Icon.Check size={10} /> OMRI</span> : <span style={{ fontSize: 11, color: A.inkMuted }}>—</span>)}
        {td(<span style={{ ..._invMono, fontSize: 13, color: r.status === "short" ? A.rust : A.ink, fontWeight: 600 }}>{r.on}</span>, { textAlign: "right" })}
        {td(<span style={{ ..._invMono, fontSize: 12, color: A.inkMuted }}>{r.reorder}</span>, { padding: "11px 14px", textAlign: "right" })}
      </>)}

      {type === "seed" && (<>
        {td(<span style={{ fontSize: 12, color: A.inkSoft }}>{r.origin}</span>)}
        {td(<span style={{ ..._invMono, fontSize: 12, color: A.ink }}>{r.germ}</span>)}
        {td(r.treated
          ? <span style={{ fontSize: 11, color: "#8A6722", fontWeight: 700 }}>Yes</span>
          : <span style={{ fontSize: 11, color: A.forest, fontWeight: 600 }}>No</span>)}
        {td(<span style={{ ..._invMono, fontSize: 13, color: r.status === "short" ? A.rust : A.ink, fontWeight: 600 }}>{r.on}</span>, { textAlign: "right" })}
        {td(<span style={{ fontSize: 11.5, color: A.inkMuted }}>{r.src}</span>, { padding: "11px 14px" })}
      </>)}

      {type === "crop" && (<>
        {td(<span style={{ fontSize: 12, color: A.ink }}>{r.arch}</span>)}
        {td(<span style={{ ..._invMono, fontSize: 12, color: A.inkSoft }}>{r.vars} variet{r.vars === 1 ? "y" : "ies"}</span>, { textAlign: "right" })}
        {td(<span style={{ fontSize: 11, color: r.src === "draft" ? A.wheat : r.src === "core" ? A.forest : "#3A586E", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{r.src}</span>)}
        {td(<span style={{ fontSize: 11.5, color: r.status === "draft" ? A.wheat : A.forest, fontWeight: 600 }}>{r.status === "draft" ? "Pending review" : "Loaded"}</span>)}
        {td(<><span style={{ ..._invMono, fontSize: 12, color: A.inkMuted }}>{r.ver}</span>{r.updateTo && <span style={{ ..._invMono, fontSize: 10.5, color: A.wheat, fontWeight: 700, marginLeft: 4 }}>→ {r.updateTo}</span>}</>, { padding: "11px 14px" })}
      </>)}

      {type === "sprayer" && (<>
        {td(<span style={{ fontSize: 12, color: A.inkSoft }}>{r.noz}</span>)}
        {td(<span style={{ ..._invMono, fontSize: 12, color: A.ink }}>{r.tank}</span>)}
        {td(<span style={{ ..._invMono, fontSize: 12, color: r.status === "stale" ? A.wheat : A.inkMuted }}>{r.cal}</span>)}
        {td(<span style={{ ..._invMono, fontSize: 13, color: A.ink, fontWeight: 600 }}>{r.gpa}</span>, { textAlign: "right" })}
        {td(<span style={{ fontSize: 11.5, color: r.status === "decon" ? A.rust : r.status === "stale" ? A.wheat : A.forest, fontWeight: 600, textTransform: "capitalize" }}>{r.status === "ok" ? "Ready" : r.status}</span>, { padding: "11px 14px" })}
      </>)}

      <td style={{ padding: "11px 14px", textAlign: "right" }}>{action}</td>
    </tr>
  );
}


/* ════════════════════════════════════════════════════════════════
   ARTBOARD 6-9 · Canonical Detail screen, parameterized by type
   Same shell: hero · primary attributes · safety/specs · lots/history
   ════════════════════════════════════════════════════════════════ */
function A_InventoryDetail({ type = "pesticide" }) {
  const A = window.A_tokens;

  return (
    <div className="dir-a" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <A_TopBar active={type === "crop" || type === "sprayer" ? "settings" : "stock"} />
      <InvDetailSubheader type={type} />
      <div style={{ flex: 1, overflow: "auto", padding: "20px 28px 28px", background: A.cream }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          {type === "pesticide" && <PesticideDetail />}
          {type === "fertility" && <FertilityDetail />}
          {type === "seed" && <SeedDetail />}
          {type === "crop" && <CropPluginDetail />}
        </div>
      </div>
    </div>
  );
}

function InvDetailSubheader({ type }) {
  const A = window.A_tokens;
  const meta = {
    pesticide: { kicker: "Stock · Pesticide · 1 of 12", title: "Inspire Super",     sub: "Syngenta · fungicide · 16 fl oz on hand · 1 lot" },
    fertility: { kicker: "Stock · Fertility · 1 of 7",  title: "Urea (46-0-0)",     sub: "Yara · granular · 180 lb on hand · 2 lots · SHORT" },
    seed:      { kicker: "Stock · Seed · 1 of 9",       title: "Cherokee Trail-of-Tears Bean", sub: "Heirloom · OP · 0 lb on hand · germ 92% (2025)" },
    crop:      { kicker: "Catalog · Crop plugin · core", title: "corn.bloody-butcher", sub: "Row-grain · pollination archetype · 1 variety · v1.6.2" },
  }[type];

  return (
    <div style={{ background: A.paper, borderBottom: `1px solid ${A.divider}` }}>
      <div style={{ display: "flex", alignItems: "center", padding: "13px 28px", gap: 16 }}>
        <button style={A_iconBtn} title="Back">
          <Icon.ChevronRight size={16} style={{ transform: "rotate(180deg)" }} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={_invKicker()}>{meta.kicker}</div>
          <div className="serif" style={{ fontSize: 22, color: A.forestDeep, letterSpacing: "-0.015em", lineHeight: 1.1, marginTop: 2 }}>
            {meta.title}
          </div>
          <div style={{ fontSize: 12, color: A.inkMuted, marginTop: 2 }}>{meta.sub}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={A_ghostBtn}><Icon.FileText size={14} /> History CSV</button>
          {type !== "crop" && <button style={A_ghostBtn}><Icon.Plus size={14} /> Receive lot</button>}
          <button style={A_primaryBtn}><Icon.Tool size={14} /> Edit</button>
        </div>
      </div>
    </div>
  );
}

/* Pesticide detail — safety kernel heavy ──────────────────────── */
function PesticideDetail() {
  const A = window.A_tokens;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14, alignItems: "start" }}>
      {/* Left column — specs */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <InvSection title="Plugin link" sub="Read-only mirror of the catalog plugin — keeps stock in lockstep with safety kernel.">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
            <InvKVP k="Plugin id" v="inspire-super" mono />
            <InvKVP k="EPA reg #" v="100-1517" mono />
            <InvKVP k="Manufacturer" v="Syngenta" />
            <InvKVP k="Signal word" v="Caution" tone={A.inkSoft} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginTop: 12 }}>
            <InvKVP k="Active ingredient(s)" v="difenoconazole 7.0% + cyprodinil 27.6%" />
            <InvKVP k="MoA group" v="FRAC 3 + 9" mono />
            <InvKVP k="Formulation" v="EC · 250 g/L" />
          </div>
        </InvSection>

        <InvSection title="Safety kernel" sub="These values come from the plugin and route through the spray-event safety check. Locked here; change only via curator review.">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
            <InvKVP k="REI" v="12 hours" mono />
            <InvKVP k="PHI (apples)" v="72 hours" mono />
            <InvKVP k="PHI (grapes)" v="14 days" mono />
            <InvKVP k="Max applications/yr" v="4 · max 56 fl oz" mono />
          </div>
          <div style={{ marginTop: 12, padding: "10px 12px", background: "#EFF6E9", border: "1px solid #C9DBC0", borderRadius: 6, fontSize: 12, color: A.forestDeep, display: "flex", gap: 8, alignItems: "flex-start" }}>
            <Icon.Lock size={13} stroke={A.forest} style={{ marginTop: 2 }} />
            <span><strong>Tank-mix gates:</strong> incompatible with copper sulfate (precipitate), oil-based adjuvants &gt;1% (phyto), and FRAC 3 fungicides within 14 d (rotation). Editing requires curator sign-off.</span>
          </div>
        </InvSection>

        <InvSection title="Rate range" sub="Per-crop ranges from the plugin. The spray builder will clamp to these unless you override (and log the reason).">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr style={{ color: A.inkMuted, ..._invKicker() }}>
              <th style={{ textAlign: "left", padding: "6px 0" }}>Crop</th>
              <th style={{ textAlign: "right", padding: "6px 0" }}>Low</th>
              <th style={{ textAlign: "right", padding: "6px 0" }}>High</th>
              <th style={{ textAlign: "left", padding: "6px 0 6px 18px" }}>Carrier</th>
              <th style={{ textAlign: "left", padding: "6px 0 6px 18px" }}>Notes</th>
            </tr></thead>
            <tbody>
              {[
                ["Apple", "7 fl oz", "14 fl oz", "50 GPA",  "Sumi-blotch, sooty blotch"],
                ["Grape", "10 fl oz", "16 fl oz", "60 GPA", "Powdery mildew suppression"],
                ["Stone fruit", "7 fl oz", "14 fl oz", "50 GPA", "Brown rot · do not exceed 4 apps"],
              ].map((row) => (
                <tr key={row[0]} style={{ borderTop: `1px solid ${A.dividerSoft}` }}>
                  <td style={{ padding: "7px 0", fontSize: 12.5, color: A.ink, fontWeight: 500 }}>{row[0]}</td>
                  <td style={{ padding: "7px 0", textAlign: "right", ..._invMono, fontSize: 12, color: A.ink }}>{row[1]}</td>
                  <td style={{ padding: "7px 0", textAlign: "right", ..._invMono, fontSize: 12, color: A.ink }}>{row[2]}</td>
                  <td style={{ padding: "7px 0 7px 18px", ..._invMono, fontSize: 12, color: A.inkMuted }}>{row[3]}</td>
                  <td style={{ padding: "7px 0 7px 18px", fontSize: 11.5, color: A.inkMuted }}>{row[4]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </InvSection>
      </div>

      {/* Right column — on hand */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <InvSection title="On hand" sub="One row per lot. FIFO by expiration when the spray builder picks a lot.">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ padding: "10px 12px", border: `1px solid ${A.divider}`, borderRadius: 7, display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
              <div>
                <div style={{ ..._invMono, fontSize: 13, color: A.ink, fontWeight: 600 }}>Lot BJ24-117</div>
                <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 2 }}>16 fl oz · received Mar 4 · expires <strong style={{ color: A.wheat }}>Aug 2026</strong></div>
                <div style={{ fontSize: 11, color: A.inkMuted, marginTop: 2 }}>Chemical shed · upper shelf</div>
              </div>
              <span style={{ fontSize: 10, color: A.wheat, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>Expiring</span>
            </div>
            <button style={{ ...A_ghostBtn, padding: "7px 10px", fontSize: 12, justifyContent: "center" }}>
              <Icon.Plus size={12} /> Add another lot
            </button>
          </div>
        </InvSection>

        <InvSection title="Storage & reorder">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <InvKVP k="Default location" v="Chemical shed · upper shelf" />
            <InvKVP k="Reorder at" v="12 fl oz" mono />
            <InvKVP k="Preferred supplier" v="Mid-Atlantic Crop Supply" />
            <InvKVP k="Last received" v="Mar 4, 2026" mono />
          </div>
        </InvSection>

        <InvSection title="Recent usage" sub="Pulled from spray events that drew from this item.">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              ["May 22", "Block C · grapes", "10 fl oz", "Sherry"],
              ["Apr 30", "Block B · apples", "12 fl oz", "Dale"],
              ["Apr 14", "Block B · apples", "10 fl oz", "Sherry"],
            ].map(([d, b, q, by]) => (
              <div key={d} style={{ display: "grid", gridTemplateColumns: "60px 1fr auto auto", gap: 10, alignItems: "center", padding: "6px 0", borderTop: `1px solid ${A.dividerSoft}` }}>
                <span style={{ ..._invMono, fontSize: 11.5, color: A.inkMuted }}>{d}</span>
                <span style={{ fontSize: 12, color: A.ink }}>{b}</span>
                <span style={{ ..._invMono, fontSize: 11.5, color: A.rust }}>−{q}</span>
                <span style={{ fontSize: 11, color: A.inkMuted }}>{by}</span>
              </div>
            ))}
          </div>
        </InvSection>
      </div>
    </div>
  );
}

/* Fertility detail — NPK focus, no safety kernel ──────────────── */
function FertilityDetail() {
  const A = window.A_tokens;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <InvSection title="Guaranteed analysis" sub="From the bag tag. NPK is required; secondary nutrients are optional but feed the nutrient-plan calculator.">
          {/* NPK chart */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 14 }}>
            {[
              { l: "N (total)",   v: "46.0%", c: "#2C5237" },
              { l: "P₂O₅",        v: "0%",    c: "#7A7F75" },
              { l: "K₂O",         v: "0%",    c: "#7A7F75" },
            ].map((n) => (
              <div key={n.l} style={{ padding: "12px 14px", background: A.cream, border: `1px solid ${A.dividerSoft}`, borderRadius: 8 }}>
                <div className="serif" style={{ fontSize: 28, color: n.c, lineHeight: 1, fontWeight: 700, letterSpacing: "-0.02em" }}>{n.v}</div>
                <div style={_invKicker({ marginTop: 6 })}>{n.l}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            {[["S", "—"], ["Ca", "—"], ["Mg", "—"], ["Micros", "—"]].map(([k, v]) => (
              <InvKVP key={k} k={k} v={v} mono />
            ))}
          </div>
        </InvSection>

        <InvSection title="Application">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
            <InvKVP k="Form" v="Granular · prilled" />
            <InvKVP k="Density (bulk)" v="49 lb / ft³" mono />
            <InvKVP k="Recommended rate" v="40-80 lb N/ac" mono />
            <InvKVP k="Stages" v="Pre-plant, side-dress V6" />
            <InvKVP k="Volatilization risk" v="High · incorporate within 48 h" tone={A.wheat} />
            <InvKVP k="OMRI" v="No" tone={A.inkMuted} />
          </div>
        </InvSection>

        <InvSection title="Nutrient-plan impact" sub="How this product would draw down the 2026 nutrient budget once allocated.">
          <div style={{ padding: "12px 14px", background: A.cream, border: `1px solid ${A.dividerSoft}`, borderRadius: 8, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
            <InvKVP k="2026 N needed (all blocks)" v="312 lb" mono />
            <InvKVP k="Covered by this item" v="83 lb" mono tone={A.forestDeep} />
            <InvKVP k="Shortfall after this lot" v="229 lb" mono tone={A.rust} />
          </div>
          <div style={{ marginTop: 10, fontSize: 11.5, color: A.inkMuted }}>
            Other N sources in catalog: <span style={{ color: A.forest, fontWeight: 600 }}>chicken litter</span> (catalog), <span style={{ color: A.forest, fontWeight: 600 }}>fish hydrolysate</span> (on-hand).
          </div>
        </InvSection>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <InvSection title="On hand · 2 lots">
          {[
            { lot: "U25-A11", qty: "120 lb", got: "Feb 18", from: "Southern States" },
            { lot: "U25-B04", qty: "60 lb",  got: "Mar 22", from: "Southern States" },
          ].map((l) => (
            <div key={l.lot} style={{ padding: "9px 12px", border: `1px solid ${A.divider}`, borderRadius: 7, marginBottom: 8 }}>
              <div style={{ ..._invMono, fontSize: 13, color: A.ink, fontWeight: 600 }}>Lot {l.lot}</div>
              <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 2 }}>{l.qty} · received {l.got} · {l.from}</div>
            </div>
          ))}
          <button style={{ ...A_ghostBtn, padding: "7px 10px", fontSize: 12, justifyContent: "center", width: "100%" }}>
            <Icon.Plus size={12} /> Add lot
          </button>
        </InvSection>

        <InvSection title="Storage & reorder">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <InvKVP k="Default location" v="Equipment barn 2 · bay 3" />
            <InvKVP k="Reorder at" v="300 lb" mono tone={A.rust} />
            <InvKVP k="Preferred supplier" v="Southern States · Leesburg" />
            <InvKVP k="Last price" v="$0.62 / lb" mono />
          </div>
        </InvSection>

        <InvSection title="Application history">
          {[
            ["May 12", "Block A · corn V6", "60 lb", "Sherry"],
            ["Mar 30", "Block D · wheat",   "70 lb", "Dale"],
          ].map(([d, b, q, by]) => (
            <div key={d} style={{ display: "grid", gridTemplateColumns: "60px 1fr auto auto", gap: 10, alignItems: "center", padding: "7px 0", borderTop: `1px solid ${A.dividerSoft}` }}>
              <span style={{ ..._invMono, fontSize: 11.5, color: A.inkMuted }}>{d}</span>
              <span style={{ fontSize: 12, color: A.ink }}>{b}</span>
              <span style={{ ..._invMono, fontSize: 11.5, color: A.rust }}>−{q}</span>
              <span style={{ fontSize: 11, color: A.inkMuted }}>{by}</span>
            </div>
          ))}
        </InvSection>
      </div>
    </div>
  );
}

/* Seed detail ─────────────────────────────────────────────────── */
function SeedDetail() {
  const A = window.A_tokens;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <InvSection title="Variety provenance" sub="Heirloom/OP seed has a story. We capture it so it survives Sherry passing the farm to whoever's next.">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
            <InvKVP k="Common name" v="Cherokee Trail-of-Tears Bean" />
            <InvKVP k="Latin name" v="Phaseolus vulgaris" />
            <InvKVP k="Type" v="Pole bean · dry/snap dual-use" />
            <InvKVP k="Origin" v="Heirloom · OP" />
            <InvKVP k="Steward" v="Saved by Sherry · 2023 cycle" />
            <InvKVP k="Days to maturity" v="85 d snap · 95 d dry" mono />
          </div>
        </InvSection>

        <InvSection title="Germination & treatment" sub="Germ test required annually for any seed older than 18 months.">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
            <InvKVP k="Germination %" v="92%" mono tone={A.forestDeep} />
            <InvKVP k="Tested" v="Jan 18, 2025" mono />
            <InvKVP k="Next test by" v="Jan 2026" mono />
            <InvKVP k="Treated" v="No · organic" tone={A.forest} />
          </div>
          <div style={{ marginTop: 12, padding: "10px 12px", background: A.cream, border: `1px solid ${A.dividerSoft}`, borderRadius: 6, fontSize: 12, color: A.inkSoft, display: "flex", gap: 8, alignItems: "flex-start" }}>
            <Icon.Info size={13} stroke={A.inkSoft} style={{ marginTop: 2 }} />
            <span>Treated seed (fungicide/insecticide coating) routes through the safety kernel like a pesticide application — REI applies to handlers, and the spray-events log gets an auto-entry at planting.</span>
          </div>
        </InvSection>

        <InvSection title="Planting parameters" sub="Pulled from the linked crop plugin. Override here only if this lot behaves differently.">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
            <InvKVP k="Seeding rate" v="15 lb / ac" mono />
            <InvKVP k="Row spacing" v="36 in" mono />
            <InvKVP k="In-row spacing" v="4 in" mono />
            <InvKVP k="Depth" v="1.5 in" mono />
            <InvKVP k="Soil temp min" v="60 °F" mono />
            <InvKVP k="Companion fit" v="Three Sisters · corn + squash" />
            <InvKVP k="Inoculant" v="Rhizobium leguminosarum (group E)" />
            <InvKVP k="Saves true" v="Yes · OP" tone={A.forest} />
          </div>
        </InvSection>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <InvSection title="On hand · 0 lots">
          <div style={{ padding: "20px 14px", textAlign: "center", color: A.inkMuted, fontSize: 12.5, background: "#FBF1E5", borderRadius: 7, border: "1px solid #E2B69E" }}>
            <Icon.Alert size={18} stroke={A.rust} />
            <div style={{ marginTop: 6, color: A.rust, fontWeight: 600 }}>No seed on hand for 2026 season.</div>
            <div style={{ marginTop: 4, fontSize: 11.5 }}>Allocated 0.5 lb for Block A · Three Sisters.</div>
          </div>
          <button style={{ ...A_primaryBtn, padding: "9px 12px", fontSize: 13, justifyContent: "center", width: "100%", marginTop: 10 }}>
            <Icon.Plus size={12} /> Receive seed
          </button>
        </InvSection>

        <InvSection title="Saving history" sub="A grow-out/save event creates a new lot.">
          {[
            { y: "2025", lot: "CB25-A", g: "0.5 lb", note: "Saved from Block B · 16 plants" },
            { y: "2024", lot: "CB24-A", g: "0.4 lb", note: "Saved from Block A · 12 plants" },
            { y: "2023", lot: "CB23-A", g: "0.35 lb", note: "Originated from SESE packet" },
          ].map((s) => (
            <div key={s.lot} style={{ padding: "8px 0", borderTop: `1px solid ${A.dividerSoft}` }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span style={{ ..._invMono, fontSize: 13, color: A.ink, fontWeight: 600 }}>{s.y} · {s.lot}</span>
                <span style={{ ..._invMono, fontSize: 11.5, color: A.forest, fontWeight: 600 }}>+{s.g}</span>
              </div>
              <div style={{ fontSize: 11, color: A.inkMuted, marginTop: 2 }}>{s.note}</div>
            </div>
          ))}
        </InvSection>

        <InvSection title="Linked planting">
          <div style={{ fontSize: 12, color: A.ink, lineHeight: 1.6 }}>
            <strong style={{ color: A.forestDeep }}>2026 · Block A · Three Sisters</strong><br />
            <span style={{ color: A.inkSoft }}>0.5 lb allocated · planting window <span style={_invMono}>Jun 1–14</span></span>
          </div>
        </InvSection>
      </div>
    </div>
  );
}

/* Crop plugin detail — catalog only, no stock lots ────────────── */
function CropPluginDetail() {
  const A = window.A_tokens;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <InvSection title="Plugin metadata" sub="Read-only mirror of the JSON file. Edits round-trip through the curator pipeline.">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
            <InvKVP k="Plugin id" v="corn.bloody-butcher" mono />
            <InvKVP k="Version" v="1.6.2" mono />
            <InvKVP k="Source" v="core" tone={A.forest} />
            <InvKVP k="Archetype" v="Row-grain · pollination" />
            <InvKVP k="Renderer" v="RowGrainV/R" mono />
            <InvKVP k="Rules version" v="2026.04" mono />
          </div>
        </InvSection>

        <InvSection title="Varieties · 1 of 1">
          <div style={{ padding: "12px 14px", border: `1px solid ${A.divider}`, borderRadius: 7 }}>
            <div className="serif" style={{ fontSize: 16, color: A.forestDeep, letterSpacing: "-0.01em" }}>Bloody Butcher Dent</div>
            <div style={{ fontSize: 11.5, color: A.inkMuted, marginTop: 3 }}>Heirloom · OP · red kernel · Appalachian origin · 110-120 d</div>
            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
              <InvKVP k="Maturity" v="110-120 d" mono />
              <InvKVP k="Plant height" v="10-12 ft" mono />
              <InvKVP k="Tassel · silk" v="V10-12 → R1" mono />
              <InvKVP k="Cross-isolate" v="≥ 660 ft" mono />
            </div>
          </div>
        </InvSection>

        <InvSection title="Growth stages (V/R)" sub="Used by Plan, Today and the Spray builder to gate window-bound advice.">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6 }}>
            {[
              { s: "VE",  d: "0–7 d",   note: "Emerge" },
              { s: "V6",  d: "30–40 d", note: "Side-dress N" },
              { s: "VT",  d: "60–70 d", note: "Tassel" },
              { s: "R1",  d: "70–80 d", note: "Silk" },
              { s: "R3",  d: "85–95 d", note: "Milk" },
              { s: "R6",  d: "115 d+",  note: "Black layer" },
            ].map((g) => (
              <div key={g.s} style={{ padding: "8px 10px", background: A.cream, border: `1px solid ${A.dividerSoft}`, borderRadius: 6 }}>
                <div style={{ ..._invMono, fontSize: 12, color: A.forestDeep, fontWeight: 700 }}>{g.s}</div>
                <div style={{ ..._invMono, fontSize: 10.5, color: A.inkMuted, marginTop: 1 }}>{g.d}</div>
                <div style={{ fontSize: 10.5, color: A.inkSoft, marginTop: 3 }}>{g.note}</div>
              </div>
            ))}
          </div>
        </InvSection>

        <InvSection title="Pest & disease watchlist" sub="Plugin declares what to watch for; spray planner cross-links to insecticide & fungicide plugins.">
          {[
            { name: "Corn earworm (Helicoverpa zea)",          stage: "R1+",  link: "lannate-lv · bt-aizawai" },
            { name: "European corn borer (Ostrinia nubilalis)", stage: "V6+", link: "bt-kurstaki" },
            { name: "Northern corn leaf blight",                stage: "VT+", link: "headline · azoxystrobin" },
            { name: "Tar spot",                                 stage: "R1+", link: "headline · veltyma" },
          ].map((p) => (
            <div key={p.name} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, padding: "7px 0", borderTop: `1px solid ${A.dividerSoft}`, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: A.ink }}>{p.name}</span>
              <span style={{ ..._invMono, fontSize: 11, color: A.inkMuted }}>{p.stage}</span>
              <span style={{ ..._invMono, fontSize: 11, color: A.forestDeep }}>{p.link}</span>
            </div>
          ))}
        </InvSection>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <InvSection title="Where it's used" sub="Active plantings using this plugin.">
          {[
            { season: "2026", block: "Block A · Three Sisters", planting: "Bloody Butcher Dent · 0.4 ac", status: "Allocated" },
            { season: "2025", block: "Block A · Three Sisters", planting: "Bloody Butcher Dent · 0.4 ac", status: "Complete · 412 lb harvested" },
          ].map((u) => (
            <div key={u.season} style={{ padding: "9px 0", borderTop: `1px solid ${A.dividerSoft}` }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, color: A.ink, fontWeight: 600 }}>{u.season} · {u.block}</span>
                <span style={{ fontSize: 11, color: A.forest, fontWeight: 600 }}>{u.status}</span>
              </div>
              <div style={{ fontSize: 11, color: A.inkMuted, marginTop: 2 }}>{u.planting}</div>
            </div>
          ))}
        </InvSection>

        <InvSection title="Dependencies">
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              ["Seed plugin", "cherokee-trail.bean (companion)"],
              ["Seed plugin", "seminole.pumpkin (companion)"],
              ["Insect plugin", "lannate-lv · bt-aizawai"],
              ["Fung plugin", "headline · azoxystrobin"],
              ["Fert plugin", "urea-46-0-0 · chicken-litter"],
            ].map(([k, v]) => (
              <div key={v} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderTop: `1px solid ${A.dividerSoft}` }}>
                <span style={{ fontSize: 11, color: A.inkMuted }}>{k}</span>
                <span style={{ ..._invMono, fontSize: 11.5, color: A.forestDeep, fontWeight: 600 }}>{v}</span>
              </div>
            ))}
          </div>
        </InvSection>

        <InvSection title="Plugin source">
          <div style={{
            ..._invMono, fontSize: 11, color: A.inkSoft, lineHeight: 1.6,
            padding: "10px 12px", background: A.cream, border: `1px solid ${A.dividerSoft}`,
            borderRadius: 6, whiteSpace: "pre", overflow: "auto"
          }}>{`{
  "id": "corn.bloody-butcher",
  "version": "1.6.2",
  "archetype": "row-grain.pollination",
  "renderer": "RowGrainV/R",
  "varieties": [
    { "id": "bb-dent", "name": "Bloody Butcher Dent",
      "maturityDays": [110, 120],
      "crossIsolateFt": 660, ... }
  ],
  "stages": ["VE","V6","VT","R1","R3","R6"],
  "pests": [...], "diseases": [...]
}`}</div>
          <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
            <button style={{ ...A_ghostBtn, padding: "5px 10px", fontSize: 11 }}><Icon.FileText size={11} /> View JSON</button>
            <button style={{ ...A_ghostBtn, padding: "5px 10px", fontSize: 11 }}><Icon.Plus size={11} /> Propose edit</button>
          </div>
        </InvSection>
      </div>
    </div>
  );
}


/* ════════════════════════════════════════════════════════════════
   ARTBOARD 10 · Type-aware Edit/Add form
   Same scaffolding; the field stack switches based on the type
   selector at top. This is the canonical add/edit surface every
   inventory screen routes to.
   ════════════════════════════════════════════════════════════════ */
function A_InventoryEditForm({ type = "pesticide", mode = "edit" }) {
  const A = window.A_tokens;

  return (
    <div className="dir-a" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <A_TopBar active="stock" />
      {/* Subheader */}
      <div style={{ background: A.paper, borderBottom: `1px solid ${A.divider}` }}>
        <div style={{ display: "flex", alignItems: "center", padding: "13px 28px", gap: 16 }}>
          <button style={A_iconBtn}><Icon.ChevronRight size={16} style={{ transform: "rotate(180deg)" }} /></button>
          <div style={{ flex: 1 }}>
            <div style={_invKicker()}>
              {mode === "edit" ? "Stock · Edit item" : "Stock · Add item"}
            </div>
            <div className="serif" style={{ fontSize: 22, color: A.forestDeep, letterSpacing: "-0.015em", lineHeight: 1.1, marginTop: 2 }}>
              {mode === "edit" ? "Inspire Super" : "New inventory item"}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: A.inkMuted }}>
            <Icon.Lock size={11} stroke={A.inkSoft} /> Plugin-derived fields are kernel-locked.
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "20px 28px 100px", background: A.cream }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 320px", gap: 14, alignItems: "start" }}>

          {/* Main form */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Type selector — same control everywhere */}
            <InvSection title="Inventory type" sub="Pick the type first — it controls which fields appear below.">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {Object.keys(INV_TYPES).map((id) => (
                  <InvTypeChip key={id} id={id} active={id === type} />
                ))}
              </div>
            </InvSection>

            {/* Common fields — every type */}
            <InvSection title="Identity" sub="Required for every inventory type.">
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
                <InvField label="Name / brand" required>
                  <input style={_invInput} defaultValue={mode === "edit" ? "Inspire Super" : ""} placeholder="e.g. Inspire Super" />
                </InvField>
                <InvField label={type === "crop" ? "Plugin id" : "SKU / model"} hint={type === "crop" ? "dot.case" : ""}>
                  <input style={{ ..._invInput, ..._invMono }} defaultValue={mode === "edit" ? "inspire-super" : ""} placeholder="auto" />
                </InvField>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 12 }}>
                <InvField label="Manufacturer / source">
                  <input style={_invInput} defaultValue={mode === "edit" ? "Syngenta" : ""} />
                </InvField>
                {(type === "pesticide" || type === "fertility" || type === "seed") && (
                  <InvField label="Unit of measure" required>
                    <select style={_invInput} defaultValue={type === "pesticide" ? "fl oz" : type === "fertility" ? "lb" : "lb"}>
                      <option>fl oz</option><option>gal</option><option>lb</option><option>oz</option><option>g</option><option>yd³</option><option>plants</option>
                    </select>
                  </InvField>
                )}
                {type === "crop" && (
                  <InvField label="Archetype renderer" required derived>
                    <select style={_invInput} defaultValue="Row-grain · pollination">
                      <option>Row-grain · pollination</option>
                      <option>Small-grain (Zadoks)</option>
                      <option>Dry-seed legume</option>
                      <option>Continuous-harvest fruit</option>
                      <option>Cut-and-come-again leafy</option>
                      <option>Winter squash + cure</option>
                      <option>Cover crop · termination</option>
                      <option>Forage cutting cycle</option>
                      <option>Tree fruit · multi-pick</option>
                      <option>Perennial vine + quality</option>
                    </select>
                  </InvField>
                )}
                {type === "sprayer" && (
                  <InvField label="Class">
                    <select style={_invInput}><option>Tow boom</option><option>Backpack</option><option>ATV spot</option><option>Hand spot</option></select>
                  </InvField>
                )}
                <InvField label={type === "crop" || type === "sprayer" ? "Tag(s)" : "Storage location"}>
                  <input style={_invInput} defaultValue={mode === "edit" ? "Chemical shed · upper shelf" : ""} />
                </InvField>
              </div>
            </InvSection>

            {/* Pesticide-specific stack */}
            {type === "pesticide" && (
              <InvSection title="Pesticide attributes · safety kernel" sub="EPA-registered? These fields are read-only and come from the plugin. No EPA? Item lands as a draft and the spray builder shows a custom-rate warning.">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
                  <InvField label="EPA reg #" derived locked><input style={{ ..._invInput, ..._invMono, background: A.cream }} defaultValue="100-1517" readOnly /></InvField>
                  <InvField label="Signal word" derived locked><input style={{ ..._invInput, background: A.cream }} defaultValue="Caution" readOnly /></InvField>
                  <InvField label="MoA group" derived locked><input style={{ ..._invInput, ..._invMono, background: A.cream }} defaultValue="FRAC 3 + 9" readOnly /></InvField>
                  <InvField label="Restricted use" derived locked><input style={{ ..._invInput, background: A.cream }} defaultValue="No" readOnly /></InvField>
                  <InvField label="REI" derived locked hint="hours"><input style={{ ..._invInput, ..._invMono, background: A.cream }} defaultValue="12" readOnly /></InvField>
                  <InvField label="PHI" derived locked hint="hours · per crop"><input style={{ ..._invInput, ..._invMono, background: A.cream }} defaultValue="72 (apple) · 336 (grape)" readOnly /></InvField>
                  <InvField label="Active ingredient(s)" derived locked>
                    <input style={{ ..._invInput, background: A.cream }} defaultValue="difenoconazole 7.0% + cyprodinil 27.6%" readOnly />
                  </InvField>
                  <InvField label="Concentration" derived locked><input style={{ ..._invInput, ..._invMono, background: A.cream }} defaultValue="250 g/L" readOnly /></InvField>
                </div>
              </InvSection>
            )}

            {/* Fertility-specific */}
            {type === "fertility" && (
              <InvSection title="Guaranteed analysis" sub="Required: NPK. Optional: secondaries and density.">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12 }}>
                  <InvField label="N %" required><input style={{ ..._invInput, ..._invMono }} defaultValue="46.0" /></InvField>
                  <InvField label="P₂O₅ %" required><input style={{ ..._invInput, ..._invMono }} defaultValue="0" /></InvField>
                  <InvField label="K₂O %" required><input style={{ ..._invInput, ..._invMono }} defaultValue="0" /></InvField>
                  <InvField label="S %"><input style={{ ..._invInput, ..._invMono }} defaultValue="" /></InvField>
                  <InvField label="Ca %"><input style={{ ..._invInput, ..._invMono }} defaultValue="" /></InvField>
                  <InvField label="Mg %"><input style={{ ..._invInput, ..._invMono }} defaultValue="" /></InvField>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginTop: 12 }}>
                  <InvField label="Form" required>
                    <select style={_invInput}><option>Granular</option><option>Liquid</option><option>Pellet</option><option>Bulk / compost</option></select>
                  </InvField>
                  <InvField label="Density" hint="lb/ft³ or lb/gal"><input style={{ ..._invInput, ..._invMono }} defaultValue="49 lb/ft³" /></InvField>
                  <InvField label="OMRI listed">
                    <select style={_invInput}><option>No</option><option>Yes</option></select>
                  </InvField>
                  <InvField label="Recommended rate"><input style={_invInput} defaultValue="40-80 lb N/ac" /></InvField>
                </div>
              </InvSection>
            )}

            {/* Seed-specific */}
            {type === "seed" && (
              <InvSection title="Variety & germination">
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
                  <InvField label="Variety" required><input style={_invInput} defaultValue="Cherokee Trail-of-Tears Bean" /></InvField>
                  <InvField label="Type">
                    <select style={_invInput}><option>Heirloom · OP</option><option>OP</option><option>Hybrid F1</option><option>Companion · F1</option></select>
                  </InvField>
                  <InvField label="Days to maturity" hint="d"><input style={{ ..._invInput, ..._invMono }} defaultValue="85" /></InvField>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginTop: 12 }}>
                  <InvField label="Germination %" required><input style={{ ..._invInput, ..._invMono }} defaultValue="92" /></InvField>
                  <InvField label="Germ test date" required hint="YYYY-MM-DD"><input style={{ ..._invInput, ..._invMono }} defaultValue="2025-01-18" /></InvField>
                  <InvField label="Treated?" required>
                    <select style={_invInput}><option>No</option><option>Yes · fungicide</option><option>Yes · insecticide</option><option>Yes · both</option></select>
                  </InvField>
                  <InvField label="OMRI / organic">
                    <select style={_invInput}><option>Yes</option><option>No</option></select>
                  </InvField>
                </div>
              </InvSection>
            )}

            {/* Crop plugin-specific */}
            {type === "crop" && (
              <InvSection title="Plugin shape" sub="The full plugin is a JSON file; this is the editable summary. Schema-validated on save.">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
                  <InvField label="Version" required><input style={{ ..._invInput, ..._invMono }} defaultValue="1.6.2" /></InvField>
                  <InvField label="Source">
                    <select style={_invInput}><option>core</option><option>marketplace</option><option>draft (custom)</option></select>
                  </InvField>
                  <InvField label="Rules version" derived locked><input style={{ ..._invInput, ..._invMono, background: A.cream }} defaultValue="2026.04" readOnly /></InvField>
                  <InvField label="Stages" hint="comma-separated"><input style={{ ..._invInput, ..._invMono }} defaultValue="VE,V6,VT,R1,R3,R6" /></InvField>
                </div>
                <div style={{ marginTop: 12 }}>
                  <InvField label="Varieties · 1">
                    <textarea style={{ ..._invInput, ..._invMono, minHeight: 70, fontSize: 11.5 }} defaultValue={`[\n  { "id":"bb-dent", "name":"Bloody Butcher Dent",\n    "maturityDays":[110,120], "crossIsolateFt":660 }\n]`} />
                  </InvField>
                </div>
              </InvSection>
            )}

            {/* Sprayer-specific */}
            {type === "sprayer" && (
              <InvSection title="Calibration">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
                  <InvField label="Tank capacity" hint="gal"><input style={{ ..._invInput, ..._invMono }} defaultValue="80" /></InvField>
                  <InvField label="Nozzle type"><input style={_invInput} defaultValue="TeeJet TT11003" /></InvField>
                  <InvField label="# nozzles"><input style={{ ..._invInput, ..._invMono }} defaultValue="8" /></InvField>
                  <InvField label="Boom width" hint="ft"><input style={{ ..._invInput, ..._invMono }} defaultValue="20" /></InvField>
                  <InvField label="Last calibrated" required><input style={{ ..._invInput, ..._invMono }} defaultValue="2026-05-04" /></InvField>
                  <InvField label="Measured GPA" required><input style={{ ..._invInput, ..._invMono }} defaultValue="18.4" /></InvField>
                  <InvField label="Last product cycled"><input style={_invInput} defaultValue="atrazine + 2,4-D" /></InvField>
                  <InvField label="RUP-cleared">
                    <select style={_invInput}><option>Yes</option><option>No · decon</option></select>
                  </InvField>
                </div>
              </InvSection>
            )}

            {/* Stock-on-hand fields — only for inventory with lots */}
            {(type === "pesticide" || type === "fertility" || type === "seed") && (
              <InvSection title="Lot details" sub="Required when adding a new lot. Safety kernel won't release a lot to a spray event without a lot # logged.">
                <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 12 }}>
                  <InvField label="Lot number" required>
                    <input style={{ ..._invInput, ..._invMono }} defaultValue={mode === "edit" ? "BJ24-117" : ""} placeholder="From bottom of jug / bag" />
                  </InvField>
                  <InvField label={type === "seed" ? "Tested by" : "Expires"} required={type !== "seed"} hint={type === "seed" ? "lab / self" : "YYYY-MM-DD"}>
                    <input style={{ ..._invInput, ..._invMono }} defaultValue={type === "seed" ? "self" : "2026-04-30"} />
                  </InvField>
                  <InvField label="Quantity" required>
                    <input style={{ ..._invInput, ..._invMono }} type="number" defaultValue={mode === "edit" ? "16" : ""} />
                  </InvField>
                  <InvField label="Reorder at">
                    <input style={{ ..._invInput, ..._invMono }} type="number" defaultValue={mode === "edit" ? "12" : ""} />
                  </InvField>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginTop: 12 }}>
                  <InvField label="Received from"><input style={_invInput} defaultValue="Mid-Atlantic Crop Supply" /></InvField>
                  <InvField label="Received date" hint="YYYY-MM-DD"><input style={{ ..._invInput, ..._invMono }} defaultValue="2026-03-04" /></InvField>
                  <InvField label="Price per unit" hint="USD"><input style={{ ..._invInput, ..._invMono }} defaultValue="3.40" /></InvField>
                  <InvField label="Receipt / PO #" hint="optional"><input style={{ ..._invInput, ..._invMono }} defaultValue="" /></InvField>
                </div>
              </InvSection>
            )}
          </div>

          {/* Right rail — summary + safety read-out */}
          <div style={{ position: "sticky", top: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            <InvSection title="Save summary" dense>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <SaveRow label="Type" v={INV_TYPES[type].label} />
                <SaveRow label="Plugin match" v={type === "pesticide" || type === "crop" ? "inspire-super (linked)" : "—"} ok={type === "pesticide" || type === "crop"} />
                <SaveRow label="Safety kernel" v={type === "pesticide" ? "Eligible" : type === "seed" ? "Conditional · treated check" : "Not applicable"} ok={type !== "pesticide" ? null : true} />
                <SaveRow label="Required fields" v={mode === "edit" ? "All filled" : "12 / 12"} ok={true} />
                <SaveRow label="Will it appear in…" v={
                  type === "pesticide" ? "Stock · Spray builder · Records"
                : type === "fertility" ? "Stock · Nutrient plan · Records"
                : type === "seed" ? "Stock · Plan · Sow log"
                : type === "crop" ? "Plan · Today · all 8 archetype renderers"
                : "Spray builder · Settings · Calibration log"
                } />
              </div>
            </InvSection>

            <InvSection title="Audit trail" dense>
              <div style={{ fontSize: 11.5, color: A.inkSoft, lineHeight: 1.55 }}>
                Every change creates a record in the hash chain. Editing kernel-locked fields requires curator sign-off and triggers a `plugin_proposal` event.
              </div>
              <div style={{ marginTop: 8, ..._invMono, fontSize: 10.5, color: A.inkMuted }}>
                last edit · {mode === "edit" ? "Sherry · May 22, 8:14 AM" : "—"}
              </div>
            </InvSection>

            <InvSection title="Help" dense>
              <ul style={{ margin: 0, paddingLeft: 18, color: A.inkSoft, fontSize: 11.5, lineHeight: 1.6 }}>
                <li>Required fields are flagged <strong style={{ color: A.rust }}>REQUIRED</strong>.</li>
                <li><strong style={{ color: A.forest }}>FROM PLUGIN</strong> fields auto-fill once the plugin link resolves.</li>
                <li><span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}><Icon.Lock size={10} /> KERNEL-LOCKED</span> fields are read-only here; propose edits via the plugin proposal flow.</li>
              </ul>
            </InvSection>
          </div>
        </div>
      </div>

      {/* Sticky save footer */}
      <div style={{ borderTop: `1px solid ${A.divider}`, background: A.paper, padding: "12px 28px", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: A.inkSoft }}>
          <Icon.Lock size={13} stroke={A.forest} />
          <span>Save creates lot record + signs the hash chain. Edits to kernel-locked fields require curator sign-off.</span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button style={A_ghostBtn}>Cancel</button>
          <button style={A_ghostBtn}>Save & add another</button>
          <button style={A_primaryBtn}><Icon.Check size={14} /> {mode === "edit" ? "Save changes" : "Save item"}</button>
        </div>
      </div>
    </div>
  );
}

function SaveRow({ label, v, ok }) {
  const A = window.A_tokens;
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, paddingBottom: 6, borderBottom: `1px solid ${A.dividerSoft}` }}>
      <span style={{ fontSize: 11, color: A.inkMuted, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</span>
      <span style={{
        fontSize: 12, fontWeight: 500,
        color: ok === true ? A.forest : ok === false ? A.rust : A.ink,
        textAlign: "right", maxWidth: "60%"
      }}>
        {ok === true && <Icon.Check size={11} stroke={A.forest} style={{ marginRight: 3, verticalAlign: "-1px" }} />}
        {v}
      </span>
    </div>
  );
}


/* ── Window exports ──────────────────────────────────────────── */
window.A_InventoryTaxonomy   = A_InventoryTaxonomy;
window.A_InventoryList       = A_InventoryList;
window.A_InventoryDetail     = A_InventoryDetail;
window.A_InventoryEditForm   = A_InventoryEditForm;
