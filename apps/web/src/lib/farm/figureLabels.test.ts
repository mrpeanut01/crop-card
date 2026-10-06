import { describe, expect, it } from 'vitest';
import { placeFigureLabels, type FigureLabelInput } from './figureLabels';

function square(id: string, name: string, x: number, y: number, side: number): FigureLabelInput {
  const h = side / 2;
  return {
    id,
    name,
    labelX: x,
    labelY: y,
    rings: [
      [
        [x - h, y - h],
        [x + h, y - h],
        [x + h, y + h],
        [x - h, y + h]
      ]
    ]
  };
}

describe('placeFigureLabels', () => {
  it('names every Area that has room', () => {
    const { labels, legend } = placeFigureLabels(
      [square('a', 'North Field', 0, 0, 100), square('b', 'Pond', 0, 200, 50)],
      10
    );
    expect(labels.map((l) => l.text)).toEqual(['North Field', 'Pond']);
    expect(legend).toEqual([]);
  });

  it('numbers the smaller of two Areas whose names would overprint', () => {
    const { labels, legend } = placeFigureLabels(
      [square('coop', 'Chicken Coop', 0, 4, 5), square('barn', 'Bank Barn', 0, 0, 30)],
      10
    );
    expect(labels).toEqual([
      { id: 'coop', x: 0, y: 4, text: null, n: 1 },
      { id: 'barn', x: 0, y: 0, text: 'Bank Barn', n: null }
    ]);
    expect(legend).toEqual([{ n: 1, name: 'Chicken Coop' }]);
  });

  it('numbers in input order and keeps every Area in labels or legend', () => {
    const fields = [
      square('big', 'Lower Hay Meadow', 0, 0, 200),
      square('x', 'High Tunnel', 2, 1, 4),
      square('y', 'Farmhouse', -3, 2, 3),
      square('z', 'Kitchen Garden', 1, -2, 6)
    ];
    const { labels, legend } = placeFigureLabels(fields, 10);
    expect(labels[0].text).toBe('Lower Hay Meadow');
    expect(legend.map((r) => r.n)).toEqual([1, 2, 3]);
    expect(legend.map((r) => r.name)).toEqual(['High Tunnel', 'Farmhouse', 'Kitchen Garden']);
    for (const l of labels) expect((l.text === null) !== (l.n === null)).toBe(true);
  });
});
