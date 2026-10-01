import { db } from '$lib/db/client';
import * as documentsRepo from '$lib/db/documents';
import type { DocumentRow, NewDocument } from '$lib/db/documents';
import type { DocumentKind } from '$lib/db/schema';

export type VaultDocumentKind = DocumentKind;
export type VaultDocumentRow = DocumentRow;
export type VaultNewDocument = NewDocument;

export interface VaultDocumentRepo {
  documentStorageKey(ownerId: string, documentId: string): string;
  insertDocument(input: VaultNewDocument): VaultDocumentRow;
  getDocument(id: string, opts?: { includeDeleted?: boolean }): VaultDocumentRow | undefined;
  markDocumentDeleted(
    id: string,
    deletedBy: string | null,
    now?: number
  ): VaultDocumentRow | undefined;
  liveDocumentBytes(): number;
}

export interface VaultRepoBinding extends VaultDocumentRepo {
  /** Runs `fn` in one SQLite transaction; a throw rolls it back. */
  transaction<T>(fn: () => T): T;
}

function dbTransaction<T>(fn: () => T): T {
  return db.transaction(() => fn());
}

let bound: VaultRepoBinding | null = {
  documentStorageKey: documentsRepo.documentStorageKey,
  insertDocument: documentsRepo.insertDocument,
  getDocument: documentsRepo.getDocument,
  markDocumentDeleted: documentsRepo.markDocumentDeleted,
  liveDocumentBytes: documentsRepo.liveDocumentBytes,
  transaction: dbTransaction
};

export function vaultRepo(): VaultRepoBinding {
  if (!bound) throw new Error('vault: lib/db/documents.ts is not available in this build');
  return bound;
}

export function hasVaultRepo(): boolean {
  return bound !== null;
}

/** Test-only: bind a repo (null unbinds). Returns the previous binding. */
export function _bindVaultRepoForTests(repo: VaultRepoBinding | null): VaultRepoBinding | null {
  const prev = bound;
  bound = repo;
  return prev;
}
