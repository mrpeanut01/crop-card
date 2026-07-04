/* Direction A — Almanac · Scout (FR-07 threshold-driven scouting).
   Documents the canonical layout for `/scout` so future revisions have
   a design source-of-truth. Mirrors the shipping implementation at
   apps/web/src/routes/scout/+page.svelte (Phase 25d + Sprint 4) but
   formalised as a JSX artboard:

     1. Page header (Kicker · serif H1 · forest SCOUT Pill)
     2. Lede explaining the threshold rule
     3. Block selector card with optional window-stage line
     4. Spots card with N number inputs + "+ Add another spot"
     5. Tallest-weed Input (number, step 0.5)
     6. Decision result band — SPRAY (rust) or SKIP (forest)
        - reason · spots-counted · average / 10 sq ft
        - Save observation (forest) + Plan-spray link (forest)
     7. Recent observations card (data Provenance) with empty state
        and historical list (date · pest · value + metric · over-threshold Pill)

   Filed for #137 (CT-SC-DESIGN) — no AScoutScreen.jsx existed and
   every Scout child issue (#138–#141) had already shipped.
*/

function AScoutScreen({ aiEnabled }) {
  const A = window.A_tokens;
  const Provenance = window.A_Provenance;
  const m = MOCK;
  const sc = m.scout;

  const block = m.blocks.find((b) => b.id === sc.selectedBlockId) ?? m.blocks[0];
  const averagePer10SqFt =
    sc.spots.reduce((a, s) => a + s.weedsPer10SqFt, 0) / Math.max(1, sc.spots.length);
  const tooTall = sc.maxHeight != null && sc.maxHeight > 2;
  const overThreshold = averagePer10SqFt >= 3;
  const decision = overThreshold || tooTall ? 'SPRAY' : 'SKIP';
  const reason = overThreshold
    ? `Average ${averagePer10SqFt.toFixed(2)} weeds / 10 sq ft ≥ 3 threshold.`
    : tooTall
      ? `Tallest weed ${sc.maxHeight}″ > 2″ height threshold.`
      : `Average ${averagePer10SqFt.toFixed(2)} weeds / 10 sq ft below threshold; no weeds over 2″.`;

  const _aiOn = aiEnabled !== undefined ? aiEnabled : m.aiEnabled !== false;

  return (
    <div className="dir-a" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <A_TopBar active="scout" />

      <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px 32px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          {/* Page header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 12,
              marginBottom: 6
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <A_Kicker>FR-07 · Threshold-driven scouting</A_Kicker>
              <h1
                className="serif"
                style={{
                  margin: 0,
                  fontSize: 28,
                  color: A.forestDeep,
                  letterSpacing: '-0.02em'
                }}
              >
                Scout &amp; spray decision
              </h1>
            </div>
            <A_Pill tone="forest">SCOUT</A_Pill>
          </div>
          <p
            style={{
              fontSize: 13.5,
              color: A.inkMuted,
              margin: '0 0 20px',
              lineHeight: 1.5,
              maxWidth: 560
            }}
          >
            Walk the block, count broadleaves in 4–5 random 10 sq ft spots, and note the tallest
            weed. The threshold: ≥ 3 weeds / 10 sq ft on average, or any weed taller than 2 inches →
            spray.
          </p>

          {/* Block selector */}
          <A_Card style={{ marginBottom: 14 }}>
            <h2
              style={{
                margin: '0 0 10px',
                fontSize: 14,
                color: A.forest,
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}
            >
              Block
            </h2>
            <label
              htmlFor="scout-block"
              style={{
                display: 'block',
                marginBottom: 6,
                color: A.inkSoft,
                fontSize: 12
              }}
            >
              Which block are you scouting?
            </label>
            <select
              id="scout-block"
              defaultValue={block.id}
              style={{
                padding: '10px 12px',
                border: `1px solid ${A.divider}`,
                borderRadius: 6,
                fontSize: 14,
                minHeight: 48,
                width: '100%'
              }}
            >
              {m.blocks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            {sc.windowStage && (
              <p style={{ margin: '8px 0 0', color: A.inkMuted, fontSize: 12.5 }}>
                Window: <strong>{sc.windowStage}</strong> (from today's calendar)
              </p>
            )}
          </A_Card>

          {/* Spots */}
          <A_Card style={{ marginBottom: 14 }}>
            <h2
              style={{
                margin: '0 0 10px',
                fontSize: 14,
                color: A.forest,
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}
            >
              Spots
            </h2>
            {sc.spots.map((s, i) => (
              <label
                key={i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 6rem auto',
                  gap: 8,
                  alignItems: 'center',
                  marginBottom: 8
                }}
              >
                <span>Spot {i + 1}: weeds in 10 sq ft</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  defaultValue={s.weedsPer10SqFt}
                  style={{
                    padding: 10,
                    border: `1px solid ${A.divider}`,
                    borderRadius: 4,
                    fontSize: 15,
                    minHeight: 48
                  }}
                />
                {sc.spots.length > 1 && (
                  <button
                    type="button"
                    style={{
                      background: '#f6e3df',
                      color: A.rust,
                      border: 'none',
                      width: 48,
                      height: 48,
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontSize: 16
                    }}
                  >
                    ✕
                  </button>
                )}
              </label>
            ))}
            <button
              type="button"
              style={{
                background: A.paper,
                color: A.forest,
                border: `1.5px solid ${A.forest}`,
                borderRadius: 6,
                padding: '10px 14px',
                fontWeight: 600,
                cursor: 'pointer',
                minHeight: 48
              }}
            >
              + Add another spot
            </button>
          </A_Card>

          {/* Tallest weed input */}
          <A_Card style={{ marginBottom: 14 }}>
            <label
              style={{
                display: 'block',
                marginBottom: 6,
                fontWeight: 600
              }}
            >
              Tallest weed observed (in)
            </label>
            <input
              type="number"
              step="0.5"
              min="0"
              defaultValue={sc.maxHeight ?? ''}
              style={{
                padding: 10,
                border: `1px solid ${A.divider}`,
                borderRadius: 4,
                fontSize: 15,
                minHeight: 48,
                width: '100%'
              }}
            />
            <p
              style={{
                margin: '6px 0 0',
                fontSize: 12,
                color: A.inkMuted
              }}
            >
              Leave blank if you didn't measure. Example: 1.5
            </p>
          </A_Card>

          {/* Decision result */}
          <section
            aria-live="polite"
            style={{
              padding: '20px 22px',
              borderRadius: 10,
              marginBottom: 14,
              background: decision === 'SPRAY' ? '#f6e3df' : '#e2eede',
              border: `2px solid ${decision === 'SPRAY' ? A.rust : A.forest}`
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: 22,
                color: decision === 'SPRAY' ? A.rust : A.forest
              }}
            >
              {decision}
            </h2>
            <p style={{ margin: '8px 0 0', fontSize: 13.5, color: A.ink, lineHeight: 1.5 }}>
              {reason}
            </p>
            <dl
              style={{
                display: 'grid',
                gridTemplateColumns: 'max-content 1fr',
                gap: '4px 18px',
                margin: '14px 0 0',
                fontSize: 13
              }}
            >
              <dt style={{ color: A.inkMuted }}>Spots counted</dt>
              <dd style={{ margin: 0, fontWeight: 600 }}>{sc.spots.length}</dd>
              <dt style={{ color: A.inkMuted }}>Average / 10 sq ft</dt>
              <dd style={{ margin: 0, fontWeight: 600 }}>{averagePer10SqFt.toFixed(2)}</dd>
            </dl>
            <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
              <button
                type="button"
                style={{
                  background: A.forest,
                  color: A.cream,
                  border: 'none',
                  borderRadius: 6,
                  padding: '12px 18px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  minHeight: 48
                }}
              >
                Save observation
              </button>
              {decision === 'SPRAY' && (
                <a
                  href="#"
                  style={{
                    background: A.forest,
                    color: A.cream,
                    padding: '12px 20px',
                    borderRadius: 6,
                    textDecoration: 'none',
                    fontWeight: 600,
                    minHeight: 48,
                    display: 'inline-flex',
                    alignItems: 'center'
                  }}
                >
                  Plan the spray for {block.name} →
                </a>
              )}
            </div>
          </section>

          {/* Recent observations */}
          <A_Card>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                marginBottom: 12
              }}
            >
              <h2 style={{ margin: 0, fontSize: 14, color: A.forestDeep }}>
                Recent observations — {block.name}
              </h2>
              {Provenance && <Provenance source="data" detail="your scout log" compact />}
            </div>
            {sc.observations.length === 0 ? (
              <p style={{ margin: 0, color: A.inkMuted, fontSize: 13 }}>
                No observations recorded for this block yet — count a few spots above and save to
                start building the trend.
              </p>
            ) : (
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8
                }}
              >
                {sc.observations.map((o) => (
                  <li
                    key={o.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '8px 10px',
                      border: `1px solid ${A.divider}`,
                      borderRadius: 6,
                      background: A.paper,
                      flexWrap: 'wrap'
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'IBM Plex Mono, monospace',
                        fontSize: 12.5,
                        color: A.inkMuted,
                        minWidth: 60
                      }}
                    >
                      {o.date}
                    </span>
                    <span style={{ fontSize: 13 }}>{o.pest}</span>
                    <span style={{ fontWeight: 600, marginLeft: 'auto' }}>
                      {o.value.toFixed(2)}{' '}
                      <span style={{ fontWeight: 400, color: A.inkMuted, fontSize: 12 }}>
                        {o.metric}
                      </span>
                    </span>
                    {o.value >= 3 && <A_Pill tone="rust">over threshold</A_Pill>}
                  </li>
                ))}
              </ul>
            )}
          </A_Card>
        </div>
      </div>
    </div>
  );
}

window.A_ScoutScreen = AScoutScreen;
