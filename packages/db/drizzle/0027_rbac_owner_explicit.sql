-- igs-pharma#79 (C7): the owner's permissions are an explicit list in packages/rbac/src/catalogue.ts.
-- Removed from the owner: orders.create (a customer action). The seed generator never infers
-- removals, so it is written out here (fix-forward).
DELETE FROM identity.role_permissions
WHERE role_key = 'owner' AND permission_key = 'orders.create';
