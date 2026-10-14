-- igs-pharma#99: the runtime reads and writes reservations (no DELETE: the table keeps its history,
-- and a trigger refuses it anyway), and may call the stock-level lock.

GRANT SELECT, INSERT, UPDATE ON "inventory"."reservations" TO "igs_app";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "inventory"."lock_stock_level"(uuid,uuid) TO "igs_app";
