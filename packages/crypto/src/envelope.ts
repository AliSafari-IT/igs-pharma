/**
 * Phase 0 stub for envelope encryption.
 * Phase 1c: wire to cloud KMS (key wrapping) with local AES-256-GCM data keys.
 * For now: throws if called, to prevent accidental use before proper setup.
 */
export function encryptField(_plaintext: string): never {
  throw new Error(
    "Envelope encryption is not yet configured. Wire KMS_KEY_ID in Phase 1c.",
  );
}

export function decryptField(_ciphertext: string): never {
  throw new Error(
    "Envelope encryption is not yet configured. Wire KMS_KEY_ID in Phase 1c.",
  );
}
