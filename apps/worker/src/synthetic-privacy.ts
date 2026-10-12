/**
 * The synthetic privacy data (igs-pharma#58): three FAKE data-subject requests and a few consent
 * changes, on made-up `@example.invalid` addresses, so the Privacy pages of the back-office can be
 * tried on staging and in development. One request is backdated past its 30-day deadline, so the
 * Overdue badge shows. `seed-catalog.ts` runs it after the catalogue.
 */
import type { Actor } from "@igs/kernel";
import {
  type ConsentPurpose,
  type ConsentSource,
  type DsrChannel,
  type DsrStatus,
  type DsrType,
  createDsr,
  getConsents,
  listDsr,
  recordConsent,
  transitionDsr,
} from "@igs/module-privacy";

import { SEED_ACTOR } from "./synthetic-catalog";

const DAY = 86_400_000;

interface SeedRequest {
  readonly subjectRef: string;
  readonly type: DsrType;
  readonly channel: DsrChannel;
  /** How many days ago it was received. */
  readonly daysAgo: number;
  readonly note: string;
  /** Where the seed leaves it. */
  readonly status: Extract<DsrStatus, "received" | "in_progress">;
}

export const DEMO_REQUESTS: readonly SeedRequest[] = [
  {
    subjectRef: "demo.erasure@example.invalid",
    type: "erasure",
    channel: "email",
    daysAgo: 35,
    note: "Demo request, backdated: past its deadline.",
    status: "in_progress",
  },
  {
    subjectRef: "demo.access@example.invalid",
    type: "access",
    channel: "post",
    daysAgo: 12,
    note: "Demo request: asks for a copy of their data.",
    status: "received",
  },
  {
    subjectRef: "demo.objection@example.invalid",
    type: "objection",
    channel: "in_store",
    daysAgo: 2,
    note: "Demo request: objects to marketing e-mails.",
    status: "received",
  },
];

interface SeedConsent {
  readonly subjectRef: string;
  readonly purpose: ConsentPurpose;
  readonly granted: boolean;
  readonly source: ConsentSource;
}

/** In order: the latest change per person and purpose is the current state. */
export const DEMO_CONSENTS: readonly SeedConsent[] = [
  {
    subjectRef: "demo.objection@example.invalid",
    purpose: "marketing_email",
    granted: true,
    source: "storefront",
  },
  {
    subjectRef: "demo.objection@example.invalid",
    purpose: "analytics_cookies",
    granted: true,
    source: "storefront",
  },
  {
    subjectRef: "demo.objection@example.invalid",
    purpose: "marketing_email",
    granted: false,
    source: "in_store",
  },
  {
    subjectRef: "demo.access@example.invalid",
    purpose: "marketing_email",
    granted: true,
    source: "phone",
  },
];

export interface PrivacySeedResult {
  readonly requests: number;
  readonly consents: number;
  readonly skipped: number;
}

/**
 * Loads the demo requests and consents through the same commands staff use, so every write is
 * audited. Safe to run again: a person who already has a request of the seed's type, or any consent
 * event, is left as they are.
 */
export async function seedSyntheticPrivacy(
  actor: Actor = SEED_ACTOR,
  now: Date = new Date(),
): Promise<PrivacySeedResult> {
  let requests = 0;
  let consents = 0;
  let skipped = 0;
  for (const seed of DEMO_REQUESTS) {
    const existing = await listDsr({ subjectRef: seed.subjectRef, type: seed.type }, actor);
    if (existing.total > 0) {
      skipped++;
      continue;
    }
    const { requestId } = await createDsr(
      {
        subjectRef: seed.subjectRef,
        type: seed.type,
        channel: seed.channel,
        receivedAt: new Date(now.getTime() - seed.daysAgo * DAY).toISOString(),
        note: seed.note,
      },
      actor,
    );
    if (seed.status === "in_progress") {
      await transitionDsr(
        { requestId, to: "in_progress", note: "Demo: checking identity." },
        actor,
      );
    }
    requests++;
  }
  const people = [...new Set(DEMO_CONSENTS.map((c) => c.subjectRef))];
  const fresh = new Set<string>();
  for (const subjectRef of people) {
    const { history } = await getConsents({ subjectRef }, actor);
    if (history.length === 0) fresh.add(subjectRef);
    else skipped++;
  }
  for (const seed of DEMO_CONSENTS) {
    if (!fresh.has(seed.subjectRef)) continue;
    await recordConsent({ ...seed, policyVersion: "2026-10" }, actor);
    consents++;
  }
  return { requests, consents, skipped };
}
