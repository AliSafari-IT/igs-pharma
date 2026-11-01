import {
  type KernelRuntime,
  type OutboxEnvelope,
  type QueueAdmin,
  assertQueuesExist,
  getKernelRuntime,
} from "@igs/kernel";
import { eq, lt } from "drizzle-orm";

import { purgeEndedEarlyAccess } from "./early-access";
import { MailRequested } from "./mail";
import { type MailTemplate, mailTokens, users } from "./schema";

/**
 * The background side of the identity mails (igs-pharma#114, D-019, D-044). The Better Auth callbacks
 * only ask (`identity.mail.request`: store the link, publish `identity.mail.requested`); here the
 * WORKER sends. The send function is injected, so this module never imports the mail package or talks
 * to a mail server (`@igs/mail` is for the worker app alone).
 *
 * Exactly-once, in effect: the `mail_tokens` row is the idempotency token. A redelivered event finds no
 * row (it was deleted after the send) and does nothing. A crash between the send and the delete sends
 * the mail again on the retry (at-least-once, the better failure for a verification mail). The link is
 * in no log and no event; the row is deleted after sending, and an hourly job removes rows whose link
 * has expired without being sent.
 *
 * The schedule avoids 02:00–02:59 Europe/Brussels (the hour that does not exist in March and happens
 * twice in October).
 */
export const IDENTITY_JOBS = {
  purgeMail: {
    queue: "identity.mail.purge",
    deadLetterQueue: "identity.mail.purge.failed",
    cron: "7 0-1,3-23 * * *",
  },
  /** igs-pharma#199: ended early-access requests past their 12 months, once a day. */
  purgeEarlyAccess: {
    queue: "identity.early_access.purge",
    deadLetterQueue: "identity.early_access.purge.failed",
    cron: "37 4 * * *",
  },
  timezone: "Europe/Brussels",
  /** Only thrown errors are retried (connection, lock timeout). */
  retryLimit: 2,
  retryDelaySeconds: 60,
} as const;

/** One mail, as the worker hands it to the sender: everything needed, nothing logged. */
export interface MailToSend {
  readonly to: string;
  readonly name: string;
  readonly locale: string;
  readonly template: MailTemplate;
  readonly url: string | undefined;
  /** The end date the mail states (an early-access approval); `undefined` = none. */
  readonly validUntil: Date | undefined;
}

/** Where the mails that go to staff, not to the person, are sent (igs-pharma#199). */
export interface MailRouting {
  /**
   * The addresses of the staff notice of a new early-access request (`EARLY_ACCESS_NOTIFY_TO`). Empty:
   * the notice is skipped (and an alarm logged), never sent to the requester.
   */
  readonly staffRecipients: readonly string[];
}

const NO_ROUTING: MailRouting = { staffRecipients: [] };

/** Staff mails are in English, like the back-office, and greet nobody by name. */
const STAFF_LOCALE = "en";

export type MailSender = (mail: MailToSend) => Promise<void>;

export type MailDelivery = "sent" | "skipped";

/**
 * Sends the mail `tokenRef` stands for, then deletes its row. `skipped` when there is nothing to send:
 * the row is gone (already sent), expired (the link is dead), or the person is no longer active (the
 * row is removed). Throws when the send fails, so the job is retried; the row stays.
 */
export async function deliverMail(
  tokenRef: string,
  send: MailSender,
  runtime: KernelRuntime = getKernelRuntime(),
  routing: MailRouting = NO_ROUTING,
): Promise<MailDelivery> {
  const row = await runtime.db.transaction(async (tx) => {
    const [found] = await tx
      .select({
        template: mailTokens.template,
        url: mailTokens.url,
        validUntil: mailTokens.validUntil,
        expiresAt: mailTokens.expiresAt,
        userId: mailTokens.userId,
        toEmail: mailTokens.toEmail,
        toLocale: mailTokens.locale,
        email: users.email,
        name: users.name,
        locale: users.locale,
        status: users.status,
      })
      .from(mailTokens)
      // an invitation (igs-pharma#211) has no user: it goes to `to_email`, in `locale`
      .leftJoin(users, eq(users.id, mailTokens.userId))
      .where(eq(mailTokens.id, tokenRef));
    if (!found) return undefined;
    if (found.userId === null) {
      if (!found.toEmail || !found.toLocale) return undefined;
      return {
        ...found,
        email: found.toEmail,
        name: "",
        locale: found.toLocale,
        status: "active" as const,
      };
    }
    // a user's mail whose user is gone was deleted with it (cascade): nothing joins
    if (found.email === null || found.name === null || found.locale === null || !found.status) {
      return undefined;
    }
    return {
      ...found,
      email: found.email,
      name: found.name,
      locale: found.locale,
      status: found.status,
    };
  });
  if (!row) return "skipped";
  if (row.template === "early_access_staff_notice" && routing.staffRecipients.length === 0) {
    await runtime.db.transaction(async (tx) => {
      await tx.delete(mailTokens).where(eq(mailTokens.id, tokenRef));
    });
    runtime.logger.warn?.(
      { alarm: "identity.mail.staff_recipients_missing" },
      "identity.mail.staff_recipients_missing: set EARLY_ACCESS_NOTIFY_TO; a staff notice was dropped",
    );
    return "skipped";
  }
  if (row.expiresAt <= runtime.now() || row.status !== "active") {
    await runtime.db.transaction(async (tx) => {
      await tx.delete(mailTokens).where(eq(mailTokens.id, tokenRef));
    });
    return "skipped";
  }
  if (row.template === "early_access_staff_notice") {
    // one mail per address, so no recipient sees the others; a failure retries them all
    for (const to of routing.staffRecipients) {
      await send({
        to,
        name: "",
        locale: STAFF_LOCALE,
        template: row.template,
        url: undefined,
        validUntil: undefined,
      });
    }
  } else {
    await send({
      to: row.email,
      name: row.name,
      locale: row.locale,
      template: row.template,
      url: row.url ?? undefined,
      validUntil: row.validUntil ?? undefined,
    });
  }
  await runtime.db.transaction(async (tx) => {
    await tx.delete(mailTokens).where(eq(mailTokens.id, tokenRef));
  });
  return "sent";
}

/** One pg-boss job of the mail topic: the outbox envelope the relay delivers. */
export interface MailJob {
  readonly data: unknown;
}

/**
 * Handles a batch of `identity.mail.requested` jobs. A payload that does not parse can never succeed,
 * so it is logged (without its content) and dropped; every other failure is thrown for a retry.
 */
export async function handleMailJobs(
  jobs: readonly MailJob[],
  send: MailSender,
  runtime: KernelRuntime = getKernelRuntime(),
  routing: MailRouting = NO_ROUTING,
): Promise<void> {
  for (const job of jobs) {
    const envelope = job.data as Partial<OutboxEnvelope> | null;
    const payload = MailRequested.schema.safeParse(envelope?.payload);
    if (!payload.success) {
      runtime.logger.warn?.(
        { eventId: envelope?.eventId, alarm: "identity.mail.payload_invalid" },
        "identity.mail.payload_invalid: a mail request could not be read and was dropped",
      );
      continue;
    }
    const outcome = await deliverMail(payload.data.tokenRef, send, runtime, routing);
    runtime.logger.info?.(
      { eventId: envelope?.eventId, template: payload.data.template, outcome },
      "identity.mail.handled",
    );
  }
}

/** Deletes the mail rows whose link has expired (never sent, or the send kept failing). Returns how many. */
export async function runMailPurge(runtime: KernelRuntime = getKernelRuntime()): Promise<number> {
  const deleted = await runtime.db.transaction(async (tx) =>
    tx
      .delete(mailTokens)
      .where(lt(mailTokens.expiresAt, runtime.now()))
      .returning({ id: mailTokens.id }),
  );
  runtime.logger.info?.({ purged: deleted.length }, "identity.mail.purged");
  return deleted.length;
}

/** A purge that failed all its retries: expired links stay in the table (they are dead, but plaintext). */
export function reportMailPurgeFailed(runtime: KernelRuntime = getKernelRuntime()): void {
  runtime.logger.warn?.(
    { alarm: "identity.mail.purge_failed" },
    "identity.mail.purge_failed: the expired mail link purge failed after all retries",
  );
}

/** Deletes the early-access requests past their retention (igs-pharma#199). Returns how many. */
export async function runEarlyAccessPurge(
  runtime: KernelRuntime = getKernelRuntime(),
): Promise<number> {
  const purged = await runtime.db.transaction((tx) => purgeEndedEarlyAccess(tx, runtime.now()));
  runtime.logger.info?.({ purged }, "identity.early_access.purged");
  return purged;
}

/** The early-access purge failed all its retries: ended requests stay past their retention. */
export function reportEarlyAccessPurgeFailed(runtime: KernelRuntime = getKernelRuntime()): void {
  runtime.logger.warn?.(
    { alarm: "identity.early_access.purge_failed" },
    "identity.early_access.purge_failed: the early-access retention purge failed after all retries",
  );
}

/** The slice of pg-boss that `registerIdentityJobs` uses (structural: the module need not import pg-boss). */
export interface IdentityJobScheduler {
  getQueue(name: string): Promise<unknown>;
  schedule(name: string, cron: string, data?: object, options?: { tz?: string }): Promise<void>;
  /** pg-boss hands a handler the batch of jobs; the purge handlers ignore it. */
  work(name: string, handler: (jobs: MailJob[]) => Promise<void>): Promise<unknown>;
}

/** The slice of pg-boss that `ensureIdentityQueues` uses. */
export interface IdentityQueueAdmin extends QueueAdmin {
  createQueue(
    name: string,
    options?: { retryLimit?: number; retryDelay?: number; deadLetter?: string },
  ): Promise<void>;
}

/** The queues of the identity jobs, dead-letter queue first. The mail topic's own queue is the kernel's. */
export const IDENTITY_QUEUES: readonly string[] = [
  IDENTITY_JOBS.purgeMail.deadLetterQueue,
  IDENTITY_JOBS.purgeMail.queue,
  IDENTITY_JOBS.purgeEarlyAccess.deadLetterQueue,
  IDENTITY_JOBS.purgeEarlyAccess.queue,
];

/** Creates the queues. DDL on pg-boss's schema: runs in the migrate entry, never in the worker. Idempotent. */
export async function ensureIdentityQueues(boss: IdentityQueueAdmin): Promise<void> {
  const { purgeMail, purgeEarlyAccess, retryLimit, retryDelaySeconds } = IDENTITY_JOBS;
  for (const job of [purgeMail, purgeEarlyAccess]) {
    await boss.createQueue(job.deadLetterQueue);
    await boss.createQueue(job.queue, {
      retryLimit,
      retryDelay: retryDelaySeconds,
      deadLetter: job.deadLetterQueue,
    });
  }
}

/**
 * Verifies the queues exist (a readable `kernel.queue_missing` when the migrate entry has not run),
 * schedules the purge and registers the handlers: the mail topic and the purge. Safe on every boot.
 */
export async function registerIdentityJobs(
  boss: IdentityJobScheduler,
  send: MailSender,
  runtime: KernelRuntime = getKernelRuntime(),
  routing: MailRouting = NO_ROUTING,
): Promise<void> {
  const { purgeMail, purgeEarlyAccess, timezone } = IDENTITY_JOBS;
  await assertQueuesExist(boss, [...IDENTITY_QUEUES, MailRequested.topic]);
  await boss.schedule(purgeMail.queue, purgeMail.cron, undefined, { tz: timezone });
  await boss.schedule(purgeEarlyAccess.queue, purgeEarlyAccess.cron, undefined, { tz: timezone });
  await boss.work(MailRequested.topic, (jobs: MailJob[]) =>
    handleMailJobs(jobs, send, runtime, routing),
  );
  await boss.work(purgeMail.queue, async () => {
    await runMailPurge(runtime);
  });
  await boss.work(purgeMail.deadLetterQueue, async () => reportMailPurgeFailed(runtime));
  await boss.work(purgeEarlyAccess.queue, async () => {
    await runEarlyAccessPurge(runtime);
  });
  await boss.work(purgeEarlyAccess.deadLetterQueue, async () =>
    reportEarlyAccessPurgeFailed(runtime),
  );
}
