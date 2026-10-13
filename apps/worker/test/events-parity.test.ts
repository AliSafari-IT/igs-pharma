// The worker and the migrate entry must register the same events (igs-pharma#66): the migrate entry
// creates one pg-boss queue per topic, and the relay refuses to publish to a topic without one.
import fs from "node:fs";

import { ensureKernelQueues } from "@igs/kernel";
import { resetKernelForTests } from "@igs/kernel/testing";
import { describe, expect, it } from "vitest";

import { registerWorkerEvents } from "../src/events";

const source = (name: string) =>
  fs.readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");

describe("event registration is shared", () => {
  it("both entries call registerWorkerEvents()", () => {
    for (const entry of ["index.ts", "migrate.ts"]) {
      expect(source(entry), entry).toMatch(/registerWorkerEvents\(\)/);
    }
  });

  it("registers idempotently, and the migrate step creates a queue for each topic", async () => {
    resetKernelForTests();
    registerWorkerEvents();
    registerWorkerEvents();
    const created: string[] = [];
    await ensureKernelQueues({ createQueue: async (name) => void created.push(name) });
    expect(created[0]).toBe("kernel.maintenance.purge");
  });
});
