/**
 * Synthetic catalogue seed (igs-pharma#50): loads about twenty FAKE products (CNKs 0000001–0000020,
 * names starting with "Demo", "Synthetic test product, not for sale") and two fake brands, so the
 * back-office can be tried on staging and in development. Nothing here describes a real product.
 *
 *   node dist/seed-catalog.js                                  (dev: pnpm --filter @igs/worker seed-catalog)
 *   NODE_ENV=production IGS_ALLOW_SYNTHETIC_SEED=1 node dist/seed-catalog.js   (staging only)
 *
 * Refuses when `NODE_ENV=production` unless `IGS_ALLOW_SYNTHETIC_SEED=1`. Safe to run twice: a CNK
 * or brand that exists is left as it is. Runs through the kernel as a system actor holding
 * `system_seed` (no user can hold it), so every write is audited like an editor's.
 */
import { parseEnvFor, syntheticSeedAllowed, syntheticSeedEnv, workerEnv } from "@igs/config/env";
import { checkDatabase, closeDatabase, configureKernel, isDomainError } from "@igs/kernel";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import {
  type ContentLocale,
  type LegalStatus,
  type ProductType,
  type VatClass,
  createBrand,
  createProduct,
  listBrands,
  registerAuditActions as registerCatalogAuditActions,
  setProductStatus,
} from "@igs/module-catalog";
import {
  ensureRbacCatalogue,
  registerAuditActions as registerIdentityAuditActions,
} from "@igs/module-identity";

const SEED_ACTOR = { type: "system", id: "seed-catalog", roles: ["system_seed"] } as const;

const NOTICE = {
  nl: "Synthetisch testproduct, niet te koop.",
  fr: "Produit de test synthétique, pas en vente.",
  de: "Synthetisches Testprodukt, nicht im Verkauf.",
  en: "Synthetic test product, not for sale.",
} satisfies Record<ContentLocale, string>;

const BRANDS = [
  { name: "Demo Pharma", slug: "demo-pharma" },
  { name: "Demo Care", slug: "demo-care" },
] as const;

interface SeedProduct {
  readonly names: Partial<Record<ContentLocale, string>>;
  readonly type: ProductType;
  readonly legal: LegalStatus;
  readonly vat: VatClass;
  readonly brand?: (typeof BRANDS)[number]["slug"];
  readonly status: "draft" | "active" | "archived";
  readonly ageMin?: number;
  readonly coldChain?: boolean;
  readonly review?: boolean;
}

const PRODUCTS: readonly SeedProduct[] = [
  {
    names: { nl: "Demo Hoestsiroop", fr: "Démo Sirop contre la toux", en: "Demo Cough Syrup" },
    type: "otc_medicine",
    legal: "otc",
    vat: "BE_6",
    brand: "demo-pharma",
    status: "active",
    ageMin: 6,
  },
  {
    names: { nl: "Demo Pijnstiller 500", fr: "Démo Antidouleur 500" },
    type: "otc_medicine",
    legal: "pharmacy_only",
    vat: "BE_6",
    brand: "demo-pharma",
    status: "active",
    review: true,
  },
  {
    names: { nl: "Demo Neusspray", fr: "Démo Spray nasal", de: "Demo Nasenspray" },
    type: "otc_medicine",
    legal: "otc",
    vat: "BE_6",
    brand: "demo-pharma",
    status: "active",
  },
  {
    names: { nl: "Demo Keeltabletten", fr: "Démo Pastilles pour la gorge" },
    type: "otc_medicine",
    legal: "otc",
    vat: "BE_6",
    brand: "demo-pharma",
    status: "active",
  },
  {
    names: { nl: "Demo Vitamine C", fr: "Démo Vitamine C", en: "Demo Vitamin C" },
    type: "food_supplement",
    legal: "general_sale",
    vat: "BE_6",
    brand: "demo-care",
    status: "active",
  },
  {
    names: { nl: "Demo Vitamine D3", fr: "Démo Vitamine D3" },
    type: "food_supplement",
    legal: "general_sale",
    vat: "BE_6",
    brand: "demo-care",
    status: "active",
  },
  {
    names: { nl: "Demo Magnesium", fr: "Démo Magnésium" },
    type: "food_supplement",
    legal: "general_sale",
    vat: "BE_6",
    brand: "demo-care",
    status: "active",
  },
  {
    names: { nl: "Demo Probiotica", fr: "Démo Probiotiques" },
    type: "food_supplement",
    legal: "general_sale",
    vat: "BE_6",
    brand: "demo-care",
    status: "draft",
    coldChain: true,
  },
  {
    names: {
      nl: "Demo Handcrème",
      fr: "Démo Crème pour les mains",
      de: "Demo Handcreme",
      en: "Demo Hand Cream",
    },
    type: "cosmetic",
    legal: "general_sale",
    vat: "BE_21",
    brand: "demo-care",
    status: "active",
  },
  {
    names: { nl: "Demo Zonnebrand SPF 50", fr: "Démo Crème solaire SPF 50" },
    type: "cosmetic",
    legal: "general_sale",
    vat: "BE_21",
    brand: "demo-care",
    status: "active",
  },
  {
    names: { nl: "Demo Lippenbalsem", fr: "Démo Baume à lèvres" },
    type: "cosmetic",
    legal: "general_sale",
    vat: "BE_21",
    status: "active",
  },
  {
    names: { nl: "Demo Douchegel", fr: "Démo Gel douche" },
    type: "cosmetic",
    legal: "general_sale",
    vat: "BE_21",
    status: "archived",
  },
  {
    names: { nl: "Demo Koortsthermometer", fr: "Démo Thermomètre" },
    type: "medical_device",
    legal: "general_sale",
    vat: "BE_21",
    brand: "demo-pharma",
    status: "active",
  },
  {
    names: { nl: "Demo Pleisters", fr: "Démo Pansements" },
    type: "medical_device",
    legal: "general_sale",
    vat: "BE_6",
    brand: "demo-pharma",
    status: "active",
  },
  {
    names: { nl: "Demo Bloeddrukmeter", fr: "Démo Tensiomètre" },
    type: "medical_device",
    legal: "general_sale",
    vat: "BE_21",
    status: "draft",
  },
  {
    names: { nl: "Demo Handgel", fr: "Démo Gel hydroalcoolique" },
    type: "biocide",
    legal: "general_sale",
    vat: "BE_21",
    status: "active",
  },
  {
    names: { nl: "Demo Muggenspray", fr: "Démo Spray anti-moustiques" },
    type: "biocide",
    legal: "general_sale",
    vat: "BE_21",
    status: "active",
    ageMin: 12,
  },
  {
    names: { nl: "Demo Allergietabletten", fr: "Démo Comprimés antiallergiques" },
    type: "otc_medicine",
    legal: "pharmacy_only",
    vat: "BE_6",
    brand: "demo-pharma",
    status: "active",
    review: true,
    ageMin: 12,
  },
  {
    names: { nl: "Demo Oogdruppels" },
    type: "otc_medicine",
    legal: "otc",
    vat: "BE_6",
    status: "draft",
  },
  {
    names: { nl: "Demo Wattenstaafjes", fr: "Démo Cotons-tiges" },
    type: "general",
    legal: "general_sale",
    vat: "BE_21",
    status: "active",
  },
];

const cnkFor = (index: number) => String(index + 1).padStart(7, "0");

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function brandIds(): Promise<Map<string, string>> {
  for (const brand of BRANDS) {
    try {
      await createBrand(brand, SEED_ACTOR);
    } catch (error) {
      if (!isDomainError(error) || error.code !== "catalog.brand_slug_taken") throw error;
    }
  }
  const brands = await listBrands({}, SEED_ACTOR);
  return new Map(brands.map((b) => [b.slug, b.id]));
}

const seedEnv = workerEnv.extend(syntheticSeedEnv.shape);

async function main() {
  let env: ReturnType<typeof parseEnvFor<typeof seedEnv>>;
  try {
    env = parseEnvFor(seedEnv);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  if (!syntheticSeedAllowed(env)) {
    fail("refused: NODE_ENV=production. Set IGS_ALLOW_SYNTHETIC_SEED=1 on staging only.");
  }

  registerIdentityAuditActions(registerAuditAction);
  registerCatalogAuditActions(registerAuditAction);
  configureKernel({ audit: createAuditPort() });
  try {
    await checkDatabase();
    await ensureRbacCatalogue();
    const brands = await brandIds();
    let created = 0;
    let skipped = 0;
    for (const [index, seed] of PRODUCTS.entries()) {
      const content = (Object.entries(seed.names) as [ContentLocale, string][]).map(
        ([locale, name]) => ({
          locale,
          name,
          shortDescription: NOTICE[locale],
          description: NOTICE[locale],
        }),
      );
      try {
        const { productId } = await createProduct(
          {
            cnk: cnkFor(index),
            productType: seed.type,
            legalStatus: seed.legal,
            vatClass: seed.vat,
            requiresPharmacistReview: seed.review ?? false,
            ageMin: seed.ageMin ?? null,
            coldChain: seed.coldChain ?? false,
            brandId: seed.brand ? (brands.get(seed.brand) ?? null) : null,
            content,
          },
          SEED_ACTOR,
        );
        if (seed.status !== "draft") {
          await setProductStatus({ productId, status: seed.status }, SEED_ACTOR);
        }
        created++;
      } catch (error) {
        if (!isDomainError(error) || error.code !== "catalog.cnk_taken") throw error;
        skipped++;
      }
    }
    process.stdout.write(
      `Synthetic catalogue: ${created} product(s) created, ${skipped} already there (CNK ${cnkFor(0)}–${cnkFor(PRODUCTS.length - 1)}).\n`,
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
