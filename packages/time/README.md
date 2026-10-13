# @igs/time

Pure calendar arithmetic on the Europe/Brussels wall clock (D-003, D-038): no I/O, no dependencies,
a leaf package (it imports nothing in the repo). `addBrusselsDays` and `addBrusselsMonths` count
calendar dates, not 24-hour days, and keep the time of day; a wall time skipped in March moves
forward, one that happens twice in October takes the earlier instant. Used by the privacy module
(the one-month answer deadline of a data-subject request) and the pricing module (the 30-day look-back
of a price reduction).
