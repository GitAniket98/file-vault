// packages/nextjs/lib/deviceEncKeys.ts

/**
 * @module deviceEncKeys
 * @description
 * Manages the "Device Identity" keypair used for the Hybrid Encryption scheme.
 * * UPDATE: Keys are now namespaced by wallet address to support multi-account switching.
 * Format: `0xaddress_fv.ecdh.p256.v1`
 */
import { get, set } from "idb-keyval";

const DEVICE_ENC_KEY_SUFFIX = "fv.ecdh.p256.v1";

export type DeviceEncKeyRecord = {
  pubJwk: JsonWebKey;
  privJwk: JsonWebKey;
};

function assertBrowser() {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    throw new Error("DeviceEncKeyRecord can only be used in the browser");
  }
}

// 🔑 Helper: Namespace keys by wallet address
function getStorageKey(walletAddr: string) {
  if (!walletAddr) throw new Error("Wallet address required for key storage");
  return `${walletAddr.toLowerCase()}_${DEVICE_ENC_KEY_SUFFIX}`;
}

/**
 * Retrieves the existing device keypair for the SPECIFIC wallet address.
 * Or generates a new one if missing.
 */
export async function ensureDeviceEncKeyPair(walletAddr: string): Promise<DeviceEncKeyRecord> {
  assertBrowser();
  const storageKey = getStorageKey(walletAddr);

  // 1. Check Cache (IndexedDB)
  const existing = await get<DeviceEncKeyRecord | undefined>(storageKey);
  if (existing?.pubJwk && existing?.privJwk) {
    return existing;
  }

  // 2. Generate New Keypair (if missing)
  const keyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);

  // 3. Export to JWK
  const pubJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const privJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

  const record: DeviceEncKeyRecord = { pubJwk, privJwk };

  // 4. Persist Namespaced
  await set(storageKey, record);

  return record;
}

/**
 * Check if keys exist for this user (Used for UI state "Do I need to restore?")
 */
export async function hasKeyForUser(walletAddr: string): Promise<boolean> {
  assertBrowser();
  if (!walletAddr) return false;
  const storageKey = getStorageKey(walletAddr);
  const existing = await get(storageKey);
  return !!existing;
}

/**
 * Exports keypair for the current user.
 */
export async function exportDeviceEncKeyRecord(walletAddr: string): Promise<DeviceEncKeyRecord | null> {
  assertBrowser();
  const storageKey = getStorageKey(walletAddr);
  const existing = await get<DeviceEncKeyRecord | undefined>(storageKey);
  return existing ?? null;
}

/**
 * Restores identity from backup into the CURRENT user's slot.
 */
export async function importDeviceEncKeyRecord(walletAddr: string, record: DeviceEncKeyRecord): Promise<void> {
  assertBrowser();
  const storageKey = getStorageKey(walletAddr);

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

  // Save to Namespaced Slot
  await set(storageKey, {
    pubJwk: record.pubJwk,
    privJwk: record.privJwk,
  });
}
