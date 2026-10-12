# @igs/module-identity

Users, roles, sessions' MFA facts and the staff commands (grant/revoke role, suspend/reactivate/delete,
bootstrap). Every change goes through the kernel (`command()`), so authorization, the transaction and
the audit entry are one unit.

## Pharmacist seat and last owner (D-035)

- Suspending, reactivating or deleting a user who holds `pharmacist` or `pharmacist_titular` needs
  `pharmacy.pharmacists.manage` **in addition to** `staff.manage`. The owner alone cannot
  (`identity.pharmacist_access_requires_titular`).
- The last active holder (`users.status = 'active'`) of `owner` or `pharmacist_titular` cannot be
  removed by role revoke, suspend or delete (`identity.last_holder_protected`). The check runs in
  the same transaction, after a transaction advisory lock per role, so two concurrent removals
  cannot both pass.
- The bootstrap CLI (`bootstrapStaff`) counts only active holders: a deleted or suspended
  titular does not block the seat.

### Transferring the titular seat

There is no transfer command. Two steps, each already allowed:

1. The current titular grants `pharmacist_titular` to the new person (`grantPharmacistRole`).
2. The old holder can now be revoked (`revokePharmacistRole`), suspended or deleted, because another
   active holder exists.
