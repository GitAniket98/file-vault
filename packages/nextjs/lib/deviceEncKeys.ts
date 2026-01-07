// packages/nextjs/lib/deviceEncKeys.ts

/**
 * @module deviceEncKeys
 * @description
 * Manages the "Device Identity" keypair used for the Hybrid Encryption scheme.
 *
 * Architecture:
 * - Each device (browser profile) generates its own ephemeral ECDH P-256 keypair.
 * - The Private Key is stored in IndexedDB (persistent client-side storage).
 * - The Public Key is registered on-chain (or in DB) allowing others to "wrap" file keys for this device.
 *
 * Security Model:
 * - "Trust On First Use" (TOFU) for the device.
 * - Non-Custodial: The private key never leaves the client (except for explicit user backups).
 */
import { get, set } from "idb-keyval";

const DEVICE_ENC_KEY_STORE = "fv.ecdh.p256.v1";

export type DeviceEncKeyRecord = {
  pubJwk: JsonWebKey;
  privJwk: JsonWebKey;
};

/**
 * Guard: Ensures cryptographic operations run only in a Secure Context (HTTPS/Localhost).
 * WebCrypto API is unavailable in insecure contexts.
 */
function assertBrowser() {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    throw new Error("DeviceEncKeyRecord can only be used in the browser");
  }
}

/**
 * Retrieves the existing device keypair or performs "Lazy Initialization" to generate a new one.
 *
 * @security
 * - Curve: P-256 (NIST). Chosen for broad WebCrypto compatibility.
 * - Extraction: `extractable: true`.
 * - Trade-off: Required for the "Backup & Restore" feature.
 * - Risk: If XSS occurs, the attacker can export the private key.
 * - Mitigation: Content Security Policy (CSP) must be strict.
 */
export async function ensureDeviceEncKeyPair(): Promise<DeviceEncKeyRecord> {
  assertBrowser();

  // 1. Check Cache (IndexedDB)
  const existing = await get<DeviceEncKeyRecord | undefined>(DEVICE_ENC_KEY_STORE);
  if (existing?.pubJwk && existing?.privJwk) {
    return existing;
  }

  // 2. Generate New Keypair (if missing)
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true, // Must be true to allow export for IndexedDB storage + Backup
    ["deriveKey"], // Usage: We only use this to derive AES-GCM wrapping keys
  );

  // 3. Export to JWK for Storage
  const pubJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const privJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

  const record: DeviceEncKeyRecord = { pubJwk, privJwk };

  // 4. Persist
  await set(DEVICE_ENC_KEY_STORE, record);

  return record;
}

/**
 * Exports the keypair for "Device Migration" scenarios.
 * Returns null if the device has not been initialized yet.
 */
export async function exportDeviceEncKeyRecord(): Promise<DeviceEncKeyRecord | null> {
  assertBrowser();
  const existing = await get<DeviceEncKeyRecord | undefined>(DEVICE_ENC_KEY_STORE);
  return existing ?? null;
}

/**
 * Restores a device identity from a backup file.
 *
 * @security
 * - Validation: Strictly checks Key Type (kty) and Curve (crv) to prevent
 * "Key Confusion" attacks (e.g. forcing the app to use a weak curve).
 */
export async function importDeviceEncKeyRecord(record: DeviceEncKeyRecord): Promise<void> {
  assertBrowser();

  if (!record || typeof record !== "object") {
    throw new Error("Invalid device key backup (not an object)");
  }

  if (!record.pubJwk || !record.privJwk) {
    throw new Error("Invalid device key backup (missing pubJwk or privJwk)");
  }

  // Stricter JWK Validation
  const isValidKey = (jwk: JsonWebKey) => jwk.kty === "EC" && jwk.crv === "P-256";

  if (!isValidKey(record.pubJwk) || !isValidKey(record.privJwk)) {
    throw new Error("Security Violation: Imported keys must be EC P-256");
  }

  // Overwrite existing identity
  await set(DEVICE_ENC_KEY_STORE, {
    pubJwk: record.pubJwk,
    privJwk: record.privJwk,
  });
}
