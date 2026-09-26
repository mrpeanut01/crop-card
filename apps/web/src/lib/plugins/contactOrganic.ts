/** Contact burndown actives (soaps, oils, acids) that belong to no HRAC
 *  resistance group. Their plugins carry a placeholder chemistry class for
 *  the kernel, so the UI must not show that class's HRAC group for
 *  rotation planning. */
const CONTACT_ACTIVES = [
  'ammonium nonanoate',
  'pelargonic acid',
  'nonanoic acid',
  'caprylic acid',
  'capric acid',
  'eugenol',
  'clove oil',
  'cinnamon oil',
  'citric acid',
  'acetic acid',
  'd-limonene',
  'citronella oil',
  'lemongrass oil'
];

export function isContactOrganic(activeIngredients: ReadonlyArray<{ name: string }>): boolean {
  return (
    activeIngredients.length > 0 &&
    activeIngredients.every((ai) => CONTACT_ACTIVES.includes(ai.name.trim().toLowerCase()))
  );
}
