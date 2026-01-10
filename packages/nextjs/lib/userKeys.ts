// packages/nextjs/lib/userKeys.ts
// Manages a per-device "user secret" for FileVault user registration.
// For now this is a 32-byte random secret stored in IndexedDB,
// and the "public key" is SHA-256(secret) as hex (demo / placeholder).
//
// Later we can swap this to a real asymmetric keypair (e.g. X25519) without
// changing the external API.
import { get, set } from "idb-keyval";
import { bytesToHex } from "~~/lib/bytes";

const DEVICE_USER_SECRET_KEY = "fv.user.secret.v1";

export type DeviceUserSecretRecord = {
  /** 32-byte secret as hex (no 0x) */
  secretHex: string;
};

/** Are we in the browser context? */
function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

/** Generate a fresh 32-byte random secret. */
function generateRandomSecret(): Uint8Array {
  const u8 = new Uint8Array(32);
  crypto.getRandomValues(u8);
  return u8;
}

/** Convert Uint8Array to plain hex (no 0x). */
function toPlainHex(u8: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u8.length; i++) {
    s += u8[i].toString(16).padStart(2, "0");
  }
  return s;
}

/** Derive a "public" value from the secret using SHA-256(secret). */
export async function derivePublicFromSecretHex(secretHex: string): Promise<string> {
  const secretBytes = Uint8Array.from(secretHex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)));
  const digest = await crypto.subtle.digest("SHA-256", secretBytes);
  const pubU8 = new Uint8Array(digest);
  // use bytesToHex to get 0x-prefixed; we strip 0x here for DB
  const with0x = bytesToHex(pubU8);
  return with0x.slice(2); // drop 0x
}

/**
 * Ensure we have a per-device secret stored in IndexedDB.
 * Returns the secretHex (no 0x).
 */
export async function ensureDeviceUserSecret(): Promise<string> {
  if (!isBrowser()) {
    throw new Error("ensureDeviceUserSecret must run in the browser");
  }

  const existing = await get<DeviceUserSecretRecord | undefined>(DEVICE_USER_SECRET_KEY);
  if (existing?.secretHex) {
    return existing.secretHex;
  }

  const u8 = generateRandomSecret();
  const secretHex = toPlainHex(u8);

  await set(DEVICE_USER_SECRET_KEY, { secretHex });

  return secretHex;
}
