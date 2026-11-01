-- igs-pharma#210: grants for the kernel's denied-audit throttle.

GRANT SELECT, INSERT, DELETE ON "system"."denied_audit_throttle" TO "igs_app";
