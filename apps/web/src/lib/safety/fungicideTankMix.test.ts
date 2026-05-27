import { describe, expect, it } from 'vitest';
import { checkFungicideTankMixCompat } from './fungicideTankMix';

const champ = {
  pluginId: 'champ-dp',
  displayName: 'Champ DP',
  fracCodes: ['M01']
};
const kumulus = {
  pluginId: 'kumulus-df',
  displayName: 'Kumulus DF',
  fracCodes: ['M02']
};
const luna = {
  pluginId: 'luna-experience',
  displayName: 'Luna Experience',
  fracCodes: ['3', '7']
};

describe('checkFungicideTankMixCompat (#194)', () => {
  it('flags copper + sulfur as incompatible', () => {
    const issues = checkFungicideTankMixCompat([champ, kumulus]);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('COPPER_SULFUR_PHYTOTOXIC');
    expect(issues[0].severity).toBe('incompatible');
    expect(issues[0].productPluginIds).toEqual(expect.arrayContaining(['champ-dp', 'kumulus-df']));
    expect(issues[0].message).toMatch(/85°F/);
    expect(issues[0].message).toMatch(/7 days apart/);
  });

  it('does not flag copper alone', () => {
    expect(checkFungicideTankMixCompat([champ])).toHaveLength(0);
  });

  it('does not flag sulfur alone', () => {
    expect(checkFungicideTankMixCompat([kumulus])).toHaveLength(0);
  });

  it('does not flag a non-M01/M02 tank-mix', () => {
    expect(checkFungicideTankMixCompat([luna])).toHaveLength(0);
  });

  it('still flags when copper is in a 3-way mix with non-conflicting products', () => {
    const issues = checkFungicideTankMixCompat([champ, kumulus, luna]);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('COPPER_SULFUR_PHYTOTOXIC');
  });

  it('empty tank-mix returns no issues', () => {
    expect(checkFungicideTankMixCompat([])).toHaveLength(0);
  });
});
