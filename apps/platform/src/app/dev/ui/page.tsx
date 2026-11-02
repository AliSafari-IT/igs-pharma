import { appEnv, parseEnvFor, uiGalleryEnabled, uiGalleryEnv } from "@igs/config";
import {
  Alert,
  Badge,
  Button,
  Container,
  Link,
  Price,
  Stack,
  TextField,
  VisuallyHidden,
} from "@igs/ui";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import {
  ResponsiveTable,
  TableBody,
  TableCell,
  TableFoot,
  TableFooterCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowHeader,
} from "../../../components/responsive-table";

import { TableSkeleton } from "../../../components/table-skeleton";

/**
 * Component gallery (T-017): every @igs/ui primitive and variant on one page, for review, the visual
 * smoke test and axe. A 404 in production unless UI_GALLERY=on (read at request time).
 */
export const metadata = { title: "UI gallery · IGS-Pharma Platform" };

const galleryEnv = appEnv.extend(uiGalleryEnv.shape);

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = `section-${title.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className="font-display text-xl font-semibold text-[var(--color-text)]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-6 shadow-[var(--shadow-card)]">
      {children}
    </div>
  );
}

export default function UiGalleryPage() {
  if (!uiGalleryEnabled(parseEnvFor(galleryEnv))) notFound();

  return (
    <Container asChild size="md">
      <main className="py-10">
        <Stack gap={8}>
          <header className="flex flex-col gap-2">
            <h1 className="font-display text-4xl font-medium text-[var(--color-primary)]">
              UI gallery
            </h1>
            <p className="text-[var(--color-text-subtle)]">
              @igs/ui primitives. Every colour pair here is checked for WCAG AA in{" "}
              <code>contrast.test.ts</code>.
            </p>
          </header>

          <Section title="Button">
            <Card>
              <Stack direction="row" gap={3} align="center">
                <Button>Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="accent">Accent</Button>
                <Button variant="danger">Danger</Button>
              </Stack>
              <Stack direction="row" gap={3} align="center" className="mt-4">
                <Button size="sm">Small</Button>
                <Button size="lg">Large</Button>
                <Button loading>Saving</Button>
                <Button disabled>Disabled</Button>
                <Button iconOnly aria-label="Close" variant="ghost">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="size-5"
                  >
                    <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                  </svg>
                </Button>
                <Button asChild variant="secondary">
                  <a href="#section-link">Link styled as a button</a>
                </Button>
              </Stack>
            </Card>
          </Section>

          <Section title="Link">
            <Card>
              <p>
                Read the <Link href="#section-link">package leaflet</Link> or{" "}
                <Link variant="subtle" href="#section-link">
                  contact the pharmacist
                </Link>
                .
              </p>
            </Card>
          </Section>

          <Section title="Form fields">
            <Card>
              <form className="grid gap-6 sm:grid-cols-2" aria-label="Example form">
                <TextField label="First name" name="firstName" autoComplete="given-name" required />
                <TextField
                  label="E-mail"
                  name="email"
                  type="email"
                  defaultValue="jan@example"
                  hint="For your order confirmation."
                  error="Enter a valid e-mail address."
                  required
                />
                <TextField
                  label="Postcode"
                  name="postcode"
                  placeholder="1000"
                  inputMode="numeric"
                />
                <TextField label="Disabled" name="disabled" defaultValue="Read only" disabled />
              </form>
            </Card>
          </Section>

          <Section title="Badge">
            <Card>
              <Stack direction="row" gap={2}>
                <Badge>Neutral</Badge>
                <Badge variant="primary">OTC</Badge>
                <Badge variant="success">In stock</Badge>
                <Badge variant="error">Out of stock</Badge>
                <Badge variant="amber">Promo</Badge>
              </Stack>
            </Card>
          </Section>

          <Section title="Alert">
            <Stack gap={3}>
              <Alert variant="success" title="Order placed">
                We sent a confirmation to your e-mail address.
              </Alert>
              <Alert variant="error" title="Payment failed">
                Your card was declined. Nothing was charged.
              </Alert>
              <Alert variant="info" title="Pharmacist advice">
                Ask us before combining painkillers.
              </Alert>
            </Stack>
          </Section>

          <Section title="Price">
            <Card>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
                <dt className="text-[var(--color-text-subtle)]">nl-BE</dt>
                <dd>
                  <Price cents={1250} locale="nl-BE" vatLabel="incl. btw" />
                </dd>
                <dt className="text-[var(--color-text-subtle)]">fr-BE</dt>
                <dd>
                  <Price cents={1250} locale="fr-BE" vatLabel="TVA comprise" />
                </dd>
                <dt className="text-[var(--color-text-subtle)]">de-BE</dt>
                <dd>
                  <Price cents={123456} locale="de-BE" vatLabel="inkl. MwSt." />
                </dd>
              </dl>
            </Card>
          </Section>

          <Section title="Responsive table">
            <ResponsiveTable data-testid="responsive-table-demo" className="align-top">
              <caption className="sr-only">Demo orders</caption>
              <TableHead>
                <TableRow className="border-b border-[var(--color-border-strong)]">
                  <TableHeader className="py-2 pr-4">Reference</TableHeader>
                  <TableHeader className="py-2 pr-4">Customer</TableHeader>
                  <TableHeader className="py-2 pr-4">Status</TableHeader>
                  <TableHeader className="py-2 text-right">Total</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow className="border-b border-[var(--color-border)]">
                  <TableCell label="Reference" className="py-2 pr-4">
                    <Link href="#responsive-table-target">IGS-DEMO-000001</Link>
                  </TableCell>
                  <TableCell label="Customer" className="py-2 pr-4">
                    DemoCustomerWithAVeryLongUnbrokenNameToCheckNarrowScreens
                  </TableCell>
                  <TableCell label="Status" className="py-2 pr-4">
                    <span className="flex flex-wrap gap-1">
                      <Badge variant="primary">In review</Badge>
                      <Badge variant="neutral">Medicine</Badge>
                      <Badge variant="error">Refund due</Badge>
                    </span>
                  </TableCell>
                  <TableCell label="Total" className="py-2 text-right tabular-nums">
                    € 1.234,56
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-[var(--color-border)]">
                  <TableCell label="Reference" className="py-2 pr-4">
                    IGS-DEMO-000002
                  </TableCell>
                  <TableCell label="Customer" className="py-2 pr-4">
                    —
                  </TableCell>
                  <TableCell label="Status" className="py-2 pr-4">
                    <Badge variant="success">Ready for pickup</Badge>
                  </TableCell>
                  <TableCell label="Total" className="py-2 text-right tabular-nums">
                    € 0,00
                  </TableCell>
                </TableRow>
              </TableBody>
            </ResponsiveTable>
            <p id="responsive-table-target">Synthetic table example; no customer records.</p>
          </Section>

          <Section title="Operational table">
            <ResponsiveTable data-testid="operational-table-demo">
              <caption className="sr-only">Demo operational details</caption>
              <TableHead>
                <TableRow>
                  <TableHeader className="py-2 pr-4">Product</TableHeader>
                  <TableHeader className="py-2 pr-4">Lot</TableHeader>
                  <TableHeader className="py-2 pr-4">Expires</TableHeader>
                  <TableHeader className="py-2">Actions</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow>
                  <TableCell label="Product" className="py-2 pr-4">
                    Demo product
                  </TableCell>
                  <TableCell label="Lot" className="py-2 pr-4">
                    DEMO-LONG-LOT-REFERENCE-1234567890
                  </TableCell>
                  <TableCell label="Expires" className="py-2 pr-4">
                    31/12/2027
                  </TableCell>
                  <TableCell label="Actions" stacked className="py-2">
                    <Button type="button" variant="secondary">
                      Example reservation action
                    </Button>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell label="Product" className="py-2 pr-4">
                    Demo shortage
                  </TableCell>
                  <TableCell label="Lot / Expires" colSpan={2} className="py-2 pr-4">
                    <Badge variant="error">No sellable lot</Badge>
                  </TableCell>
                  <TableCell label="Actions" stacked className="py-2">
                    Await stock
                  </TableCell>
                </TableRow>
              </TableBody>
              <TableFoot>
                <TableRow>
                  <TableRowHeader colSpan={3} className="py-2 pr-4 text-right">
                    Total (VAT included)
                  </TableRowHeader>
                  <TableFooterCell className="py-2 text-right tabular-nums">
                    € 1.234,56
                  </TableFooterCell>
                </TableRow>
              </TableFoot>
            </ResponsiveTable>
          </Section>

          <Section title="Loading a list">
            <TableSkeleton columns={4} rows={3} />
          </Section>

          <Section title="Typography">
            <Card>
              <Stack gap={2}>
                <p className="font-display text-3xl">Fraunces display — Apotheek, Pharmacie</p>
                <p className="font-sans">
                  Inter body — Ça coûte 12,50 € · Größe · Œuvre · Łódź
                  <VisuallyHidden> (Latin Extended sample)</VisuallyHidden>
                </p>
                <p className="font-sans tabular-nums">Tabular: 1 111,11 € · 8 888,88 €</p>
              </Stack>
            </Card>
          </Section>
        </Stack>
      </main>
    </Container>
  );
}
