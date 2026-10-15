import { isDomainError } from "@igs/kernel";
import {
  type BrandView,
  DEFAULT_EDITOR_VAT_CLASS,
  canManageRegulated,
  listBrands,
} from "@igs/module-catalog";
import { Alert, Container, Stack } from "@igs/ui";

import { catalogErrorMessage } from "../../../components/catalog-labels";
import { PageHeader } from "../../../components/page-header";
import { ProductForm } from "../../../components/product-form";
import { requireStaffActor } from "../../../server/actor";
import { ensureKernelConfigured } from "../../../server/kernel";

export const metadata = { title: "New product · IGS-Pharma Platform" };

/** Create a product (igs-pharma#50); it starts as a draft. */
export default async function NewProductPage() {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  let brands: readonly BrandView[] | null = null;
  let error: string | null = null;
  try {
    brands = await listBrands({}, actor);
  } catch (e) {
    if (!isDomainError(e)) throw e;
    error = e.code;
  }
  return (
    <Container asChild size="md">
      <main className="py-10">
        <Stack gap={6}>
          <PageHeader title="New product" back={{ href: "/products", label: "Back to products" }} />
          {brands ? (
            <ProductForm
              brands={brands}
              canRegulate={canManageRegulated(actor.roles)}
              editorVatClass={DEFAULT_EDITOR_VAT_CLASS}
            />
          ) : (
            <Alert variant="error" title="You can't see the catalogue">
              {catalogErrorMessage(error ?? undefined)}
            </Alert>
          )}
        </Stack>
      </main>
    </Container>
  );
}
