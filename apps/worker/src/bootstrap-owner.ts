/**
 * Bootstrap CLI (36b, Q4): creates the first `owner` (or, with `--role pharmacist_titular`, the
 * first titular pharmacist) and prints a single-use enrolment link valid for 15 minutes. The person
 * opens it, lands signed in on "Set up 2-step login", and enrols a passkey (or an authenticator app).
 * No password is ever set. It refuses when the role already has a holder.
 *
 *   node dist/bootstrap-owner.js --email owner@example.be --name "An Owner" \
 *     --base-url https://platform.example.be [--role pharmacist_titular]
 *   (dev: pnpm --filter @igs/worker bootstrap-owner -- --email … --name … --base-url http://localhost:3001)
 *
 * Runs through the kernel as a system actor holding `system_bootstrap` (no user can hold it), so the
 * creation is audited (`identity.owner.bootstrapped`). The token is printed once, inside the URL
 * fragment (never sent to a server, so never in an access log); only its SHA-256 is stored.
 */
import { parseArgs } from "node:util";

import { parseEnvFor, workerEnv } from "@igs/config/env";
import { checkDatabase, closeDatabase, configureKernel, isDomainError } from "@igs/kernel";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import {
  bootstrapStaff,
  ensureRbacCatalogue,
  registerAuditActions as registerIdentityAuditActions,
} from "@igs/module-identity";

const USAGE =
  "usage: bootstrap-owner --email <e-mail> --name <full name> --base-url <platform URL> [--role owner|pharmacist_titular]";

const BOOTSTRAP_ACTOR = {
  type: "system",
  id: "bootstrap-cli",
  roles: ["system_bootstrap"],
} as const;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** The platform origin the link points at: https, or http only for localhost (development). */
function enrolmentLink(baseUrl: string, token: string): string {
  let url: URL;
  try {
    url = new URL("/enrol", baseUrl);
  } catch {
    throw new Error(`--base-url is not a URL: ${baseUrl}`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("--base-url must use https (http is accepted for localhost only)");
  }
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      name: { type: "string" },
      role: { type: "string", default: "owner" },
      "base-url": { type: "string" },
    },
    strict: true,
  });
  if (!values.email || !values.name || !values["base-url"]) fail(USAGE);
  // validate the URL before touching the database
  try {
    enrolmentLink(values["base-url"], "x");
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  try {
    parseEnvFor(workerEnv);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  registerIdentityAuditActions(registerAuditAction);
  configureKernel({ audit: createAuditPort() });
  try {
    await checkDatabase();
    await ensureRbacCatalogue();
    const { token, expiresAt } = await bootstrapStaff(
      { email: values.email, name: values.name, roleKey: values.role },
      BOOTSTRAP_ACTOR,
    );
    process.stdout.write(
      [
        `Created ${values.role} ${values.email}.`,
        "Send them this link through a channel you trust. It works once, until",
        `${expiresAt.toISOString()}:`,
        "",
        enrolmentLink(values["base-url"], token),
        "",
      ].join("\n"),
    );
  } catch (error) {
    if (!isDomainError(error)) throw error;
    // not fail(): process.exit() would skip the finally below
    process.stderr.write(`refused: ${error.code}\n`);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
