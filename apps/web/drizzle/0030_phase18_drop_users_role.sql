-- Drop the legacy `users.role` column. Multi-tenant
-- `helper_assignments.role_within_owner` has been the sole source of truth
-- since Phase 18a; the column survived for rollback safety and is no
-- longer referenced by any reader. Tracked as T-02.
ALTER TABLE `users` DROP COLUMN `role`;
