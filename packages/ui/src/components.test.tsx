import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  Alert,
  Badge,
  Button,
  Container,
  FieldError,
  Input,
  Label,
  Link,
  Price,
  Select,
  Stack,
  TextField,
  Textarea,
  VisuallyHidden,
  formatPrice,
} from "./index";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
/** Intl uses U+00A0 / U+202F around the currency symbol; compare with plain spaces. */
const spaces = (s: string) => s.replace(/[  ]/g, " ");

describe("Button", () => {
  it("renders a type=button <button> with the primary variant by default", () => {
    const out = html(<Button>Save</Button>);
    expect(out).toMatch(/^<button type="button"/);
    expect(out).toContain("bg-[var(--color-primary)]");
    expect(out).toContain(">Save</button>");
  });

  it("loading: aria-busy, disabled and a hidden spinner, label still visible", () => {
    const out = html(<Button loading>Pay</Button>);
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain('disabled=""');
    expect(out).toMatch(/<svg aria-hidden="true"[^>]*data-slot="spinner"/);
    expect(out).toContain("Pay</button>");
  });

  it("accent always carries the dark text colour", () => {
    expect(html(<Button variant="accent">Go</Button>)).toContain("text-[var(--color-text)]");
  });

  it("icon-only buttons require an accessible name (compile time) and render it", () => {
    const out = html(
      <Button iconOnly aria-label="Close">
        ×
      </Button>,
    );
    expect(out).toContain('aria-label="Close"');
    // @ts-expect-error: an icon-only button without aria-label does not type-check
    html(<Button iconOnly>×</Button>);
  });

  it("asChild styles the child element instead of rendering a <button>", () => {
    const out = html(
      <Button asChild variant="secondary">
        <a href="/cart">Cart</a>
      </Button>,
    );
    expect(out).toMatch(/^<a href="\/cart" class="[^"]*border-\[var\(--color-primary\)\]/);
    expect(out).not.toContain("<button");
  });
});

describe("Link", () => {
  it("is always underlined (colour never marks a link alone)", () => {
    const out = html(<Link href="/help">Help</Link>);
    expect(out).toMatch(/^<a class="[^"]*\bunderline\b/);
    expect(out).toContain('href="/help"');
  });
});

describe("Input, Label, FieldError, TextField", () => {
  it("Select and Textarea: aria-invalid only when invalid, input styles", () => {
    expect(html(<Select />)).not.toContain("aria-invalid");
    expect(html(<Select invalid />)).toContain('aria-invalid="true"');
    expect(html(<Textarea invalid />)).toContain('aria-invalid="true"');
    expect(html(<Textarea />)).toContain('rows="4"');
    expect(html(<Textarea />)).toContain("min-h-[44px]");
  });

  it("Input: aria-invalid only when invalid", () => {
    expect(html(<Input />)).not.toContain("aria-invalid");
    expect(html(<Input invalid />)).toContain('aria-invalid="true"');
  });

  it("Label: the required star is hidden from assistive technology", () => {
    expect(
      html(
        <Label htmlFor="x" required>
          Name
        </Label>,
      ),
    ).toContain('<span aria-hidden="true" class="ml-0.5 text-[var(--color-error-text)]">*</span>');
  });

  it("FieldError: icon and text", () => {
    const out = html(<FieldError id="e">Required</FieldError>);
    expect(out).toMatch(/^<p class="[^"]*" id="e"><svg aria-hidden="true"/);
    expect(out).toContain("<span>Required</span>");
  });

  it("TextField wires label, hint and error to the input", () => {
    const out = html(
      <TextField
        id="email"
        label="E-mail"
        hint="We never share it"
        error="Invalid address"
        required
      />,
    );
    expect(out).toContain(
      '<label class="block text-sm font-medium text-[var(--color-text)]" for="email">',
    );
    expect(out).toContain('id="email-hint"');
    expect(out).toContain('id="email-error"');
    const input = /<input[^>]*>/.exec(out)?.[0] ?? "";
    expect(input).toContain('id="email"');
    expect(input).toContain('aria-invalid="true"');
    expect(input).toContain('aria-describedby="email-hint email-error"');
    expect(input).toContain('required=""');
  });

  it("TextField without an error is valid and generates an id", () => {
    const out = html(<TextField label="City" />);
    const input = /<input[^>]*>/.exec(out)?.[0] ?? "";
    expect(input).not.toContain("aria-invalid");
    expect(input).not.toContain("aria-describedby");
    const id = /id="([^"]+)"/.exec(input)?.[1];
    expect(id).toBeTruthy();
    expect(out).toContain(`for="${id}"`);
  });
});

describe("Badge and Alert", () => {
  it("Badge amber: filled Amber with dark text", () => {
    const out = html(<Badge variant="amber">New</Badge>);
    expect(out).toContain("bg-[var(--color-accent)]");
    expect(out).toContain("text-[var(--color-text)]");
  });

  it.each([
    ["success", "status"],
    ["info", "status"],
    ["error", "alert"],
  ] as const)("Alert %s: role=%s, an icon and a text title", (variant, role) => {
    const out = html(
      <Alert variant={variant} title="Heads up">
        Body
      </Alert>,
    );
    expect(out).toMatch(new RegExp(`^<div role="${role}"`));
    expect(out).toMatch(/<svg aria-hidden="true"[^>]*data-slot="icon"/);
    expect(out).toContain(">Heads up</p>");
    expect(out).toContain("<div>Body</div>");
  });
});

describe("Price", () => {
  it.each([
    ["nl-BE", "€ 12,50"],
    ["fr-BE", "12,50 €"],
    ["de-BE", "12,50 €"],
    ["en-BE", "€12.50"],
  ])("%s → %s (symbol placement from Intl)", (locale, expected) => {
    expect(spaces(formatPrice(1250, locale))).toBe(expected);
  });

  it("rejects non-integer cents", () => {
    expect(() => formatPrice(12.5, "nl-BE")).toThrow(RangeError);
  });

  it("renders tabular numbers, a machine-readable value and the VAT label", () => {
    const out = spaces(html(<Price cents={399} locale="nl-BE" vatLabel="incl. btw" />));
    expect(out).toContain('<data value="3.99" class="font-semibold tabular-nums');
    expect(out).toContain(">€ 3,99</data>");
    expect(out).toContain(">incl. btw</span>");
  });
});

describe("VisuallyHidden, Container, Stack", () => {
  it("VisuallyHidden uses sr-only", () => {
    expect(html(<VisuallyHidden>euro</VisuallyHidden>)).toBe('<span class="sr-only">euro</span>');
  });

  it("Container and Stack render layout classes only", () => {
    expect(html(<Container size="sm" />)).toBe(
      '<div class="mx-auto w-full px-4 sm:px-6 max-w-2xl"></div>',
    );
    expect(html(<Stack direction="row" gap={2} align="center" />)).toBe(
      '<div class="flex flex-row flex-wrap gap-2 items-center"></div>',
    );
  });
});
