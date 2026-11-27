import { describe, expect, it } from 'vitest';
import { localFrame, toLonLat, type XY } from './geometry';
import { estimateSun, shadeCasters, sunDays } from './sun';
import { FALLBACK_SEASON, type LonLat, type Obstacle } from './types';

// The values below were recorded from the level-ground sun estimate before
// slope and facing direction were added (Phase 38E). Level or unknown ground
// must keep giving exactly these.
const CENTER: LonLat = [-77.7, 39.08];
const frame = localFrame(CENTER);
const days = sunDays(CENTER[1], CENTER[0], FALLBACK_SEASON);

function tree(id: string, at: XY, radiusM = 4, heightFt: number | null = 40): Obstacle {
  return {
    id,
    kind: 'tree',
    shape: { type: 'circle', center: toLonLat(frame, at), radiusM },
    heightFt,
    provenance: 'manual'
  };
}

const CASES: Array<[XY, Obstacle[]]> = [
  [[0, 0], []],
  [[0, 0], [tree('e', [12, 0], 4, 50)]],
  [[0, 0], [tree('w', [-12, 0], 4, 50)]],
  [
    [0, 0],
    [tree('a', [12, 0]), tree('b', [-12, 3], 5, 60), tree('c', [0, -15], 3, 30)]
  ],
  [
    [5, -7],
    [
      tree('t', [0, -6], 5, 50),
      { ...tree('d', [9, -12], 5, null), deciduous: { leafOnDay: 120, leafOffDay: 280 } }
    ]
  ],
  [[0, 0], [tree('t', [0, 0], 6, 40)]]
];

describe('level ground keeps the sun estimate it had before slopes were read', () => {
  it('matches the recorded values', () => {
    const got = CASES.map(([p, o]) => estimateSun(p, days, shadeCasters(frame, o)));
    expect(JSON.stringify(got)).toMatchInlineSnapshot(
      `"[{"hoursSummer":12.5,"hoursSpringFall":10.3,"morningVsAfternoon":"even","shadedHoursSummer":0,"mainShade":null,"heightGuessed":false,"provenance":"fallback"},{"hoursSummer":8.7,"hoursSpringFall":9,"morningVsAfternoon":"afternoon","shadedHoursSummer":3.8,"mainShade":{"obstacleId":"e","when":"morning"},"heightGuessed":false,"provenance":"fallback"},{"hoursSummer":8.7,"hoursSpringFall":9,"morningVsAfternoon":"morning","shadedHoursSummer":3.8,"mainShade":{"obstacleId":"w","when":"afternoon"},"heightGuessed":false,"provenance":"fallback"},{"hoursSummer":5.8,"hoursSpringFall":8.3,"morningVsAfternoon":"even","shadedHoursSummer":6.7,"mainShade":{"obstacleId":"a","when":"morning"},"heightGuessed":false,"provenance":"fallback"},{"hoursSummer":2.3,"hoursSpringFall":4.4,"morningVsAfternoon":"morning","shadedHoursSummer":10.2,"mainShade":{"obstacleId":"t","when":"afternoon"},"heightGuessed":true,"provenance":"fallback"},{"hoursSummer":0,"hoursSpringFall":0,"morningVsAfternoon":"even","shadedHoursSummer":12.5,"mainShade":{"obstacleId":"t","when":"all-day"},"heightGuessed":false,"provenance":"fallback"}]"`
    );
  });
});
