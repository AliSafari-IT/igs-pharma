# @igs/module-privacy

Consents (an append-only ledger: the current consent is the latest event) and data-subject requests
(a register with an append-only timeline). `subject_ref` is an e-mail address: personal data that
never goes into the audit trail or a log.

## Retention (igs-pharma#88, REQ-PRV-04)

The runtime roles can delete nothing from the privacy tables. Expired data is removed by ONE path:

- **`privacy.purge_expired_data()`**: a zero-argument `SECURITY DEFINER` function owned by the
  migrator role, executable by the worker role only. It reads `privacy.retention_policy` (written by
  migrations only; the worker cannot shorten retention) and deletes whole rows:
  - **consent**: a `(subject_ref, purpose)` chain whose LATEST event is a withdrawal, older than
    `consent_after_withdrawal` calendar months (Europe/Brussels), is deleted entirely. A chain whose
    latest event is a grant is never purged;
  - **data-subject requests**: a closed request older than `dsr_after_close` months is deleted with its
    events (and the staff free text in them). **Switched off**: the value is `NULL` (= keep), because the
    requests are also the evidence that deadlines were met.
- **The append-only guard** (`privacy.reject_mutation()`) allows a row `DELETE` only when the
  transaction-local flag `privacy.purge` is `on` (set, and reset before returning, by the function) AND
  `current_user` is the owner of the table (what a definer function runs as). `UPDATE` and `TRUNCATE`
  stay refused for everyone; no trigger is ever disabled.
- **The job**: `privacy.retention.purge`, daily 03:52 Europe/Brussels (never 02:xx), runs the kernel
  command `privacy.retention.purge` as the `system_maintenance` actor (a system role no user holds; the
  permission is system-only, so `owner` does not get it). The audit entry carries counts only; the job
  logs counts only and warns, without data, when it fails after its retries.

**Placeholders awaiting the privacy adviser and the owner** (`RETENTION_DEFAULTS` in `src/domain.ts`,
seeded by migration `0032`, `awaits_adviser = true`): `consent_after_withdrawal = 60` months (consent
period + 5 years), `dsr_after_close = NULL` (keep). To change a value, add a migration that updates the
row and sets `awaits_adviser = false`; nothing else changes.
