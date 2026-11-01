import { isDomainError } from "@igs/kernel";
import { getShipmentLabel } from "@igs/module-orders";

import { requireStaffActor } from "../../../../server/actor";
import { ensureKernelConfigured } from "../../../../server/kernel";
import { sendcloudClient } from "../../../../server/shipping";

/**
 * The parcel label of a packed delivery order, as a PDF (igs-pharma#202). Staff who may move orders
 * (`orders.order.manage`, checked by the query) get it straight from Sendcloud; nothing is stored.
 * `?format=a6` for a label printer, A4 otherwise. The label carries the customer's address: never
 * cached.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const refuse = (status: number, message: string) =>
  new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const { id } = await params;
  if (!UUID.test(id)) return refuse(404, "No such order.");
  let label: { parcelId: string; reference: string };
  try {
    label = await getShipmentLabel({ orderId: id }, actor);
  } catch (error) {
    if (!isDomainError(error)) throw error;
    if (error.code === "kernel.forbidden") return refuse(403, "You can't print this label.");
    return refuse(409, "This order has no label to print yet.");
  }
  const client = sendcloudClient();
  if (!client) return refuse(503, "Sendcloud is not set up.");
  const format = new URL(request.url).searchParams.get("format") === "a6" ? "a6" : "a4";
  let pdf: Uint8Array;
  try {
    pdf = await client.getLabelPdf(label.parcelId, format);
  } catch {
    // the status and code only: Sendcloud's body can echo the address
    return refuse(502, "Sendcloud didn't return the label. Try again in a minute.");
  }
  return new Response(new Blob([pdf], { type: "application/pdf" }), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="label-${label.reference}.pdf"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
