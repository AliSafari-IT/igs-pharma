import type { EarlyAccessDuration } from "@igs/module-identity";

/** What the early-access dialogs and the page say (igs-pharma#199). */
export type EarlyAccessIntent = "approve" | "reject" | "revoke";

export const EARLY_ACCESS_INTENT_LABELS: Record<
  EarlyAccessIntent,
  { readonly title: string; readonly description: string; readonly confirm: string }
> = {
  approve: {
    title: "Give early access to",
    description:
      "They see the real shop before the launch, and get a mail with the date it ends. Approving again extends it.",
    confirm: "Give access",
  },
  reject: {
    title: "Reject the request of",
    description: "They get a mail and can ask again after 30 days.",
    confirm: "Reject request",
  },
  revoke: {
    title: "End the early access of",
    description:
      "It ends within 15 minutes: their current pass keeps working until it runs out. They get a mail and can ask again after 30 days.",
    confirm: "End access",
  },
};

/** The choices in the order the picker shows them. */
export const EARLY_ACCESS_DURATION_ORDER: readonly EarlyAccessDuration[] = [
  "7d",
  "30d",
  "90d",
  "until_launch",
];

export const EARLY_ACCESS_DURATION_LABELS: Record<EarlyAccessDuration, string> = {
  "7d": "7 days",
  "30d": "30 days (usual)",
  "90d": "90 days",
  until_launch: "Until the shop opens to everyone",
};
