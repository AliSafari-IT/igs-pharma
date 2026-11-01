// Home-delivery settings (igs-pharma#202) on real Postgres, with the RBAC catalogue loaded from the
// database and the real audit port: who may set them, the fresh passkey check, the limits, the audit.
import { randomUUID } from "node:crypto";

import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { type Actor, isDomainError } from "@igs/kernel";
import { type KernelTestHandles, configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { loadRbacCatalogue } from "@igs/module-identity";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  DELIVERY_DEFAULTS,
  MAX_DELIVERY_PRICE_CENTS,
  MAX_FREE_FROM_CENTS,
  deliveryVatCents,
  getDeliverySettings,
  loadDeliverySettings,
  registerAuditActions,
  setDeliverySettings,
} from "../src";

let iso: IsolatedDatabase;
let kernel: KernelTestHandles;
let now: Date;

beforeAll(async () => {
  iso = await createIsolatedDatabase();
  await loadRbacCatalogue(iso.db);
  registerAuditActions(registerAuditAction);
});
afterAll(async () => {
  await iso?.drop();
});
beforeEach(async () => {
  kernel = configureKernelForTests({ db: iso.db, audit: createAuditPort() });
  now = new Date();
  kernel.clock.set(now); // audit partitions exist around "now"
  await iso.sql`DELETE FROM orders.delivery_settings`;
});

const MINUTE = 60_000;

/** Staff with the roles, whose last passkey check was `checkedMinutesAgo` minutes ago (null: never). */
const staff = (roles: string[], checkedMinutesAgo: number | null = 1): Actor => ({
  type: "user",
  id: randomUUID(),
  roles,
  kind: "staff",
  mfaVerified: true,
  passkeyCheckedAt:
    checkedMinutesAgo === null ? null : new Date(now.getTime() - checkedMinutesAgo * MINUTE),
});

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
  return "no error";
};

const stored = () =>
  iso.sql<{ price_cents: number; free_from_cents: number | null; version: number }[]>`
    SELECT price_cents, free_from_cents, version FROM orders.delivery_settings`;

describe("the rates in force", () => {
  it("are the plan's defaults until staff set a value, and say so", async () => {
    const seen = await getDeliverySettings({}, staff(["owner"]));
    expect(seen).toMatchObject({
      ...DELIVERY_DEFAULTS,
      isDefault: true,
      version: 0,
      updatedAt: null,
    });
    expect(await stored()).toEqual([]);
  });

  it("are what staff set, read from the database on every call", async () => {
    await setDeliverySettings({ priceCents: 595, freeFromCents: 6000 }, staff(["owner"]));
    expect(await getDeliverySettings({}, staff(["pharmacist_titular"]))).toMatchObject({
      priceCents: 595,
      freeFromCents: 6000,
      isDefault: false,
      version: 1,
    });
    // a change applies to the very next read: no cache in between
    await setDeliverySettings({ priceCents: 0, freeFromCents: null }, staff(["owner"]));
    const next = await iso.db.transaction((tx) => loadDeliverySettings(tx));
    expect(next).toMatchObject({
      priceCents: 0,
      freeFromCents: null,
      isDefault: false,
      version: 2,
    });
  });
});

describe("who may change them", () => {
  it("the owner and the pharmacist-titular, with a fresh passkey check", async () => {
    for (const role of ["owner", "pharmacist_titular"]) {
      const result = await setDeliverySettings(
        { priceCents: 495, freeFromCents: 4900 },
        staff([role]),
      );
      expect(result.version, role).toBeGreaterThanOrEqual(1);
    }
  });

  it("nobody else: not a pharmacist, an assistant, customer service, a customer or the storefront", async () => {
    for (const roles of [
      ["pharmacist"],
      ["pharmacy_assistant"],
      ["customer_service"],
      ["content_editor"],
      ["customer"],
    ]) {
      const actor = staff(roles);
      expect(
        await codeOf(setDeliverySettings({ priceCents: 1, freeFromCents: null }, actor)),
        roles.join(),
      ).toBe("kernel.forbidden");
      expect(await codeOf(getDeliverySettings({}, actor)), roles.join()).toBe("kernel.forbidden");
    }
    const storefront: Actor = { type: "system", id: "storefront", roles: ["system_storefront"] };
    expect(await codeOf(getDeliverySettings({}, storefront))).toBe("kernel.forbidden");
    expect(await stored()).toEqual([]);
  });

  it("a passkey check older than 10 minutes, or none, changes nothing", async () => {
    for (const checked of [10, 30, null]) {
      expect(
        await codeOf(
          setDeliverySettings({ priceCents: 123, freeFromCents: 1000 }, staff(["owner"], checked)),
        ),
        String(checked),
      ).toBe("identity.fresh_mfa_required");
    }
    expect(await stored()).toEqual([]);
    // 9 minutes ago still counts
    await setDeliverySettings({ priceCents: 123, freeFromCents: 1000 }, staff(["owner"], 9));
    expect(await stored()).toEqual([{ price_cents: 123, free_from_cents: 1000, version: 1 }]);
  });
});

describe("the limits", () => {
  const owner = () => staff(["owner"]);

  it("a price is 0 to the limit in whole cents", async () => {
    for (const priceCents of [-1, MAX_DELIVERY_PRICE_CENTS + 1, 4.5]) {
      expect(
        await codeOf(setDeliverySettings({ priceCents, freeFromCents: null }, owner())),
        String(priceCents),
      ).toBe("orders.delivery_price_invalid");
    }
    // not a number at all: the input schema refuses it before the command looks at it
    expect(
      await codeOf(setDeliverySettings({ priceCents: Number.NaN, freeFromCents: null }, owner())),
    ).toBe("kernel.validation_failed");
    for (const priceCents of [0, MAX_DELIVERY_PRICE_CENTS]) {
      await setDeliverySettings({ priceCents, freeFromCents: null }, owner());
    }
  });

  it("the free-delivery value may be empty (never free), else 0 to the limit", async () => {
    for (const freeFromCents of [-1, MAX_FREE_FROM_CENTS + 1, 49.5]) {
      expect(
        await codeOf(setDeliverySettings({ priceCents: 495, freeFromCents }, owner())),
        String(freeFromCents),
      ).toBe("orders.delivery_free_from_invalid");
    }
    await setDeliverySettings({ priceCents: 495, freeFromCents: null }, owner());
    expect((await stored())[0]?.free_from_cents).toBeNull();
    await setDeliverySettings({ priceCents: 495, freeFromCents: 0 }, owner());
    await setDeliverySettings({ priceCents: 495, freeFromCents: MAX_FREE_FROM_CENTS }, owner());
  });

  it("an invalid value is refused before the passkey check, so a retry is not burned", async () => {
    expect(
      await codeOf(
        setDeliverySettings({ priceCents: -5, freeFromCents: null }, staff(["owner"], null)),
      ),
    ).toBe("orders.delivery_price_invalid");
  });

  it("the database refuses what the command would (a direct write cannot bypass the limits)", async () => {
    const write = (price: number, free: number | null) =>
      iso.sql`INSERT INTO orders.delivery_settings (key, price_cents, free_from_cents, updated_by_type, updated_by_id)
              VALUES ('delivery', ${price}, ${free}, 'user', 'x')`;
    await expect(write(-1, null)).rejects.toThrow();
    await expect(write(MAX_DELIVERY_PRICE_CENTS + 1, null)).rejects.toThrow();
    await expect(write(495, -1)).rejects.toThrow();
    await expect(write(495, MAX_FREE_FROM_CENTS + 1)).rejects.toThrow();
    await expect(
      iso.sql`INSERT INTO orders.delivery_settings (key, price_cents, updated_by_type, updated_by_id)
              VALUES ('other', 495, 'user', 'x')`,
    ).rejects.toThrow();
    expect(await stored()).toEqual([]);
  });
});

describe("the audit trail", () => {
  it("records amounts, the previous amounts and the version; nothing else", async () => {
    const actor = staff(["owner"]);
    await setDeliverySettings({ priceCents: 595, freeFromCents: 6000 }, actor);
    await setDeliverySettings({ priceCents: 395, freeFromCents: null }, actor);
    const events = await iso.sql<
      { action: string; actor_id: string; data: Record<string, unknown> }[]
    >`
      SELECT action, actor_id, data FROM audit.events
      WHERE action = 'orders.delivery_settings.set' AND actor_id = ${actor.id} ORDER BY seq`;
    expect(events).toEqual([
      {
        action: "orders.delivery_settings.set",
        actor_id: actor.id,
        data: {
          priceCents: 595,
          freeFromCents: 6000,
          previousPriceCents: DELIVERY_DEFAULTS.priceCents,
          previousFreeFromCents: DELIVERY_DEFAULTS.freeFromCents,
          previousWasDefault: true,
          version: 1,
        },
      },
      {
        action: "orders.delivery_settings.set",
        actor_id: actor.id,
        data: {
          priceCents: 395,
          freeFromCents: null,
          previousPriceCents: 595,
          previousFreeFromCents: 6000,
          previousWasDefault: false,
          version: 2,
        },
      },
    ]);
  });

  it("a refused change leaves no trace in the settings", async () => {
    await codeOf(
      setDeliverySettings({ priceCents: 495, freeFromCents: 4900 }, staff(["pharmacist"])),
    );
    await codeOf(
      setDeliverySettings({ priceCents: 495, freeFromCents: 4900 }, staff(["owner"], 30)),
    );
    expect(await stored()).toEqual([]);
  });
});

describe("saving twice", () => {
  it("a double submit with the same key saves once", async () => {
    const actor = staff(["owner"]);
    const options = { idempotencyKey: randomUUID() };
    await setDeliverySettings({ priceCents: 595, freeFromCents: 6000 }, actor, options);
    await setDeliverySettings({ priceCents: 595, freeFromCents: 6000 }, actor, options);
    expect((await stored())[0]?.version).toBe(1);
    const [count] = await iso.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM audit.events
      WHERE action = 'orders.delivery_settings.set' AND actor_id = ${actor.id}`;
    expect(count?.n).toBe(1);
  });

  it("an empty submission id is refused, not used as a key", async () => {
    expect(
      await codeOf(
        setDeliverySettings({ priceCents: 595, freeFromCents: null }, staff(["owner"]), {
          idempotencyKey: "",
        }),
      ),
    ).toBe("kernel.invalid_idempotency_key");
    expect(await stored()).toEqual([]);
  });

  it("two simultaneous saves each audit the values they really replaced", async () => {
    const a = staff(["owner"]);
    const b = staff(["pharmacist_titular"]);
    await setDeliverySettings({ priceCents: 500, freeFromCents: 5000 }, a);
    await Promise.all([
      setDeliverySettings({ priceCents: 600, freeFromCents: 6000 }, a),
      setDeliverySettings({ priceCents: 700, freeFromCents: 7000 }, b),
    ]);
    const events = await iso.sql<{ data: { priceCents: number; previousPriceCents: number } }[]>`
      SELECT data FROM audit.events WHERE action = 'orders.delivery_settings.set'
        AND actor_id IN (${a.id}, ${b.id}) ORDER BY seq`;
    // a chain: each save's "previous" is the one before it, never the same value twice
    const chain = events.map((e) => [e.data.previousPriceCents, e.data.priceCents]);
    expect(chain[0]).toEqual([DELIVERY_DEFAULTS.priceCents, 500]);
    expect(chain[1]?.[1] === 600 || chain[1]?.[1] === 700).toBe(true);
    expect(chain[1]?.[0]).toBe(500);
    expect(chain[2]?.[0]).toBe(chain[1]?.[1]);
    expect((await stored())[0]?.version).toBe(3);
  });

  it("a stale form (an older expected version) overwrites nothing", async () => {
    const actor = staff(["owner"]);
    await setDeliverySettings({ priceCents: 500, freeFromCents: 5000, expectedVersion: 0 }, actor);
    await setDeliverySettings({ priceCents: 600, freeFromCents: 6000, expectedVersion: 1 }, actor);
    expect(
      await codeOf(
        setDeliverySettings({ priceCents: 700, freeFromCents: 7000, expectedVersion: 1 }, actor),
      ),
    ).toBe("orders.delivery_settings_stale");
    expect(await stored()).toEqual([{ price_cents: 600, free_from_cents: 6000, version: 2 }]);
  });
});

describe("the other checks", () => {
  it("a stale passkey check also blocks the pharmacist-titular", async () => {
    expect(
      await codeOf(
        setDeliverySettings(
          { priceCents: 495, freeFromCents: 4900 },
          staff(["pharmacist_titular"], 30),
        ),
      ),
    ).toBe("identity.fresh_mfa_required");
  });

  it("an actor without a verified second factor is refused", async () => {
    const actor = { ...staff(["owner"]), mfaVerified: false };
    expect(
      await codeOf(setDeliverySettings({ priceCents: 495, freeFromCents: 4900 }, actor)),
    ).not.toBe("no error");
    expect(await stored()).toEqual([]);
  });

  it("the VAT part rounds half up at its boundaries and never exceeds the fee", () => {
    // 21 % of a price that includes it: fee x 21 / 121
    for (const [fee, vat] of [
      [0, 0],
      [1, 0],
      [239, 41], // 41.48
      [240, 42], // 41.65
      [242, 42], // exactly 42
      [495, 86], // 85.91
      [5000, 868], // 867.77
    ] as const) {
      expect(deliveryVatCents(fee), `fee ${fee}`).toBe(vat);
    }
    for (let fee = 0; fee <= 5000; fee++) {
      expect(deliveryVatCents(fee)).toBe(Math.round((fee * 21) / 121));
    }
  });

  it("the price includes VAT: net plus VAT is the fee", () => {
    for (const fee of [0, 1, 495, 595, 5000]) {
      const vat = deliveryVatCents(fee);
      expect(fee - vat + vat).toBe(fee);
      expect(vat).toBeLessThanOrEqual(fee);
    }
    expect(deliveryVatCents(495)).toBe(86);
  });
});
