import platesData from './plates-data.json';
import type { Plate } from './types';

export function getPlatesCatalog(): Plate[] {
  return platesData as Plate[];
}
