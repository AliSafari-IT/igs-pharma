import { describe, expect, it } from "vitest";

import { buildDbSsl, dbSslWarning } from "./db-ssl";

const PEM = "-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----";
const read = (files: Record<string, string>) => (path: string) => {
  const content = files[path];
  if (content === undefined) throw new Error("ENOENT");
  return content;
};

describe("buildDbSsl (igs-pharma#77)", () => {
  const cases: [string, Parameters<typeof buildDbSsl>[0], ReturnType<typeof buildDbSsl>][] = [
    [
      "production, nothing set: verified",
      { NODE_ENV: "production" },
      { mode: "verify", options: { rejectUnauthorized: true } },
    ],
    [
      "production, verify",
      { NODE_ENV: "production", DATABASE_SSL: "verify" },
      { mode: "verify", options: { rejectUnauthorized: true } },
    ],
    [
      "production, CA as PEM",
      { NODE_ENV: "production", DATABASE_SSL_CA: PEM },
      { mode: "verify", options: { rejectUnauthorized: true, ca: PEM } },
    ],
    [
      "production, CA as PEM with escaped newlines",
      { NODE_ENV: "production", DATABASE_SSL_CA: PEM.replaceAll("\n", "\\n") },
      { mode: "verify", options: { rejectUnauthorized: true, ca: PEM } },
    ],
    [
      "production, CA as a file path",
      { NODE_ENV: "production", DATABASE_SSL_CA: "/run/secrets/db-ca.pem" },
      { mode: "verify", options: { rejectUnauthorized: true, ca: PEM } },
    ],
    [
      "production, explicit insecure-dev",
      { NODE_ENV: "production", DATABASE_SSL: "insecure-dev" },
      { mode: "insecure-dev", options: { rejectUnauthorized: false } },
    ],
    [
      "development, nothing set: plain",
      { NODE_ENV: "development" },
      { mode: "off", options: false },
    ],
    ["NODE_ENV unset: plain", {}, { mode: "off", options: false }],
    ["test, off", { NODE_ENV: "test", DATABASE_SSL: "off" }, { mode: "off", options: false }],
    [
      "development, verify",
      { NODE_ENV: "development", DATABASE_SSL: "verify" },
      { mode: "verify", options: { rejectUnauthorized: true } },
    ],
    [
      "development, insecure-dev",
      { NODE_ENV: "development", DATABASE_SSL: "insecure-dev" },
      { mode: "insecure-dev", options: { rejectUnauthorized: false } },
    ],
    [
      "a CA is ignored when nothing is verified",
      { NODE_ENV: "development", DATABASE_SSL: "insecure-dev", DATABASE_SSL_CA: "/nope" },
      { mode: "insecure-dev", options: { rejectUnauthorized: false } },
    ],
  ];
  for (const [name, input, expected] of cases) {
    it(name, () => {
      expect(buildDbSsl(input, read({ "/run/secrets/db-ca.pem": PEM }))).toEqual(expected);
    });
  }

  it("production refuses DATABASE_SSL=off", () => {
    expect(() => buildDbSsl({ NODE_ENV: "production", DATABASE_SSL: "off" })).toThrow(
      /not allowed in production/,
    );
  });

  it("a CA setting that is unusable fails with a readable message that never contains the value", () => {
    const secret = "/very/secret/path/ca.pem";
    expect(() => buildDbSsl({ NODE_ENV: "production", DATABASE_SSL_CA: secret }, read({}))).toThrow(
      /neither PEM text nor a readable file path/,
    );
    try {
      buildDbSsl({ NODE_ENV: "production", DATABASE_SSL_CA: secret }, read({}));
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
    const junk = "-----BEGIN PRIVATE KEY-----\nTOPSECRET\n-----END PRIVATE KEY-----";
    try {
      buildDbSsl({ NODE_ENV: "production", DATABASE_SSL_CA: junk });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toMatch(/does not contain a PEM certificate/);
      expect(String(error)).not.toContain("TOPSECRET");
    }
    expect(() =>
      buildDbSsl(
        { NODE_ENV: "production", DATABASE_SSL_CA: "/etc/x.pem" },
        read({ "/etc/x.pem": "not a cert" }),
      ),
    ).toThrow(/does not contain a PEM certificate/);
  });

  it("warns only for insecure-dev in production", () => {
    const warn = (input: Parameters<typeof buildDbSsl>[0]) =>
      dbSslWarning(input, buildDbSsl(input));
    expect(warn({ NODE_ENV: "production", DATABASE_SSL: "insecure-dev" })).toMatch(/NOT verified/);
    expect(warn({ NODE_ENV: "production" })).toBeNull();
    expect(warn({ NODE_ENV: "development", DATABASE_SSL: "insecure-dev" })).toBeNull();
  });
});
