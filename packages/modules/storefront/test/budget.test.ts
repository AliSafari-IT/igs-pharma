// The D-041 budget (igs-pharma#103): list and search p95 < 300 ms on a synthetic 2,000-product
// catalogue (4 locales, medicines with approved text, prices, stock, categories). The EXPLAIN of the
// search statement is printed for the PR body.
import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import type { Actor } from "@igs/kernel";
import { configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { registerAuditActions as registerCatalogAudit } from "@igs/module-catalog";
import { loadRbacCatalogue } from "@igs/module-identity";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  configureStorefront,
  getStorefrontProduct,
  listStorefrontCategories,
  listStorefrontProducts,
} from "../src";

const PRODUCTS = 2_000;
const RUNS = 100;
const BUDGET_MS = 300;

let iso: IsolatedDatabase;
const storefront: Actor = { type: "system", id: "storefront", roles: ["system_storefront"] };

beforeAll(async () => {
  iso = await createIsolatedDatabase();
  await loadRbacCatalogue(iso.db);
  registerCatalogAudit(registerAuditAction);
  const kernel = configureKernelForTests({ db: iso.db, audit: createAuditPort() });
  kernel.clock.set(new Date());
  configureStorefront({});

  await iso.sql`
    INSERT INTO catalog.categories (id, slug, name_nl, name_fr, sort_order)
    SELECT gen_random_uuid(), 'perf-' || g, 'Categorie ' || g, 'Catégorie ' || g, g
    FROM generate_series(1, 12) g`;
  await iso.sql`
    INSERT INTO catalog.brands (id, name, slug)
    SELECT gen_random_uuid(), 'Merk ' || g, 'merk-' || g FROM generate_series(1, 40) g`;
  await iso.sql`
    INSERT INTO catalog.products (id, cnk, product_type, legal_status, status, vat_class, brand_id, created_at)
    SELECT gen_random_uuid(), (8000000 + g)::text,
      CASE WHEN g % 3 = 0 THEN 'otc_medicine' ELSE 'cosmetic' END,
      CASE WHEN g % 3 = 0 THEN 'otc' ELSE 'general_sale' END,
      CASE WHEN g % 50 = 0 THEN 'draft' ELSE 'active' END,
      CASE WHEN g % 3 = 0 THEN 'BE_6' ELSE 'BE_21' END,
      (SELECT id FROM catalog.brands ORDER BY slug LIMIT 1 OFFSET (g % 40)),
      now() - make_interval(mins => g)
    FROM generate_series(1, ${PRODUCTS}) g`;
  const list = (items: string[]) => `ARRAY[${items.map((w) => `'${w}'`).join(", ")}]::text[]`;
  const words = list([
    "crème",
    "zalf",
    "shampoo",
    "tabletten",
    "siroop",
    "pleisters",
    "spray",
    "gel",
    "olie",
    "poeder",
  ]);
  const adjectives = list([
    "hydraterende",
    "kalmerende",
    "beschermende",
    "verzachtende",
    "herstellende",
  ]);
  await iso.sql.unsafe(`
    INSERT INTO catalog.product_content (product_id, locale, name, short_description, description, source, approved_by, approved_at)
    SELECT p.id, l.locale,
      initcap((${adjectives})[1 + (p.g % 5)]) || ' ' || (${words})[1 + (p.g % 10)] || ' ' || p.g || ' ' || l.locale,
      'Korte beschrijving ' || (${words})[1 + ((p.g + 3) % 10)] || ' voor dagelijks gebruik',
      'Lange beschrijving ' || p.g, 'manual',
      CASE WHEN p.product_type = 'otc_medicine' THEN gen_random_uuid() END,
      CASE WHEN p.product_type = 'otc_medicine' THEN now() END
    FROM (SELECT id, product_type, (cnk::int - 8000000) AS g FROM catalog.products) p
    JOIN (VALUES ('nl'), ('fr'), ('de'), ('en')) l(locale)
      ON l.locale IN ('nl', 'fr') OR (l.locale = 'de' AND p.g % 2 = 0) OR (l.locale = 'en' AND p.g % 3 = 0)`);
  await iso.sql`
    INSERT INTO catalog.product_categories (product_id, category_id)
    SELECT p.id, (SELECT id FROM catalog.categories ORDER BY slug LIMIT 1 OFFSET ((p.cnk::int) % 12))
    FROM catalog.products p`;
  await iso.sql`
    INSERT INTO pricing.prices (id, product_id, channel, amount_cents, valid_from, created_by_type, created_by)
    SELECT gen_random_uuid(), p.id, 'web', 100 + (p.cnk::int % 90) * 25, now() - interval '1 day', 'system', 'budget'
    FROM catalog.products p WHERE p.cnk::int % 17 <> 0`;
  // every unit of stock is in a lot (igs-pharma#164): one untracked lot per stocked product
  await iso.sql`
    INSERT INTO inventory.lots (id, product_id, location_id, tracking, created_by_type, created_by_id)
    SELECT gen_random_uuid(), p.id, '0192f000-0000-7000-8000-000000000001', 'no_lot', 'system', 'budget'
    FROM catalog.products p WHERE p.cnk::int % 5 <> 0`;
  await iso.sql`
    INSERT INTO inventory.stock_movements (id, product_id, location_id, lot_id, delta, reason, actor_type, actor_id)
    SELECT gen_random_uuid(), l.product_id, l.location_id, l.id, (p.cnk::int % 13) + 1, 'adjustment', 'system', 'budget'
    FROM inventory.lots l JOIN catalog.products p ON p.id = l.product_id`;
  await iso.sql`ANALYZE`;
}, 300_000);
afterAll(async () => {
  await iso?.drop();
});

async function measure(run: () => Promise<unknown>) {
  for (let i = 0; i < 5; i++) await run(); // warm-up
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    await run();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return {
    p50: times[Math.floor(RUNS * 0.5)] ?? 0,
    p95: times[Math.floor(RUNS * 0.95)] ?? 0,
    max: times[RUNS - 1] ?? 0,
  };
}

describe(`D-041 budget: p95 < ${BUDGET_MS} ms on ${PRODUCTS} products`, () => {
  const scenarios: [string, () => Promise<unknown>][] = [
    ["list, name order, page 1", () => listStorefrontProducts({ locale: "nl" }, storefront)],
    ["list, page 20", () => listStorefrontProducts({ locale: "fr", page: 20 }, storefront)],
    ["search one word", () => listStorefrontProducts({ locale: "nl", q: "creme" }, storefront)],
    [
      "search two words, French",
      () => listStorefrontProducts({ locale: "fr", q: "kalmerende zalf" }, storefront),
    ],
    [
      "search + category + price sort",
      () =>
        listStorefrontProducts(
          { locale: "nl", q: "gel", categorySlug: "perf-3", sort: "price_asc" },
          storefront,
        ),
    ],
    [
      "in stock, price descending",
      () =>
        listStorefrontProducts(
          { locale: "en", availability: "in_stock", sort: "price_desc" },
          storefront,
        ),
    ],
    [
      "latest, 6 items",
      () => listStorefrontProducts({ locale: "nl", sort: "latest", pageSize: 6 }, storefront),
    ],
    ["category tree", () => listStorefrontCategories({ locale: "nl" }, storefront)],
    ["product page", () => getStorefrontProduct({ cnk: "8000010", locale: "nl" }, storefront)],
  ];

  it.each(scenarios)(
    "%s",
    async (name, run) => {
      const result = await measure(run);
      process.stdout.write(
        `budget | ${name.padEnd(34)} | p50 ${result.p50.toFixed(1)} ms | p95 ${result.p95.toFixed(1)} ms | max ${result.max.toFixed(1)} ms\n`,
      );
      // wall-clock timings are report-only in the normal run (a loaded CI runner would flake, #107);
      // the hard assertion is opt-in: IGS_BUDGET=1 pnpm --filter @igs/module-storefront test
      if (process.env["IGS_BUDGET"] === "1") expect(result.p95, name).toBeLessThan(BUDGET_MS);
    },
    120_000,
  );

  it("the search statement uses the trigram index at this size when asked for one word", async () => {
    const statements: { query: string; parameters: unknown[] }[] = [];
    const options = iso.sql.options as unknown as {
      debug: (connection: number, query: string, parameters: unknown[]) => void;
    };
    const previous = options.debug;
    options.debug = (_connection, query, parameters) => {
      if (query.includes("search_text") && query.includes('"dutch"')) {
        statements.push({ query, parameters });
      }
    };
    try {
      await listStorefrontProducts({ locale: "nl", q: "creme" }, storefront);
    } finally {
      options.debug = previous;
    }
    const captured = statements[0];
    expect(captured, "the search statement was captured").toBeDefined();
    if (!captured) return;
    // the planner picks a sequential scan on 2,000 rows when it may; with it disabled the plan shows
    // whether the trigram index CAN serve this statement (the structural check)
    const plan = await iso.sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL enable_seqscan = off");
      return tx.unsafe(
        `EXPLAIN (ANALYZE, BUFFERS) ${captured.query}`,
        captured.parameters as never[],
      );
    });
    const text = plan.map((row) => String(row["QUERY PLAN"])).join("\n");
    process.stdout.write(`EXPLAIN (ANALYZE, BUFFERS) of the search candidates:\n${text}\n`);
    expect(text).toContain("product_content_search_text_trgm_idx");
    expect(text).not.toMatch(/Seq Scan on product_content/);
  });
});
