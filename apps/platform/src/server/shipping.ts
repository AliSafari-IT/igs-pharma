import { parseEnvFor, shippingEnv } from "@igs/config/env";
import { type SendcloudClient, createSendcloudClient } from "@igs/shipping";

/**
 * Sendcloud for the back-office (igs-pharma#202, D-019): only the label route handler talks to it,
 * to stream a label PDF to staff. Labels themselves are made by the worker. Read per call, so a
 * missing key pair shows on the order page instead of failing the app at boot.
 */
export interface ShippingStatus {
  /** The key pair is set: labels can be fetched (and the worker can make them). */
  readonly configured: boolean;
}

function readEnv() {
  try {
    return parseEnvFor(shippingEnv);
  } catch {
    return null;
  }
}

export function shippingStatus(): ShippingStatus {
  const env = readEnv();
  return {
    configured: Boolean(
      env?.SENDCLOUD_PUBLIC_KEY && env.SENDCLOUD_SECRET_KEY && env.SENDCLOUD_SHIPPING_METHOD_ID,
    ),
  };
}

/** The Sendcloud client, or `null` without the key pair. */
export function sendcloudClient(): SendcloudClient | null {
  const env = readEnv();
  if (!env?.SENDCLOUD_PUBLIC_KEY || !env.SENDCLOUD_SECRET_KEY) return null;
  return createSendcloudClient(env.SENDCLOUD_PUBLIC_KEY, env.SENDCLOUD_SECRET_KEY);
}
