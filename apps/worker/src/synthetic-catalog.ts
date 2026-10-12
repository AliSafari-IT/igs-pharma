/**
 * The synthetic catalogue (igs-pharma#50): about twenty FAKE products (CNKs 0000001–0000020, names
 * starting with "Demo", "Synthetic test product, not for sale") and two fake brands, plus demo
 * stock for them (igs-pharma#53). Nothing here describes a real product. `seed-catalog.ts` is the
 * CLI around it.
 */
import { type Actor, isDomainError } from "@igs/kernel";
import {
  type ContentLocale,
  type LegalStatus,
  type ProductType,
  type VatClass,
  createBrand,
  createProduct,
  listBrands,
  listProducts,
  setProductStatus,
} from "@igs/module-catalog";
import { importStock, listStock } from "@igs/module-inventory";

/** The seed CLI's system actor: `system_seed` is a system role no user can hold. */
export const SEED_ACTOR = { type: "system", id: "seed-catalog", roles: ["system_seed"] } as const;

const NOTICE = {
  nl: "Synthetisch testproduct, niet te koop.",
  fr: "Produit de test synthétique, pas en vente.",
  de: "Synthetisches Testprodukt, nicht im Verkauf.",
  en: "Synthetic test product, not for sale.",
} satisfies Record<ContentLocale, string>;

export const BRANDS = [
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

export const PRODUCTS: readonly SeedProduct[] = [
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

export const cnkFor = (index: number) => String(index + 1).padStart(7, "0");

/** The seed brands' ids by slug; a seed brand that cannot be found stops the seed. */
async function brandIds(actor: Actor): Promise<Map<string, string>> {
  for (const brand of BRANDS) {
    try {
      await createBrand(brand, actor);
    } catch (error) {
      if (!isDomainError(error) || error.code !== "catalog.brand_slug_taken") throw error;
    }
  }
  const slugs = BRANDS.map((b) => b.slug);
  const found = new Map((await listBrands({ slugs }, actor)).map((b) => [b.slug, b.id]));
  const missing = slugs.filter((slug) => !found.has(slug));
  if (missing.length > 0) throw new Error(`seed brand(s) not found: ${missing.join(", ")}`);
  return found;
}

export interface SeedResult {
  /** Products created by this run. */
  readonly created: number;
  /** Seed products left in draft by an interrupted run, now given their intended status. */
  readonly restored: number;
  /** Seed CNKs already there, left as they are. */
  readonly skipped: number;
}

/**
 * Loads the synthetic catalogue. Safe to run again: a brand or CNK that exists is left as it is,
 * except that a seed product still in draft while it should not be (a run stopped between
 * creating it and changing its status) gets its intended status. A product on a seed CNK that is
 * not the seed's (another Dutch name) is never changed.
 */
export async function seedSyntheticCatalog(actor: Actor = SEED_ACTOR): Promise<SeedResult> {
  const brands = await brandIds(actor);
  let created = 0;
  let restored = 0;
  let skipped = 0;
  for (const [index, seed] of PRODUCTS.entries()) {
    const cnk = cnkFor(index);
    const content = (Object.entries(seed.names) as [ContentLocale, string][]).map(
      ([locale, name]) => ({
        locale,
        name,
        shortDescription: NOTICE[locale],
        description: NOTICE[locale],
      }),
    );
    let productId: string;
    try {
      ({ productId } = await createProduct(
        {
          cnk,
          productType: seed.type,
          legalStatus: seed.legal,
          vatClass: seed.vat,
          requiresPharmacistReview: seed.review ?? false,
          ageMin: seed.ageMin ?? null,
          coldChain: seed.coldChain ?? false,
          brandId: seed.brand ? (brands.get(seed.brand) ?? null) : null,
          content,
        },
        actor,
      ));
      created++;
    } catch (error) {
      if (!isDomainError(error) || error.code !== "catalog.cnk_taken") throw error;
      const [existing] = (await listProducts({ cnk, pageSize: 1 }, actor)).items;
      // only our own draft (same Dutch name): a real product on a seed CNK is never touched
      const interrupted =
        existing?.status === "draft" &&
        existing.nameNl === seed.names.nl &&
        seed.status !== "draft";
      if (!existing || !interrupted) {
        skipped++;
        continue;
      }
      productId = existing.id;
      restored++;
    }
    if (seed.status !== "draft") {
      await setProductStatus({ productId, status: seed.status }, actor);
    }
  }
  return { created, restored, skipped };
}

/**
 * The demo on-hand of the seed product at `index`: a spread of counts from 1 to 40. Never 0: a zero
 * count writes no movement, so it could not be told apart from "never counted" on a re-run.
 */
export const demoStockFor = (index: number) => ((index * 7) % 40) + 1;

export interface StockSeedResult {
  /** Seed products given their demo stock by this run. */
  readonly stocked: number;
  /** Seed CNKs left alone: stock already moved, or not the seed's own product. */
  readonly skipped: number;
}

/**
 * Gives the seed products their demo stock, through one CSV import (`inventory.stock.import`, so it
 * is audited like a pharmacist's upload). Only a seed product whose stock never moved is stocked:
 * running it again, or after staff counted or adjusted stock, changes nothing. A product on a seed
 * CNK that is not the seed's (another Dutch name) is never touched.
 */
export async function seedSyntheticStock(actor: Actor = SEED_ACTOR): Promise<StockSeedResult> {
  const lines: string[] = [];
  let skipped = 0;
  for (const [index, seed] of PRODUCTS.entries()) {
    const cnk = cnkFor(index);
    const [item] = (await listStock({ q: cnk, pageSize: 1 }, actor)).items;
    if (!item || item.cnk !== cnk || item.nameNl !== seed.names.nl || item.lastMovementAt) {
      skipped++;
      continue;
    }
    lines.push(`${cnk};${demoStockFor(index)}`);
  }
  if (lines.length === 0) return { stocked: 0, skipped };
  await importStock({ csv: `cnk;quantity\n${lines.join("\n")}\n` }, actor);
  return { stocked: lines.length, skipped };
}
