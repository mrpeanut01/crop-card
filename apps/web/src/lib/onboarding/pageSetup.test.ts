import { describe, expect, it } from 'vitest';
import { planSetupPrompts, todaySetupPrompts, type PlanSetupFacts } from './pageSetup';

const done: PlanSetupFacts = {
  hasLocation: true,
  hasFrostDates: true,
  hasSeasonSetup: true,
  hasBlocks: true,
  hasSeed: true,
  year: 2027
};

describe('/plan setup prompts for a partly set up farm (#475)', () => {
  it('asks nothing once setup is done', () => {
    expect(planSetupPrompts(done, 'owner')).toEqual({ gate: null, nudges: [] });
  });

  it('gates on having somewhere to plant', () => {
    expect(planSetupPrompts({ ...done, hasBlocks: false }, 'owner').gate).toBe('blocks');
  });

  it('nudges, without blocking, for location, season and seed', () => {
    const p = planSetupPrompts(
      { ...done, hasLocation: false, hasSeasonSetup: false, hasSeed: false },
      'owner'
    );
    expect(p.gate).toBeNull();
    expect(p.nudges.map((n) => n.id)).toEqual(['location', 'season', 'seed']);
    expect(p.nudges.every((n) => n.href)).toBe(true);
  });

  it('asks about frost dates only once the location is set', () => {
    expect(
      planSetupPrompts({ ...done, hasLocation: false, hasFrostDates: false }, 'owner').nudges.map(
        (n) => n.id
      )
    ).toEqual(['location']);
    expect(
      planSetupPrompts({ ...done, hasFrostDates: false }, 'owner').nudges.map((n) => n.id)
    ).toEqual(['frost']);
  });

  it('shows a helper no setup questions they cannot answer (#471/#475 review)', () => {
    const facts = { ...done, hasLocation: false, hasSeasonSetup: false, hasSeed: false };
    expect(planSetupPrompts(facts, 'helper').nudges).toEqual([]);
    expect(planSetupPrompts(facts, 'inspector').nudges).toEqual([]);
    expect(planSetupPrompts({ ...facts, hasBlocks: false }, 'helper').gate).toBe('blocks');
    expect(
      todaySetupPrompts({ hasLocation: false, hasFrostDates: false }, 'helper').nudges
    ).toEqual([]);
  });

  it('writes plain copy with no em dashes', () => {
    const p = planSetupPrompts(
      { ...done, hasLocation: false, hasSeasonSetup: false, hasSeed: false },
      'owner'
    );
    for (const n of p.nudges) expect(`${n.title} ${n.body}`).not.toMatch(/—/);
  });
});

describe('questions asked in place (#475 owner comment)', () => {
  it('location, frost and season are answered on the page; seed still links to the add form', () => {
    const p = planSetupPrompts(
      { ...done, hasLocation: false, hasSeasonSetup: false, hasSeed: false },
      'owner'
    );
    expect(Object.fromEntries(p.nudges.map((n) => [n.id, n.ask ?? null]))).toEqual({
      location: 'climate',
      season: 'season',
      seed: null
    });
    expect(
      planSetupPrompts({ ...done, hasFrostDates: false }, 'owner').nudges.map((n) => n.ask)
    ).toEqual(['climate']);
  });

  it('/today asks for the location or frost dates, and nothing about the season', () => {
    expect(todaySetupPrompts({ hasLocation: true, hasFrostDates: true }, 'owner').nudges).toEqual(
      []
    );
    const noLoc = todaySetupPrompts({ hasLocation: false, hasFrostDates: false }, 'owner');
    expect(noLoc.gate).toBeNull();
    expect(noLoc.nudges.map((n) => [n.id, n.ask])).toEqual([['location', 'climate']]);
    const noFrost = todaySetupPrompts({ hasLocation: true, hasFrostDates: false }, 'owner');
    expect(noFrost.nudges.map((n) => n.id)).toEqual(['frost']);
  });
});
