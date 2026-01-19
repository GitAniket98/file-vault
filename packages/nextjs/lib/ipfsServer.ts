import dns from "node:dns";
import "server-only";

try {
  if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder("ipv4first");
  }
} catch {
  // Ignore
}

const PINATA_UNPIN_ENDPOINT = "https://api.pinata.cloud/pinning/unpin";
const MAX_RETRIES = 3;
const INITIAL_TIMEOUT_MS = 10000; // Increased to 10s

/**
 * Helper: Sleep for a given duration
 */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function pinataUnpinCid(cid: string | null | undefined): Promise<void> {
  const targetCid = cid?.trim();
  if (!targetCid) return;

  const rawJwt = process.env.PINATA_JWT_SERVER || process.env.PINATA_JWT;
  const jwt = rawJwt ? rawJwt.trim() : "";

  if (!jwt) {
    console.warn("[ipfsServer] Skipped unpin: Missing PINATA_JWT.");
    return;
  }

  const url = `${PINATA_UNPIN_ENDPOINT}/${targetCid}`;
  let lastError: any = null;

  // 2. RETRY LOOP
  // We try up to MAX_RETRIES times before giving up.
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`[ipfsServer] Retry ${attempt}/${MAX_RETRIES} for ${targetCid}...`);
      }

      const controller = new AbortController();
      // Increase timeout slightly on each retry
      const timeoutMs = INITIAL_TIMEOUT_MS + attempt * 2000;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(url, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${jwt}` },
        signal: controller.signal,
        // 'duplex: half' can sometimes fix vague Node.js fetch hangs
        // @ts-ignore - Typescript might complain on older lib versions, but it's valid valid in Node 18+
        duplex: "half",
      });

      clearTimeout(timeoutId);

      // Handle Success
      if (res.ok) {
        console.log(`[ipfsServer] ✅ Unpinned ${targetCid}`);
        return; // Exit function on success
      }

      // Handle 404 (Success)
      if (res.status === 404) {
        return;
      }

      // Handle other API errors (don't retry 401/403 as those are config errors)
      if (res.status === 401 || res.status === 403) {
        console.error(`[ipfsServer] Auth Error (${res.status}). Check JWT.`);
        return;
      }

      // If 5xx error, we throw to trigger a retry
      if (res.status >= 500) {
        throw new Error(`Server Error ${res.status}`);
      }

      const text = await res.text().catch(() => "");
      console.warn(`[ipfsServer] Unpin warning: ${res.status} - ${text}`);
      return; // Don't retry client errors (400s)
    } catch (e: any) {
      lastError = e;

      // Only retry on network errors or timeouts
      if (attempt < MAX_RETRIES) {
        // Wait 1s, 2s, 3s... (Exponential Backoff)
        await delay(1000 * attempt);
      }
    }
  }

  // 3. FINAL FAILURE LOG
  // If we exhaust all retries, we log it but do NOT crash the app.
  console.error(
    `[ipfsServer] Failed to unpin ${targetCid} after ${MAX_RETRIES} attempts. Last error:`,
    lastError?.message || lastError,
  );
}
