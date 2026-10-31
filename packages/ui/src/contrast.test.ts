import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { alertContrast, alertTitleClasses, alertVariants } from "./components/alert";
import { badgeContrast, badgeVariants } from "./components/badge";
import { buttonContrast, buttonVariants } from "./components/button";
import {
  fieldErrorClasses,
  fieldTextContrast,
  hintClasses,
  inputClasses,
  inputContrast,
  labelClasses,
} from "./components/field";
import { linkContrast, linkVariants } from "./components/link";
import { priceContrast } from "./components/price";
import { COLOR_TOKENS, type ContrastPair, MIN_RATIO, NEVER_TEXT, topBarContrast } from "./contrast";

/** tokens.css is the single source of colour values: its @theme block (light) and dark blocks. */
const CSS = readFileSync(new URL("./styles/tokens.css", import.meta.url), "utf8");

function colours(block: string, where: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const match of block.matchAll(/--color-([a-z0-9-]+):\s*([^;]+);/g)) {
    const [, name, value] = match as unknown as [string, string, string];
    if (!/^#[0-9a-f]{6}$/i.test(value.trim())) {
      throw new Error(
        `tokens.css ${where}: --color-${name} is not #rrggbb (${value}); the test needs hex`,
      );
    }
    tokens.set(name, value.trim().toLowerCase());
  }
  return tokens;
}

function block(pattern: RegExp, where: string): string {
  const found = pattern.exec(CSS)?.[1];
  if (!found) throw new Error(`tokens.css: no ${where} block`);
  return found;
}

const THEMES = {
  light: colours(block(/@theme\s*\{([\s\S]*?)\n\}/, "@theme"), "@theme"),
  dark: colours(block(/\n:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/, "dark"), "dark"),
} as const;
type Theme = keyof typeof THEMES;
const tokens = THEMES.light;

const hexIn = (theme: Theme, name: string) => {
  if (name === "white") return "#ffffff";
  const value = THEMES[theme].get(name);
  if (!value) throw new Error(`unknown colour token ${name} (${theme})`);
  return value;
};

/** WCAG 2.x relative luminance and contrast ratio. */
function luminance(color: string): number {
  const channels = [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}
function contrastIn(theme: Theme, a: string, b: string): number {
  const [hi, lo] = [luminance(hexIn(theme, a)), luminance(hexIn(theme, b))].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}
const contrast = (a: string, b: string) => contrastIn("light", a, b);

/** Every component's manifest, with the class string the variant actually renders. */
const MANIFESTS: Array<{ name: string; classes: string; pairs: ContrastPair[] }> = [
  ...Object.entries(buttonContrast).map(([variant, pairs]) => ({
    name: `Button.${variant}`,
    classes: buttonVariants({ variant: variant as keyof typeof buttonContrast }),
    pairs,
  })),
  ...Object.entries(linkContrast).map(([variant, pairs]) => ({
    name: `Link.${variant}`,
    classes: linkVariants({ variant: variant as keyof typeof linkContrast }),
    pairs,
  })),
  ...Object.entries(badgeContrast).map(([variant, pairs]) => ({
    name: `Badge.${variant}`,
    classes: badgeVariants({ variant: variant as keyof typeof badgeContrast }),
    pairs,
  })),
  ...Object.entries(alertContrast).map(([variant, pairs]) => ({
    name: `Alert.${variant}`,
    classes: `${alertVariants({ variant: variant as keyof typeof alertContrast })} ${
      alertTitleClasses[variant as keyof typeof alertTitleClasses]
    }`,
    pairs,
  })),
  { name: "Input", classes: inputClasses.base, pairs: inputContrast.default },
  {
    name: "Input.invalid",
    classes: `${inputClasses.base} ${inputClasses.invalid}`,
    pairs: inputContrast.invalid,
  },
  { name: "Label", classes: labelClasses, pairs: fieldTextContrast.label },
  { name: "FieldError", classes: fieldErrorClasses, pairs: fieldTextContrast.error },
  { name: "Hint", classes: hintClasses, pairs: fieldTextContrast.hint },
  {
    name: "Price",
    classes: "text-[var(--color-text)] text-[var(--color-text-muted)]",
    pairs: [...priceContrast.amount, ...priceContrast.vat],
  },
];

describe("tokens.css ↔ contrast types", () => {
  it("COLOR_TOKENS lists exactly the --color-* tokens in tokens.css, in both themes", () => {
    expect([...COLOR_TOKENS].sort()).toEqual([...tokens.keys()].sort());
    expect([...COLOR_TOKENS].sort()).toEqual([...THEMES.dark.keys()].sort());
  });

  it("the system-dark block carries exactly the dark values (igs-pharma#191)", () => {
    const media = colours(
      block(
        /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{([\s\S]*?)\n {2}\}/,
        "media",
      ),
      "media",
    );
    expect([...media.entries()]).toEqual([...THEMES.dark.entries()]);
  });

  it("a never-text token can't be declared as text (compile time)", () => {
    const pairs: ContrastPair[] = [
      // @ts-expect-error: Fresh Teal is never text
      { fg: "secondary", bg: "bg", use: "text" },
      // @ts-expect-error: Amber is never text
      { fg: "accent", bg: "bg", use: "large-text" },
      // @ts-expect-error: the decorative border is not a UI border
      { fg: "border", bg: "bg", use: "ui" },
    ];
    expect(pairs).toHaveLength(3);
  });
});

describe("WCAG AA for every variant pair, in both themes", () => {
  const cases = (["light", "dark"] as const).flatMap((theme) =>
    MANIFESTS.flatMap(({ name, pairs }) =>
      pairs.map(
        (pair) =>
          [`${theme} ${name}: ${pair.fg} on ${pair.bg} (${pair.use})`, theme, pair] as const,
      ),
    ),
  );
  it.each(cases)("%s", (_, theme, pair) => {
    const ratio = contrastIn(theme, pair.fg, pair.bg);
    expect(ratio, `${ratio.toFixed(2)} < ${MIN_RATIO[pair.use]}`).toBeGreaterThanOrEqual(
      MIN_RATIO[pair.use],
    );
  });
});

describe("the storefront top bar (igs-pharma#193), in both themes", () => {
  const cases = (["light", "dark"] as const).flatMap((theme) =>
    topBarContrast.map((pair) => [`${theme}: ${pair.fg} on ${pair.bg}`, theme, pair] as const),
  );
  it.each(cases)("%s", (_, theme, pair) => {
    expect(contrastIn(theme, pair.fg, pair.bg)).toBeGreaterThanOrEqual(MIN_RATIO[pair.use]);
  });
});

describe("manifests match the classes (they can't lie)", () => {
  it.each(MANIFESTS.map((m) => [m.name, m] as const))("%s", (_, { classes, pairs }) => {
    for (const { fg, bg } of pairs) {
      if (fg === "white") expect(classes).toContain("text-white");
      else expect(classes).toContain(`var(--color-${fg})`);
      // a transparent component sits on the page or a card: those backgrounds aren't its classes
      const onSurface =
        (bg === "page" || bg === "bg" || bg === "surface") &&
        !classes.includes(`var(--color-${bg})`);
      if (!onSurface) expect(classes).toContain(`var(--color-${bg})`);
    }
  });

  it("no variant colours text with a never-text token", () => {
    for (const { name, classes } of MANIFESTS) {
      for (const token of NEVER_TEXT) {
        // built by joining: Tailwind scans this folder, and a template literal here reads as a class
        // and breaks `next dev`'s CSS parser
        expect(classes, name).not.toContain(["text-[var(--color-", token, ")]"].join(""));
      }
    }
  });
});

describe("design system §2.2 regression cases", () => {
  it.each([
    ["secondary", "bg", "<", 3], // Fresh Teal is never text, nor a UI border
    ["accent", "bg", "<", 3], // Amber is never text
    ["text", "accent", ">=", 4.5], // Amber only with dark text
    ["white", "accent", "<", 4.5], // … never with white text
    ["border-strong", "bg", ">=", 3], // form-control borders ≥ 3:1
    ["border", "bg", "<", 3], // the decorative border is not a control border
    ["success-text", "bg", ">=", 4.5], // #15803D for success text
    ["success", "bg", "<", 4.5], // the bright green is not text
    ["error-text", "error-subtle", ">=", 4.5], // #B91C1C on the error tint
  ] as const)("%s on %s %s %d", (fg, bg, op, limit) => {
    const ratio = contrast(fg, bg);
    if (op === "<") expect(ratio).toBeLessThan(limit);
    else expect(ratio).toBeGreaterThanOrEqual(limit);
  });
});
