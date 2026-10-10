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
