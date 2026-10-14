// Test helpers for the Better Auth flows (never imported by production code): a "browser" that keeps
// cookies and sends the Origin Better Auth checks, TOTP codes, and a SOFTWARE PASSKEY that performs
// the real WebAuthn authentication ceremony (ES256, user verification on), so tests can go through
// `/passkey/verify-authentication` instead of editing session rows by hand (igs-pharma#100).
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";

import type { IsolatedDatabase } from "@igs/db/testing";
import { identitySchema } from "@igs/module-identity";
import { eq } from "drizzle-orm";

import type { createAuth } from "@igs/auth";

const { sessions, passkeys } = identitySchema;

export const BASE_URL = "http://localhost:3001";

export type TestAuth = ReturnType<typeof createAuth>;

/** A browser: keeps the cookies Better Auth sets, sends them back, and the Origin it checks. */
export function createBrowser(auth: TestAuth, iso: IsolatedDatabase) {
  const jar = new Map<string, string>();
  return {
    jar,
    async call(path: string, body?: unknown) {
      const response = await auth.handler(
        new Request(`${BASE_URL}/api/auth${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            origin: BASE_URL,
            "content-type": "application/json",
            cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
      for (const header of response.headers.getSetCookie()) {
        const [pair] = header.split(";");
        const [name, ...value] = (pair ?? "").split("=");
        if (!name) continue;
        if (/max-age=0/i.test(header)) jar.delete(name);
        else jar.set(name, value.join("="));
      }
      const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      return { status: response.status, json };
    },
    /** The current session row (by the token in the cookie). */
    async session() {
      const raw = jar.get("better-auth.session_token");
      const token = raw ? decodeURIComponent(raw).split(".")[0] : undefined;
      if (!token) return undefined;
      const [row] = await iso.db.select().from(sessions).where(eq(sessions.token, token));
      return row;
    },
  };
}

export type TestBrowser = ReturnType<typeof createBrowser>;

// ── TOTP ─────────────────────────────────────────────────────────────────────────────────────────

const base32Decode = (input: string) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of input.replace(/=+$/, ""))
    bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes).toString("utf8");
};

/** The current TOTP code for an `otpauth://` URI. */
export async function totpCodeFor(auth: TestAuth, totpURI: string) {
  const secret = base32Decode(new URL(totpURI).searchParams.get("secret") ?? "");
  const { code } = await auth.api.generateTOTP({ body: { secret } });
  return code;
}

// ── a software passkey ───────────────────────────────────────────────────────────────────────────

const b64url = (data: Buffer | Uint8Array) => Buffer.from(data).toString("base64url");

/** The COSE_Key (RFC 8152) of an ES256 public key: a CBOR map of five small entries. */
function coseKey(x: Buffer, y: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    x,
    Buffer.from([0x22, 0x58, 0x20]),
    y,
  ]);
}

/**
 * A passkey that lives in the test: an ES256 key pair registered for a user (a `passkey` row) that
 * can answer an authentication challenge the way an authenticator does (user presence and user
 * verification set, a rising signature counter). `signIn` runs the real two calls of the ceremony.
 */
export class SoftwarePasskey {
  readonly credentialId = b64url(randomBytes(32));
  private readonly privateKey: ReturnType<typeof createPrivateKey>;
  private readonly cose: Buffer;
  private counter = 0;

  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = createPrivateKey(privateKey.export({ type: "pkcs8", format: "pem" }));
    const jwk = createPublicKey(publicKey.export({ type: "spki", format: "pem" })).export({
      format: "jwk",
    });
    this.cose = coseKey(
      Buffer.from(jwk.x ?? "", "base64url"),
      Buffer.from(jwk.y ?? "", "base64url"),
    );
  }

  /** Stores the passkey for `userId`, as a finished registration would. */
  async register(iso: IsolatedDatabase, userId: string): Promise<void> {
    await iso.db.insert(passkeys).values({
      userId,
      publicKey: this.cose.toString("base64"),
      credentialID: this.credentialId,
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
    });
  }

  /**
   * The authentication ceremony against `browser`: asks for options (a challenge), signs it, and
   * posts the assertion to `/passkey/verify-authentication`. Returns that call's answer.
   */
  async signIn(browser: TestBrowser, options: { userVerified?: boolean } = {}) {
    const challengeAnswer = await browser.call("/passkey/generate-authenticate-options");
    const challenge = String(challengeAnswer.json?.["challenge"] ?? "");
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: "webauthn.get",
        challenge,
        origin: BASE_URL,
        crossOrigin: false,
      }),
    );
    this.counter += 1;
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.counter);
    const flags = options.userVerified === false ? 0x01 : 0x05; // user present (+ user verified)
    const authenticatorData = Buffer.concat([
      createHash("sha256").update(new URL(BASE_URL).hostname).digest(),
      Buffer.from([flags]),
      counter,
    ]);
    const signature = sign(
      "sha256",
      Buffer.concat([authenticatorData, createHash("sha256").update(clientDataJSON).digest()]),
      { key: this.privateKey, dsaEncoding: "der" },
    );
    return browser.call("/passkey/verify-authentication", {
      response: {
        id: this.credentialId,
        rawId: this.credentialId,
        type: "public-key",
        authenticatorAttachment: "platform",
        clientExtensionResults: {},
        response: {
          authenticatorData: b64url(authenticatorData),
          clientDataJSON: b64url(clientDataJSON),
          signature: b64url(signature),
        },
      },
    });
  }
}
