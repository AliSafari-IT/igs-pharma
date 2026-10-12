# @igs/module-identity

Users, roles, sessions' MFA facts and the staff commands (grant/revoke role, suspend/reactivate/delete,
bootstrap). Every change goes through the kernel (`command()`), so authorization, the transaction and
the audit entry are one unit.

## Pharmacist seat and last owner (D-035)

- Two command families with one static permission each (the Q7 pattern). `suspendUser`,
  `reactivateUser`, `deleteUser` (`staff.manage`) refuse a target holding `pharmacist` or
  `pharmacist_titular`, for everyone (`identity.pharmacist_access_requires_titular`).
  `suspendPharmacist`, `reactivatePharmacist`, `deletePharmacist` (`pharmacy.pharmacists.manage`)
  handle only such targets (`identity.not_a_pharmacist` otherwise). So the titular alone manages
  pharmacists, and an owner without the titular role cannot. Same audit events and shapes.
- The last active holder (`users.status = 'active'`) of `owner` or `pharmacist_titular` cannot be
  removed by role revoke, suspend or delete (either family) (`identity.last_holder_protected`). The check runs in
  the same transaction, after a transaction advisory lock per role, so two concurrent removals
  cannot both pass.
- The bootstrap CLI (`bootstrapStaff`) counts only active holders: a deleted or suspended
  titular does not block the seat.

### Transferring the titular seat

There is no transfer command. Two steps, each already allowed:

1. The current titular grants `pharmacist_titular` to the new person (`grantPharmacistRole`).
2. The old holder can now be revoked (`revokePharmacistRole`), suspended or deleted, because another
   active holder exists.
