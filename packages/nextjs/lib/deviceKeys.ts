// packages/nextjs/lib/deviceKeys.ts

/**
 * Persistent, device-only storage for per-file AES keys using IndexedDB.
 * * UPDATE: Keys are now namespaced by wallet address.
 * Format: `0xaddress_fv.deviceKey.0xfilehash`
 */
import { del, entries, get, set } from "idb-keyval";

export type LocalKeyRecord = {
  rawKeyHex: `0x${string}`;
  ivHex: `0x${string}`;
};

const KEY_BASE_PREFIX = "fv.deviceKey.";

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

// 🔑 Helper: Namespace keys by wallet address AND file hash
function keyFor(walletAddr: string, fileHashHex: `0x${string}`): string {
  if (!walletAddr) throw new Error("Wallet address required");
  // Format: 0xalice_fv.deviceKey.0xfilehash
  return `${walletAddr.toLowerCase()}_${KEY_BASE_PREFIX}${fileHashHex.toLowerCase()}`;
}

/**
 * Save file key for specific user
 */
export async function saveDeviceKey(
  walletAddr: string,
  fileHashHex: `0x${string}`,
  record: LocalKeyRecord,
): Promise<void> {
  if (!isBrowser()) return;
  await set(keyFor(walletAddr, fileHashHex), record);
}

/**
 * Load file key for specific user
 */
export async function loadDeviceKey(walletAddr: string, fileHashHex: `0x${string}`): Promise<LocalKeyRecord | null> {
  if (!isBrowser()) return null;
  const value = await get<LocalKeyRecord | undefined>(keyFor(walletAddr, fileHashHex));
  return value ?? null;
}

/**
 * Remove specific key
 */
export async function removeDeviceKey(walletAddr: string, fileHashHex: `0x${string}`): Promise<void> {
  if (!isBrowser()) return;
  await del(keyFor(walletAddr, fileHashHex));
}

/**
 * Get ALL file keys for a specific user (For Backup)
 * This scans the DB for keys starting with "0xAddress_fv.deviceKey..."
 */
export async function getAllKeysForUser(walletAddr: string): Promise<Record<string, LocalKeyRecord>> {
  if (!isBrowser()) return {};

  const allEntries = await entries();
  const prefix = `${walletAddr.toLowerCase()}_${KEY_BASE_PREFIX}`;
  const result: Record<string, LocalKeyRecord> = {};

  for (const [key, val] of allEntries) {
    if (typeof key === "string" && key.startsWith(prefix)) {
      // We store the FULL key (including prefix) in the backup so we know exactly where to restore it
      result[key] = val as LocalKeyRecord;
    }
  }
  return result;
}

/**
 * Import a bulk set of keys (For Restore)
 */
export async function importBulkKeys(keys: Record<string, any>) {
  if (!isBrowser()) return;

  // Just blindly set whatever is in the backup object.
  // Since the backup keys already contain the "0xaddr_..." prefix,
  // they will naturally fall into the correct slots.
  for (const [key, val] of Object.entries(keys)) {
    await set(key, val);
  }
}
