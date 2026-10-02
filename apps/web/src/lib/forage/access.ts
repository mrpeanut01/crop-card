/** Who may do what with forage tests (Phase 33C, M-60). Client-safe. */

export interface ForageAccess {
  /** Owner, helper and custom operator. */
  canRecord: boolean;
  /** Attach a lab report: the owner only. */
  canAttach: boolean;
  /** Delete a test: the owner only. */
  canDelete: boolean;
}

export function forageAccess(role: string | null | undefined): ForageAccess {
  const owner = role === 'owner';
  return {
    canRecord: !!role && role !== 'inspector',
    canAttach: owner,
    canDelete: owner
  };
}
