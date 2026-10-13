// Verified TLS to a real Postgres (igs-pharma#77). The test server speaks plain Postgres, so a small
// TLS front is put in front of it: it answers the Postgres SSLRequest with 'S', terminates TLS with a
// self-signed certificate and pipes to the database. The client side is the real thing: `postgres`
// with the options `buildDbSsl()` builds.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";

import { buildDbSsl } from "@igs/config/db-ssl";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";

import type {} from "../src/testing/provided-context";

interface Pair {
  readonly key: string;
  readonly cert: string;
}

let dir: string;

/** A self-signed certificate (it is its own CA) valid for the given subjectAltName. */
function selfSigned(name: string, san: string): Pair {
  const key = path.join(dir, `${name}.key`);
  const cert = path.join(dir, `${name}.pem`);
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-subj",
      `/CN=${name}`,
      "-addext",
      `subjectAltName=${san}`,
    ],
    { stdio: "ignore" },
  );
  return { key: fs.readFileSync(key, "utf8"), cert: fs.readFileSync(cert, "utf8") };
}

/** A TLS front for the test Postgres on 127.0.0.1:<port>. */
function tlsFront(pair: Pair, upstream: { host: string; port: number }): Promise<net.Server> {
  const server = net.createServer((raw) => {
    raw.once("data", (first) => {
      const sslRequest = first.length === 8 && first.readInt32BE(4) === 80877103;
      if (!sslRequest) return void raw.destroy();
      raw.write("S");
      const secure = new tls.TLSSocket(raw, { isServer: true, key: pair.key, cert: pair.cert });
      const db = net.connect(upstream.port, upstream.host);
      secure.on("error", () => db.destroy());
      db.on("error", () => secure.destroy());
      secure.pipe(db).pipe(secure);
    });
    raw.on("error", () => {});
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const trusted = () => selfSigned("trusted", "IP:127.0.0.1,DNS:localhost");
let good: Pair;
let other: Pair;
let wrongName: Pair;
const fronts: net.Server[] = [];

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "igs-tls-"));
  good = trusted();
  other = selfSigned("other", "IP:127.0.0.1,DNS:localhost"); // same names, a different CA
  wrongName = selfSigned("wrongname", "DNS:db.other.example");
});

afterAll(() => {
  for (const server of fronts) server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function connectVia(server: Pair, ssl: ReturnType<typeof buildDbSsl>) {
  const admin = new URL(inject("igsTestAdminUrl"));
  const front = await tlsFront(server, { host: admin.hostname, port: Number(admin.port || 5432) });
  fronts.push(front);
  const sql = postgres({
    host: "127.0.0.1",
    port: (front.address() as net.AddressInfo).port,
    user: decodeURIComponent(admin.username),
    pass: decodeURIComponent(admin.password),
    database: admin.pathname.slice(1),
    ssl: ssl.options,
    max: 1,
    connect_timeout: 5,
    onnotice: () => {},
  });
  try {
    const [row] = await sql<{ encrypted: boolean }[]>`
      SELECT ssl AS encrypted FROM pg_stat_ssl WHERE pid = pg_backend_pid()`;
    return row;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return String((error as { code?: string; message?: string }).code ?? error);
  }
  return "connected";
};

describe("verified TLS to Postgres", () => {
  it("connects when the server certificate is signed by the CA in DATABASE_SSL_CA (PEM text)", async () => {
    const ssl = buildDbSsl({ NODE_ENV: "production", DATABASE_SSL_CA: good.cert });
    expect(await connectVia(good, ssl)).toBeDefined();
  });

  it("connects when DATABASE_SSL_CA is a file path", async () => {
    const file = path.join(dir, "ca.pem");
    fs.writeFileSync(file, good.cert);
    const ssl = buildDbSsl({ NODE_ENV: "production", DATABASE_SSL_CA: file });
    expect(await connectVia(good, ssl)).toBeDefined();
  });

  it("refuses a server certificate from a CA that is not trusted (wrong CA)", async () => {
    const ssl = buildDbSsl({ NODE_ENV: "production", DATABASE_SSL_CA: other.cert });
    expect(await refusal(connectVia(good, ssl))).toMatch(/SELF_SIGNED|UNABLE_TO_VERIFY|CERT/);
  });

  it("refuses a self-signed certificate when no CA is configured (system trust store only)", async () => {
    const ssl = buildDbSsl({ NODE_ENV: "production" });
    expect(await refusal(connectVia(good, ssl))).toMatch(/SELF_SIGNED|UNABLE_TO_VERIFY|CERT/);
  });

  it("refuses a trusted certificate that is for another host name", async () => {
    const ssl = buildDbSsl({ NODE_ENV: "production", DATABASE_SSL_CA: wrongName.cert });
    expect(await refusal(connectVia(wrongName, ssl))).toMatch(/ALTNAME|HOSTNAME|CERT/);
  });

  it("insecure-dev encrypts without verifying: even an untrusted certificate is accepted", async () => {
    const ssl = buildDbSsl({ NODE_ENV: "development", DATABASE_SSL: "insecure-dev" });
    expect(await connectVia(other, ssl)).toBeDefined();
  });
});
