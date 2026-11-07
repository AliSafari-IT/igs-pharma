import { Alert, Badge, Container, Link, Stack } from "@igs/ui";

import { LAUNCH_STATUS_BADGE, LAUNCH_STATUS_LABELS } from "../../../components/launch-labels";
import { PageHeader } from "../../../components/page-header";
import {
  ResponsiveTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/responsive-table";
import { requireStaffActor } from "../../../server/actor";
import { ensureKernelConfigured } from "../../../server/kernel";
import { loadLaunchChecklist } from "../../../server/launch";

export const metadata = { title: "Launch checklist · IGS-Pharma Platform" };

const QUESTIONS_URL = "https://github.com/AliSafari-IT/igs-pharma/issues/238";

/**
 * The launch checklist (igs-pharma#238): everything only the owner, the titular pharmacist, the
 * accountant or counsel can answer before the webshop opens, and whether it is in place. Read-only:
 * answers arrive in #238 and become a small change in code or in the server settings. While anything
 * here blocks the opening, the storefront refuses to leave its "coming soon" page. The owner and the
 * pharmacist-titular see it (the people who set the delivery amounts).
 */
export default async function LaunchChecklistPage() {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const readiness = await loadLaunchChecklist(actor);

  return (
    <Container asChild size="lg">
      <main className="py-10">
        <Stack gap={6}>
          <PageHeader
            title="Launch checklist"
            description="What still has to be answered or set up before the webshop opens to customers."
          />
          {!readiness ? (
            <Alert variant="error" title="You can't see the launch checklist">
              Only the owner and the pharmacist-titular see it.
            </Alert>
          ) : (
            <>
              {readiness.ready ? (
                <Alert variant="success" title="Nothing blocks the opening">
                  <span data-testid="launch-ready">
                    Every item the back-office can check is in place. The storefront checks its own
                    settings when it opens.
                  </span>
                </Alert>
              ) : (
                <Alert variant="error" title="The shop can't open yet">
                  <span data-testid="launch-missing-count">
                    {readiness.missing.length}{" "}
                    {readiness.missing.length === 1 ? "item blocks" : "items block"} the opening.
                    The storefront stays on its "coming soon" page until they are in.
                  </span>
                </Alert>
              )}
              <p className="max-w-prose">
                The numbers refer to the{" "}
                <Link href={QUESTIONS_URL} rel="noopener noreferrer">
                  questions for the pharmacy owner
                </Link>
                . Answer there, quoting the number. Never post passwords, keys, bank details or
                internet addresses there: send those to Ali directly.
              </p>
              <ResponsiveTable data-testid="launch-checklist">
                <caption className="sr-only">Launch checklist</caption>
                <TableHead>
                  <TableRow className="border-b border-[var(--color-border-strong)]">
                    <TableHeader scope="col" className="py-2 pr-4 font-semibold">
                      Question
                    </TableHeader>
                    <TableHeader scope="col" className="py-2 pr-4 font-semibold">
                      What
                    </TableHeader>
                    <TableHeader scope="col" className="py-2 pr-4 font-semibold">
                      Status
                    </TableHeader>
                    <TableHeader scope="col" className="py-2 font-semibold">
                      What is needed
                    </TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {readiness.checks.map((check) => (
                    <TableRow
                      key={check.id}
                      data-testid={`launch-check-${check.id}`}
                      data-status={check.status}
                      className="border-b border-[var(--color-border)] align-top"
                    >
                      <TableCell label="Question" className="py-3 pr-4 whitespace-nowrap">
                        {check.items}
                      </TableCell>
                      <TableCell label="What" className="py-3 pr-4 font-medium">
                        {check.title}
                      </TableCell>
                      <TableCell label="Status" className="py-3 pr-4">
                        <Badge
                          variant={LAUNCH_STATUS_BADGE[check.status]}
                          className="whitespace-nowrap"
                        >
                          {LAUNCH_STATUS_LABELS[check.status]}
                        </Badge>
                      </TableCell>
                      <TableCell label="What is needed" className="py-3">
                        {check.detail}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </ResponsiveTable>
            </>
          )}
        </Stack>
      </main>
    </Container>
  );
}
