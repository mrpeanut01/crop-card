/**
 * Areas repo (Phase 30). The UI calls a `fields` row an Area; the table and
 * `fields.ts` stay so exports, VDACS reports and the cross-tenant tests keep
 * their column names. New code imports from here.
 */

export {
  createField as createArea,
  ensureHomeField as ensureHomeArea,
  getField as getArea,
  listFields as listAreas,
  updateField as updateArea,
  type Field as Area,
  type FieldWithBlocks as AreaWithBlocks
} from './fields';
