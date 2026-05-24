/* Direction A — Almanac · Archetype coverage matrix
   This is the architectural read-out for engineering: every crop screen
   in this canvas is a RENDERER for a plugin archetype, keyed off
   structural fields in the crop plugin JSON. The crop name + variety
   are content; the renderer is shared across every crop in the family.

   Run this view first — it tells you which of the 137 crop plugins in
   the repo get coverage from which renderer, and which archetypes are
   still on the to-build list.

   Discriminator fields (real plugin shape, see /plugins/crops/*.json):
     - growthStageTable.system        — vr-corn, zadoks, bbch-cucurbit, …
     - cropFamily                     — corn, bean, brassica, allium, …
     - agronomy.lifecycle             — annual, biennial, perennial
     - harvestTargets[].useCase       — milling, fresh-eating, sweet, dry-seed, …
     - postHarvestCuring (presence)   — cure required → archetype shifts
     - sprayWindows[]                 — declarative, archetype-agnostic
*/

function AArchetypeMatrix() {
  const A = window.A_tokens;

  // Each row: archetype renderer name + the plugin-JSON discriminator
  // that fires it + crops in play (in this farm's plugin set).
  const ARCHETYPES = [
    {
      id: "small-grain",
      label: "Small-grain",
      built: true, builtScreen: "Wheat",
      stageScale: "Zadoks (Z11–Z99)",
      discriminator: 'growthStageTable.system === "zadoks"',
      harvestSchema: "bushels + moisture + test weight",
      keyDecisions: "Vernalization · FHB at flowering · field-dry moisture",
      crops: ["Wheat — Shirley", "Barley — Thoroughbred", "Cereal rye (for grain, not cover)", "Oats (any food-grade)"],
    },
    {
      id: "row-grain",
      label: "Row-grain w/ pollination",
      built: true, builtScreen: "Corn",
      stageScale: "V/R (Iowa State)",
      discriminator: 'growthStageTable.system === "vr-corn"',
      harvestSchema: "ears + field-moisture + shelled lb · two-moisture rule",
      keyDecisions: "Side-dress N · pollination isolation · sweet vs milling",
      crops: ["Bloody Butcher · OP flour", "Painted Mountain · OP flour", "Bantam Sweet · sweet", "Bodacious · sweet", "Pioneer feed · dent"],
    },
    {
      id: "dry-seed-legume",
      label: "Dry-seed legume",
      built: true, builtScreen: "Bean",
      stageScale: "Bean BBCH · R1–R9",
      discriminator: 'cropFamily === "bean" && harvestTargets[].useCase === "dry-seed"',
      harvestSchema: "dry pod lb → cleaned seed lb · field-dry pod gate",
      keyDecisions: "Three-Sisters companion offset · MBB scout cadence",
      crops: ["Cherokee Trail-of-Tears", "Iron Clay cowpea (food use)", "Painted-pony dry bean", "Soldier bean"],
    },
    {
      id: "fresh-legume",
      label: "Fresh-pod legume",
      built: false,
      stageScale: "Bean BBCH · R1–R5",
      discriminator: 'cropFamily === "bean" && harvestTargets[].useCase === "snap"',
      harvestSchema: "weekly hand-pick lb · tender pod stage",
      keyDecisions: "Continuous pick like tomato + MBB scout",
      crops: ["Kentucky Blue pole · snap", "Provider bush bean", "Snow peas", "Snap peas"],
      renders: "Reuses continuous-harvest-fruit + dry-seed-legume scout cadence — engineering ships as composition.",
    },
    {
      id: "winter-squash",
      label: "Winter squash + cure",
      built: true, builtScreen: "Pumpkin",
      stageScale: "Cucurbit BBCH · separate ♂/♀ flowers",
      discriminator: 'cropFamily ∈ {"squash","pumpkin"} && postHarvestCuring',
      harvestSchema: "fruit count + lb + cure-start + storage-start",
      keyDecisions: "♀-flower pollinator-gate (hard-locked) · PM forecast · 14-d cure",
      crops: ["Seminole · C. moschata", "Butternut Waltham · C. moschata", "Acorn Table Queen · C. pepo", "Buttercup · C. maxima"],
    },
    {
      id: "summer-squash",
      label: "Summer squash (no cure)",
      built: false,
      stageScale: "Cucurbit BBCH",
      discriminator: 'cropFamily === "squash" && !postHarvestCuring',
      harvestSchema: "every-other-day pick · count + lb",
      keyDecisions: "Pollinator-gate (same as winter squash) · over-mature culling",
      crops: ["Zucchini (any)", "Yellow crookneck"],
      renders: "Continuous-harvest-fruit renderer + winter-squash pollinator-gate. Skip the cure step.",
    },
    {
      id: "cont-fruit",
      label: "Continuous-harvest fruit",
      built: true, builtScreen: "Tomato",
      stageScale: "Crop BBCH · TP → FT → BR → continuous",
      discriminator: 'agronomy.lifecycle === "annual" && harvestStyle === "continuous"',
      harvestSchema: "per-pick lb + grade + destination · weekly schedule",
      keyDecisions: "Blight pressure (multi-disease) · PHI auto-check per pick",
      crops: ["Brandywine · indeterminate", "Cherokee Purple", "Pepper — Joe E. Parker", "Eggplant — Black Beauty", "Cucumber (slicer)"],
    },
    {
      id: "cut-leafy",
      label: "Cut-and-come-again leafy",
      built: true, builtScreen: "Lettuce",
      stageScale: "Lettuce BBCH · Hd → C1 → C2 → C3 → bolt",
      discriminator: 'harvestStyle === "cut-regrow"',
      harvestSchema: "per-cut lb + regrow days + bolt-trigger heat model",
      keyDecisions: "Family-keyed 14-d succession (Phase 20) · bolt at heat threshold",
      crops: ["Lettuce 4-cv mix", "Arugula (Rocket)", "Spinach", "Chard (any)", "Kale (young leaf)", "Collards"],
    },
    {
      id: "head-brassica",
      label: "Head brassica (single-cut)",
      built: false,
      stageScale: "Brassica BBCH · head-firm gate",
      discriminator: 'cropFamily === "brassica" && harvestStyle === "single-cut-head"',
      harvestSchema: "head count + lb · firmness inspect → cut",
      keyDecisions: "Cabbage looper / DBM IPM scout · head-split if late",
      crops: ["Broccoli — De Cicco", "Cauliflower — Snowball Y", "Cabbage — Savoy King", "Brussels sprouts — Long Island"],
      renders: "Forks from cut-leafy at the discriminator. Stage scale + harvest gate are different — needs its own renderer.",
    },
    {
      id: "root-veg",
      label: "Root vegetable (dig)",
      built: false,
      stageScale: "Root BBCH · shoulder-up-at-soil gate",
      discriminator: 'harvestStyle === "dig"',
      harvestSchema: "lb · grade by size band",
      keyDecisions: "Stand thinning · forking / cracking from heat-stress",
      crops: ["Carrot Nantes (half-long + scarlet)", "Beet — Detroit Dark Red", "Radish (any)", "Turnip"],
      renders: "New renderer — single-event harvest, but stage scale is shoulder-emergence, not V/R.",
    },
    {
      id: "bulb-cure",
      label: "Bulb + cure",
      built: false,
      stageScale: "Allium BBCH · neck-fall gate",
      discriminator: 'cropFamily === "allium" && postHarvestCuring',
      harvestSchema: "bulb count + lb + cure-start + storage-start",
      keyDecisions: "Cure 2-3 wk in shade · neck-fall = lift signal · scape removal (hardneck)",
      crops: ["Garlic (hardneck)", "Garlic (softneck)", "Onion · long-day", "Shallot"],
      renders: "Re-uses winter-squash cure footer. Stage scale differs (neck-fall, not vine die-back).",
    },
    {
      id: "cover-crop",
      label: "Cover crop · termination",
      built: true, builtScreen: "Cover (rye+vetch)",
      stageScale: "Biomass · pre-anthesis termination window",
      discriminator: 'usage === "cover" OR cropFamily === "cover"',
      harvestSchema: "biomass lb DM/ac + N credit · termination decision (4 options)",
      keyDecisions: "Termination method gated by philosophy (no glyph if organic) + tillage budget",
      crops: ["Cereal rye (cover)", "Hairy vetch", "Crimson clover", "Buckwheat", "Austrian winter pea", "Cowpea Iron Clay (cover)"],
    },
    {
      id: "forage-cycle",
      label: "Forage cutting cycle",
      built: true, builtScreen: "Hay",
      stageScale: "Crop-specific (alfalfa: 10% bloom)",
      discriminator: 'harvestStyle === "mow-cycle"',
      harvestSchema: "bale count + tons + RFQ · per-cut",
      keyDecisions: "Mow → Ted → Rake → Bale + weather GO/NO-GO at each step",
      crops: ["Alfalfa", "Orchardgrass", "Alfalfa + orchardgrass mix", "Clover hay (red)"],
    },
    {
      id: "tree-fruit",
      label: "Tree fruit · multi-pick",
      built: true, builtScreen: "Tree fruit (Goldrush)",
      stageScale: "Pomology · petal-fall → maturity by cultivar",
      discriminator: 'agronomy.lifecycle === "perennial" && harvestStyle === "multi-pick"',
      harvestSchema: "per-pick count + lb + grade · 3-7 picks per season",
      keyDecisions: "Codling moth IPM · scab fungicide cadence · pick window per cultivar",
      crops: ["Apple — Goldrush", "Apple — any orchard cultivar", "Pear (Bartlett, etc.)"],
    },
    {
      id: "stone-fruit",
      label: "Stone fruit (multi-pick · soft)",
      built: false,
      stageScale: "Pomology + softness gate",
      discriminator: 'cropFamily === "stone-fruit"',
      harvestSchema: "per-pick count + lb · 2-4 picks · soft handling",
      keyDecisions: "Brown rot pressure · narrow pick window · OFM IPM",
      crops: ["Cherry — Bing", "Cherry — Montmorency tart", "Apricot — Moorpark", "Peach (any)"],
      renders: "Forks from tree-fruit at the disease panel; same shell + same multi-pick recorder.",
    },
    {
      id: "small-fruit",
      label: "Small-fruit perennial",
      built: false,
      stageScale: "Cane / bush BBCH",
      discriminator: 'cropFamily ∈ {"berry"}',
      harvestSchema: "per-pick lb · ~weekly / daily at peak",
      keyDecisions: "Bird pressure (net) · SWD pressure · cane sanitation",
      crops: ["Blueberry — Bluecrop", "Blackberry — Prime-Ark Freedom", "Blackberry — Triple Crown"],
      renders: "Continuous-harvest-fruit shell + perennial maintenance panel (different from annual).",
    },
    {
      id: "perennial-vine",
      label: "Perennial vine + quality decision",
      built: true, builtScreen: "Grape (Cab Franc)",
      stageScale: "Eichhorn-Lorenz",
      discriminator: 'agronomy.lifecycle === "perennial" && trellis === true',
      harvestSchema: "brix + pH + TA + tons · quality-driven pick decision",
      keyDecisions: "Trellis training · sample-driven pick · bloom-to-harvest GDD",
      crops: ["Grape — Cab Franc", "Grape (any wine cv.)", "Hops — Cascade", "Hops (any cv.)"],
    },
    {
      id: "annual-herb",
      label: "Annual culinary herb",
      built: false,
      stageScale: "Herb BBCH · pre-flowering pinch",
      discriminator: 'cropFamily === "herb" && agronomy.lifecycle === "annual"',
      harvestSchema: "bunch count + lb · continuous · pinch to delay bolt",
      keyDecisions: "Pinch terminal bud → branch · bolt = bitter",
      crops: ["Basil — Genovese", "Cilantro — Santo", "Dill", "Parsley (treat as annual)"],
      renders: "Cut-and-come-again renderer + pinch-to-branch annotation. Bolt trigger is identical.",
    },
    {
      id: "perennial-herb",
      label: "Perennial herb / pollinator",
      built: false,
      stageScale: "Perennial maintenance",
      discriminator: 'cropFamily === "herb" && agronomy.lifecycle === "perennial"',
      harvestSchema: "bunch count + lb · light continuous",
      keyDecisions: "Divide every 3 yr · cut back in late fall · pollinator service",
      crops: ["Chives", "Oregano", "Rosemary (zone 7)", "Sage", "Marigold (companion, treated as decorative)"],
      renders: "Renders w/ a stripped-down annual-herb shell. No bolt trigger.",
    },
  ];

  const built = ARCHETYPES.filter((a) => a.built);
  const todo  = ARCHETYPES.filter((a) => !a.built);

  return (
    <div className="dir-a" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <A_TopBar active="plan" />
      <div style={{ flex: 1, overflow: "auto", padding: "26px 32px 32px", background: A.cream }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>

          {/* Header */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: A.inkMuted, letterSpacing: "0.12em", textTransform: "uppercase" }}>
              Crop archetype coverage · for engineering
            </div>
            <h1 className="serif" style={{ margin: "6px 0 0", fontSize: 32, color: A.forestDeep, letterSpacing: "-0.02em", lineHeight: 1.05 }}>
              Renderers, not crop screens.
            </h1>
            <div style={{ marginTop: 8, color: A.inkSoft, fontSize: 14, maxWidth: 880, lineHeight: 1.5 }}>
              Every crop screen in this canvas is an archetype renderer keyed off structural fields in the crop plugin JSON
              (<span style={{ fontFamily: "IBM Plex Mono, ui-monospace, monospace", fontSize: 13, color: A.forestDeep }}>growthStageTable.system</span>,
              <span style={{ fontFamily: "IBM Plex Mono, ui-monospace, monospace", fontSize: 13, color: A.forestDeep }}> cropFamily</span>,
              <span style={{ fontFamily: "IBM Plex Mono, ui-monospace, monospace", fontSize: 13, color: A.forestDeep }}> agronomy.lifecycle</span>,
              <span style={{ fontFamily: "IBM Plex Mono, ui-monospace, monospace", fontSize: 13, color: A.forestDeep }}> postHarvestCuring</span>,
              <span style={{ fontFamily: "IBM Plex Mono, ui-monospace, monospace", fontSize: 13, color: A.forestDeep }}> harvestStyle</span>).
              The wheat screen is a <em>small-grain renderer</em> fed wheat data; the corn screen is a <em>row-grain renderer</em>.
              Build the renderer once; every crop plugin that matches the discriminator inherits it for free.
            </div>
          </div>

          {/* Coverage strip */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 18
          }}>
            {[
              { k: "Renderers built",   v: built.length, sub: "screens in this canvas", c: A.forestDeep },
              { k: "Renderers to build", v: todo.length, sub: "compose from primitives", c: A.wheat },
              { k: "Crop plugins in repo", v: 137, sub: "across plugins/crops/*.json", c: A.inkSoft },
              { k: "Total archetypes",   v: ARCHETYPES.length, sub: "covers all 137 plugins", c: A.sky },
            ].map((s) => (
              <A_Card key={s.k} padded={false} style={{ padding: "14px 16px" }}>
                <div className="serif" style={{ fontSize: 30, color: s.c, lineHeight: 1, fontWeight: 600, letterSpacing: "-0.02em" }}>{s.v}</div>
                <div style={{ fontSize: 12, color: A.ink, marginTop: 6, fontWeight: 600 }}>{s.k}</div>
                <div style={{ fontSize: 11, color: A.inkMuted, marginTop: 2 }}>{s.sub}</div>
              </A_Card>
            ))}
          </div>

          {/* Built renderers */}
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: A.forest, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              ✓ Built in this canvas · {built.length}
            </span>
          </div>
          <A_Card padded={false} style={{ marginBottom: 16 }}>
            <ArchetypeTable rows={built} built={true} />
          </A_Card>

          {/* Todo renderers */}
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: A.wheat, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              · To build / compose · {todo.length}
            </span>
          </div>
          <A_Card padded={false}>
            <ArchetypeTable rows={todo} built={false} />
          </A_Card>

          {/* Footer note */}
          <div style={{
            marginTop: 18, padding: "12px 16px",
            background: "#EFF6E9", border: `1px solid #C9DBC0`,
            borderRadius: 8, fontSize: 12.5, color: A.forestDeep, lineHeight: 1.55
          }}>
            <strong>Why archetypes instead of crops:</strong> the plugin engine already declares the structural
            fields a renderer needs. Building 137 crop screens means 137 places to break the safety kernel; building
            ~20 archetype renderers means each crop plugin you add is purely data and ships without a code change —
            which is the entire point of <em>plugins are data-only</em> (CLAUDE.md, invariant #2).
          </div>
        </div>
      </div>
    </div>
  );
}

function ArchetypeTable({ rows, built }) {
  const A = window.A_tokens;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
      <thead>
        <tr style={{ background: A.cream, color: A.inkMuted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
          <th style={{ textAlign: "left", padding: "10px 14px", width: 200 }}>Archetype renderer</th>
          <th style={{ textAlign: "left", padding: "10px 8px", width: 280 }}>Discriminator (plugin JSON)</th>
          <th style={{ textAlign: "left", padding: "10px 8px", width: 240 }}>Stage scale + harvest schema</th>
          <th style={{ textAlign: "left", padding: "10px 14px" }}>Crops in play / will render</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.id} style={{ borderTop: `1px solid ${A.dividerSoft}`, verticalAlign: "top" }}>
            <td style={{ padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                {built ? (
                  <Icon.CheckCircle size={13} stroke={A.forest} />
                ) : (
                  <div style={{ width: 13, height: 13, borderRadius: 99, border: `1.5px dashed ${A.wheat}` }} />
                )}
                <span style={{ fontSize: 13, color: A.ink, fontWeight: 700, letterSpacing: "-0.005em" }}>{r.label}</span>
              </div>
              {built && (
                <div style={{ fontSize: 10.5, color: A.inkMuted, fontFamily: "IBM Plex Mono, ui-monospace, monospace", marginLeft: 19 }}>
                  built as: {r.builtScreen}
                </div>
              )}
              {!built && r.renders && (
                <div style={{ fontSize: 10.5, color: A.inkSoft, marginLeft: 19, lineHeight: 1.45, fontStyle: "italic" }}>
                  {r.renders}
                </div>
              )}
            </td>
            <td style={{ padding: "12px 8px", fontFamily: "IBM Plex Mono, ui-monospace, monospace", fontSize: 11.5, color: A.forestDeep, lineHeight: 1.5 }}>
              {r.discriminator}
            </td>
            <td style={{ padding: "12px 8px", color: A.inkSoft, lineHeight: 1.5 }}>
              <div style={{ color: A.ink, fontWeight: 500 }}>{r.stageScale}</div>
              <div style={{ marginTop: 3, fontFamily: "IBM Plex Mono, ui-monospace, monospace", fontSize: 11, color: A.inkMuted }}>{r.harvestSchema}</div>
              <div style={{ marginTop: 4, fontSize: 11.5, color: A.inkSoft }}>{r.keyDecisions}</div>
            </td>
            <td style={{ padding: "12px 14px", color: A.ink, lineHeight: 1.6 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {r.crops.map((c) => (
                  <span key={c} style={{
                    padding: "2px 7px", borderRadius: 4,
                    background: built ? "#E5EEDF" : A.dividerSoft,
                    color: built ? A.forestDeep : A.inkSoft,
                    fontSize: 11, lineHeight: 1.4
                  }}>{c}</span>
                ))}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

window.A_ArchetypeMatrix = AArchetypeMatrix;
