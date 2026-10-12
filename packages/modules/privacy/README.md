# @igs/module-privacy

Consent events and data-subject requests (DSR), Postgres schema `privacy`.

## DSR deadline (`dsrDueAt`)

GDPR art. 12(3) gives **one month**, counted per Reg. (EEC, Euratom) 1182/71: the period ends on
the same date of the next month, or on the last day of that month when it has no such date.
`dsrDueAt(receivedAt)` adds one calendar month on the **Europe/Brussels** calendar (D-003), keeps
the local time of day and clamps to the last day of the target month (31 Jan → 28/29 Feb). It never
adds `N × 24 h` across a month. Weekends and holidays do **not** extend the deadline: an earlier
internal deadline is safe, and `isDsrOverdue` may flag a request a day early. The art. 12(3)
extension (two further months, with a reason) is not modelled.

`due_at` is stored when the request is created (`privacy.dsr.create`); changing the rule does not
rewrite stored rows.
