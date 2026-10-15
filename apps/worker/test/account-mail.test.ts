// igs-pharma#114, the whole account-mail chain on real Postgres and a real Better Auth instance, with a
// fake SMTP transport: sign-up → `identity.mail.request` → outbox event → the worker's handler → the
// rendered mail → the link in it → the e-mail is verified → sign-in works. No mail server, no network.
import { createCustomerAuth } from "@igs/auth";
import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { registerEvents } from "@igs/kernel";
import { actors, configureKernelForTests } from "@igs/kernel/testing";
import { type MailTransport, createMailer } from "@igs/mail";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import {
  MailRequested,
  handleMailJobs,
  loadRbacCatalogue,
  registerAuditActions,
  requestMail,
} from "@igs/module-identity";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMailSender } from "../src/mail-sender";

const STOREFRONT = "http://localhost:3000";
const PASSWORD = "correct horse battery staple";

let iso: IsolatedDatabase;
let customerAuth: ReturnType<typeof createCustomerAuth>;
const sentMessages: Parameters<MailTransport["sendMail"]>[0][] = [];

beforeAll(async () => {
  iso = await createIsolatedDatabase();
  await loadRbacCatalogue(iso.db);
  registerAuditActions(registerAuditAction);
  configureKernelForTests({ db: iso.db, audit: createAuditPort() }).clock.set(new Date());
  registerEvents(MailRequested);
  customerAuth = createCustomerAuth({
    db: iso.db,
    secret: "test-secret-test-secret-test-secret-0123",
    baseURL: STOREFRONT,
    // what the web composition root does: the callbacks only run the kernel command
    requestMail: async (input) => {
      await requestMail(input, actors.system({ id: "better-auth", roles: ["system_auth"] }));
    },
  });
}, 180_000);
afterAll(async () => {
  await iso?.drop();
});

const call = (path: string, body?: unknown) =>
  customerAuth.handler(
    new Request(path.startsWith("http") ? path : `${STOREFRONT}/api/auth${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        origin: STOREFRONT,
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.50",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );

/** What the relay does: deliver every unpublished identity.mail.requested row to the handler. */
async function runWorker() {
  const rows = await iso.sql<{ id: string; payload: unknown }[]>`
    SELECT id, payload FROM system.outbox
    WHERE topic = ${MailRequested.topic} AND published_at IS NULL ORDER BY created_at`;
  const transport: MailTransport = {
    sendMail: async (message) => void sentMessages.push(message),
  };
  const send = createMailSender(
    {},
    createMailer({ smtpUrl: "smtp://fake", from: "IGS-Pharma <no-reply@example.test>", transport }),
  );
  await handleMailJobs(
    rows.map((row) => ({
      data: { eventId: row.id, topic: MailRequested.topic, schemaVersion: 1, payload: row.payload },
    })),
    send,
  );
  await iso.sql`UPDATE system.outbox SET published_at = now() WHERE id = ANY(${rows.map((r) => r.id)})`;
}

describe("account mail, end to end", () => {
  it("sign-up → verification mail → link → verified → sign-in", async () => {
    const email = "chain@example.test";
    const signUp = await call("/sign-up/email", { email, password: PASSWORD, name: "An Peeters" });
    expect(signUp.status).toBe(200);
    expect(sentMessages).toEqual([]); // nothing is sent inside the request (D-019)

    await runWorker();
    expect(sentMessages).toHaveLength(1);
    const message = sentMessages[0];
    expect(message).toMatchObject({
      from: "IGS-Pharma <no-reply@example.test>",
      to: email,
      subject: "Bevestig uw e-mailadres", // the user row's locale defaults to nl
    });
    const link = /http\S+/.exec(message?.text ?? "")?.[0];
    expect(link).toContain("/api/auth/verify-email");

    // the unverified account cannot sign in yet
    expect((await call("/sign-in/email", { email, password: PASSWORD })).status).toBe(403);

    const verified = await call(link ?? "");
    expect([200, 302]).toContain(verified.status);
    const [user] = await iso.sql<{ email_verified: boolean }[]>`
      SELECT email_verified FROM identity.users WHERE email = ${email}`;
    expect(user?.email_verified).toBe(true);
    expect((await call("/sign-in/email", { email, password: PASSWORD })).status).toBe(200);

    // the refused sign-in above asked for a fresh verification mail (sendOnSignIn); send it too
    await runWorker();
    expect(sentMessages).toHaveLength(2);

    // every link was deleted after sending: nothing waits in the table
    const [left] = await iso.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM identity.mail_tokens WHERE user_id IN
        (SELECT id FROM identity.users WHERE email = ${email}) AND url IS NOT NULL`;
    expect(left?.n).toBe(0);
  });

  it("the worker running twice over the same events sends the mail once", async () => {
    const before = sentMessages.length;
    await call("/sign-up/email", { email: "twice@example.test", password: PASSWORD, name: "Bo" });
    const [event] = await iso.sql<{ id: string; payload: unknown }[]>`
      SELECT id, payload FROM system.outbox WHERE topic = ${MailRequested.topic}
      AND published_at IS NULL ORDER BY created_at DESC LIMIT 1`;
    const job = {
      data: {
        eventId: event?.id,
        topic: MailRequested.topic,
        schemaVersion: 1,
        payload: event?.payload,
      },
    };
    const transport: MailTransport = {
      sendMail: async (message) => void sentMessages.push(message),
    };
    const send = createMailSender(
      {},
      createMailer({ smtpUrl: "smtp://fake", from: "a@b.test", transport }),
    );
    await handleMailJobs([job], send);
    await handleMailJobs([job], send); // a redelivery
    expect(sentMessages.length - before).toBe(1);
    await iso.sql`UPDATE system.outbox SET published_at = now() WHERE published_at IS NULL`;
  });

  it("a second sign-up with the same address sends the 'you already have an account' notice", async () => {
    await call("/sign-up/email", { email: "chain@example.test", password: PASSWORD, name: "Else" });
    const before = sentMessages.length;
    await runWorker();
    expect(sentMessages.length - before).toBe(1);
    expect(sentMessages.at(-1)).toMatchObject({
      to: "chain@example.test",
      subject: "U heeft al een account",
    });
    expect(sentMessages.at(-1)?.text).not.toContain("http");
  });
});
