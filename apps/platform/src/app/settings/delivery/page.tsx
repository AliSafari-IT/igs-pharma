import { isDomainError } from "@igs/kernel";
import {
  DELIVERY_VAT_RATE_BP,
  type DeliverySettings,
  formatEuroAmount,
  getDeliverySettings,
} from "@igs/module-orders";
import { Alert, Container, Stack } from "@igs/ui";

import { deliveryErrorMessage } from "../../../components/delivery-labels";
import { DeliverySettingsForm } from "../../../components/delivery-settings-form";
import { PageHeader } from "../../../components/page-header";
import { formatMoment } from "../../../components/stock-labels";
import { requireStaffActor } from "../../../server/actor";
import { ensureKernelConfigured } from "../../../server/kernel";

export const metadata = { title: "Delivery · IGS-Pharma Platform" };

/**
 * Delivery (igs-pharma#202): the price of home delivery by Sendcloud and the order value from which
 * it is free. Pickup at the pharmacy is always free. Only the owner and the pharmacist-titular see
 * and change it, and a change needs a fresh passkey check.
 */
export default async function DeliverySettingsPage() {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  let settings: DeliverySettings | null = null;
  let error: string | null = null;
  try {
    settings = await getDeliverySettings({}, actor);
  } catch (e) {
    if (!isDomainError(e)) throw e;
    error = e.code;
  }

  return (
    <Container asChild size="lg">
      <main className="py-10">
        <Stack gap={6}>
          <PageHeader
            title="Delivery"
            description="What home delivery costs and from which order value it is free. Collecting the order at the pharmacy is always free."
          />
          {error || !settings ? (
            <Alert variant="error" title="You can't see the delivery settings">
              {deliveryErrorMessage(error ?? undefined)}
            </Alert>
          ) : (
            <>
              {settings.isDefault ? (
                <Alert variant="info" title="These are the default amounts">
                  <span data-testid="delivery-default-note">
                    Nobody has set the delivery amounts yet, so the shop uses these placeholders.
                    Save your own to replace them.
                  </span>
                </Alert>
              ) : (
                <p data-testid="delivery-updated">
                  Last changed {settings.updatedAt ? formatMoment(settings.updatedAt) : "never"}.
                </p>
              )}
              <p>
                Amounts include VAT. {DELIVERY_VAT_RATE_BP / 100} % is cut out of the delivery price
                for now; that rate is still to be confirmed with the accountant. A change applies to
                the next order; orders already placed keep what they were charged.
              </p>
              <DeliverySettingsForm
                version={settings.version}
                price={formatEuroAmount(settings.priceCents)}
                freeFrom={
                  settings.freeFromCents === null ? "" : formatEuroAmount(settings.freeFromCents)
                }
              />
            </>
          )}
        </Stack>
      </main>
    </Container>
  );
}
