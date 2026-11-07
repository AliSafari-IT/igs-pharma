import type { LaunchStatus } from "@igs/config/launch";
import type { BadgeVariant } from "@igs/ui";

/** How each launch-check status reads on the launch checklist (igs-pharma#238). */
export const LAUNCH_STATUS_LABELS: Record<LaunchStatus, string> = {
  ok: "Done",
  missing: "Blocks opening",
  not_needed: "Not needed",
  elsewhere: "Checked by the storefront",
  unknown: "Could not check",
  manual: "Check by hand",
};

export const LAUNCH_STATUS_BADGE: Record<LaunchStatus, BadgeVariant> = {
  ok: "success",
  missing: "error",
  not_needed: "neutral",
  elsewhere: "primary",
  unknown: "amber",
  manual: "amber",
};
