import type {
  ConsentPurpose,
  ConsentSource,
  DsrChannel,
  DsrExtensionReason,
  DsrStatus,
  DsrType,
  StaffConsentSource,
} from "@igs/module-privacy";

/**
 * The English text staff see for privacy values and error codes (D-006: the kernel carries no
 * text; the back-office is English-only, so the mapping lives here). The option lists are type-only
 * copies of the module's constants: client components must not import the module (server code).
 */
export const DSR_TYPE_LABELS: Record<DsrType, string> = {
  access: "Access (incl. a copy to take away)",
  erasure: "Erasure",
  rectification: "Rectification",
  restriction: "Restriction",
  objection: "Objection",
};

export const DSR_TYPE_OPTIONS = [
  "access",
  "erasure",
  "rectification",
  "restriction",
  "objection",
] as const satisfies readonly DsrType[];

export const DSR_CHANNEL_LABELS: Record<DsrChannel, string> = {
  email: "E-mail",
  in_store: "In the pharmacy",
  post: "Post",
  other: "Other",
  account: "Customer account",
};

/** The channels staff can pick when logging a request by hand: `account` requests arrive on their own. */
export const DSR_CHANNEL_OPTIONS = [
  "email",
  "in_store",
  "post",
  "other",
] as const satisfies readonly DsrChannel[];

export const DSR_STATUS_LABELS: Record<DsrStatus, string> = {
  received: "Received",
  in_progress: "In progress",
  completed: "Completed",
  rejected: "Rejected",
};

export const DSR_STATUS_OPTIONS = [
  "received",
  "in_progress",
  "completed",
  "rejected",
] as const satisfies readonly DsrStatus[];

export const DSR_STATUS_BADGE: Record<DsrStatus, "neutral" | "primary" | "success" | "amber"> = {
  received: "neutral",
  in_progress: "primary",
  completed: "success",
  rejected: "amber",
};

export const CONSENT_PURPOSE_LABELS: Record<ConsentPurpose, string> = {
  marketing_email: "Marketing e-mails",
  analytics_cookies: "Analytics cookies",
};

export const CONSENT_PURPOSE_OPTIONS = [
  "marketing_email",
  "analytics_cookies",
] as const satisfies readonly ConsentPurpose[];

export const CONSENT_SOURCE_LABELS: Record<ConsentSource, string> = {
  storefront: "Webshop",
  in_store: "In the pharmacy",
  phone: "Phone",
  back_office: "Back-office",
  import: "Import",
};

export const STAFF_CONSENT_SOURCE_OPTIONS = [
  "in_store",
  "phone",
  "back_office",
] as const satisfies readonly StaffConsentSource[];

/** Art. 12(3) GDPR reasons for extending a request's deadline (igs-pharma#88). */
export const DSR_EXTENSION_REASON_LABELS: Record<DsrExtensionReason, string> = {
  complex: "The request is complex",
  numerous: "The person sent many requests",
};

export const DSR_EXTENSION_REASON_OPTIONS = [
  { value: "complex", label: DSR_EXTENSION_REASON_LABELS.complex },
  { value: "numerous", label: DSR_EXTENSION_REASON_LABELS.numerous },
] as const satisfies readonly { value: DsrExtensionReason; label: string }[];

/** The privacy policy version staff record a consent under, until the policy is versioned (1b). */
export const CURRENT_POLICY_VERSION = "2026-10";

const ERRORS: Record<string, string> = {
  "privacy.subject_ref_invalid": "Enter the person's e-mail address.",
  "privacy.received_at_invalid": "The date received can't be in the future.",
  "privacy.dsr_not_found": "This request doesn't exist.",
  "privacy.dsr_invalid_transition": "The request can't move to that status from where it is now.",
  "privacy.dsr_reason_required": "Say why the request is rejected.",
  "privacy.dsr_closed": "The request is closed: its deadline can no longer be extended.",
  "privacy.dsr_already_extended":
    "The deadline was already extended. It can be extended only once.",
  "privacy.dsr_extension_too_late":
    "The one-month deadline has passed: it can only be extended before it falls due.",
  "privacy.dsr_not_extended": "Extend the deadline first, then record the notice.",
  "privacy.dsr_notice_already_recorded": "The notice was already recorded.",
  "privacy.dsr_notice_date_invalid":
    "The date must be between the day the request arrived and today.",
  "kernel.forbidden": "You don't have permission to work with privacy requests and consents.",
  "kernel.mfa_required": "Confirm your 2-step login first.",
  "kernel.validation_failed": "Some fields are not filled in correctly.",
};

export const privacyErrorMessage = (code: string | undefined): string =>
  (code && Object.hasOwn(ERRORS, code) && ERRORS[code]) || "That didn't work. Try again.";

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Brussels",
});
const dateOnly = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "Europe/Brussels",
});

export const formatMoment = (value: Date): string => dateTime.format(value);
export const formatDay = (value: Date): string => dateOnly.format(value);

/** "Due in 3 days", "Due today", or "3 days overdue". */
export function dueLabel(daysLeft: number): string {
  if (daysLeft > 1) return `Due in ${daysLeft} days`;
  if (daysLeft === 1) return "Due tomorrow";
  if (daysLeft === 0) return "Due today";
  return `${-daysLeft} day${daysLeft === -1 ? "" : "s"} overdue`;
}
