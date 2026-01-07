// packages/nextjs/lib/ipfsServer.ts

/**
 * @module ipfsServer
 * @description
 * Server-side utilities for interacting with Pinata (IPFS).
 *
 * ⚠️ SECURITY NOTE:
 * This file must ONLY be imported by Server Components or API Routes.
 * It accesses `process.env.PINATA_JWT`, which is a secret key.
 * Importing this into a Client Component ("use client") will leak credentials to the browser bundle.
 */

const PINATA_UNPIN_ENDPOINT = "https://api.pinata.cloud/pinning/unpin";

/**
 * Best-effort attempt to unpin a CID from Pinata.
 *
 * Design Pattern: "Fire-and-Forget" / "Compensating Transaction"
 * - Used during rollback scenarios (e.g., DB write failed, so we undo the IPFS pin).
 * - Intentionally swallows all errors to ensure the parent request (user's response)
 * does not fail just because a cleanup task failed.
 * - Logs failures to stdout/stderr so they can be alerted on (e.g., via Datadog/Sentry).
 *
 * @param cid - The IPFS Content Identifier to remove. If null/empty, performs no-op.
 */
export async function pinataUnpinCid(cid: string | null | undefined): Promise<void> {
  const targetCid = cid?.trim();
  // Optimization: fast exit for empty inputs
  if (!targetCid) return;

  // Prioritize a dedicated server key if available, falling back to the general key.
  const jwt = process.env.PINATA_JWT_SERVER || process.env.PINATA_JWT;

  if (!jwt) {
    // Operational Alert: This indicates a misconfiguration in the deployment environment.
    console.warn("[ipfsServer] Skipped unpin: Missing PINATA_JWT environment variable.");
    return;
  }

  try {
    const res = await fetch(`${PINATA_UNPIN_ENDPOINT}/${encodeURIComponent(targetCid)}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    });

    if (!res.ok) {
      // We read the body to log the specific error from Pinata (e.g., "CID not found" vs "Unauthorized")
      const text = await res.text().catch(() => "No response body");
      console.warn(`[ipfsServer] Unpin warning for CID ${targetCid}: ${res.status} ${res.statusText} - ${text}`);
    }
  } catch (e: any) {
    // Catch network errors (DNS, timeout) so the main thread continues.
    console.error("[ipfsServer] Unpin network error:", e?.message || e);
  }
}
