// packages/nextjs/utils/ipfs.ts

/**
 * @module ipfs
 * @description
 * Client-side helper to upload blobs to Pinata (IPFS).
 *
 * ⚠️ SECURITY WARNING:
 * For production apps, DO NOT set `NEXT_PUBLIC_PINATA_JWT`.
 * Exposing your upload token allows anyone to upload arbitrary files to your account.
 *
 * Recommended Pattern:
 * 1. Client sends file to your own Next.js API Route (/api/ipfs/proxy).
 * 2. API Route authenticates the user (SIWE).
 * 3. API Route proxies the stream to Pinata using a server-side secret.
 *
 * For this demo/hackathon context, client-side upload is permitted for simplicity,
 * but the warning below preserves "Industry Level" awareness.
 */

export type PinResult = { cid: string };

const PINATA_FILE_ENDPOINT = "https://api.pinata.cloud/pinning/pinFileToIPFS";
const MAX_BYTES = 5 * 1024 * 1024; // 5MB Hard Limit

/**
 * Resolves the authentication token with a priority fallback.
 */
function resolvePinataJwt(override?: string): string {
  // 1. Explicit override passed by caller
  if (override) return override;

  // 2. Browser Environment
  if (typeof window !== "undefined") {
    const jwt = process.env.NEXT_PUBLIC_PINATA_JWT;
    if (!jwt) {
      console.warn(
        "[ipfs] NEXT_PUBLIC_PINATA_JWT is missing. " +
          "Client-side uploads will fail unless you pass a token explicitly.",
      );
      // We don't throw here to allow UI to handle the error gracefully during the fetch call
      return "";
    }
    return jwt;
  }

  // 3. Server Environment
  const jwt = process.env.PINATA_JWT;
  if (!jwt) {
    throw new Error("Configuration Error: PINATA_JWT server var is missing.");
  }
  return jwt;
}

/**
 * Uploads a Blob (encrypted file) to Pinata.
 *
 * @param blob - The binary data to upload.
 * @param filename - Useful for Pinata's metadata explorer.
 * @param jwtOverride - Optional token (if using a temporary signed token).
 */
export async function pinBlobToIPFS(blob: Blob, filename = "enc.bin", jwtOverride?: string): Promise<PinResult> {
  // 1. Validation
  if (!blob || blob.size === 0) {
    throw new Error("Upload failed: File is empty.");
  }

  if (blob.size > MAX_BYTES) {
    throw new Error(`Upload failed: File exceeds the ${MAX_BYTES / 1024 / 1024}MB limit.`);
  }

  const jwt = resolvePinataJwt(jwtOverride);
  if (!jwt) {
    throw new Error("Missing IPFS configuration (JWT). Check your .env.local file.");
  }

  // 2. Prepare Payload
  const form = new FormData();
  form.append("file", blob, filename);

  // 3. Network Request
  try {
    const res = await fetch(PINATA_FILE_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
      body: form,
    });

    if (!res.ok) {
      // Parse error text if possible
      const text = await res.text().catch(() => "Unknown error");
      throw new Error(`Pinata API Error (${res.status}): ${text}`);
    }

    const json = await res.json();
    const cid = json.IpfsHash;

    if (!cid || typeof cid !== "string") {
      throw new Error("Invalid response from Pinata: IPFS Hash missing.");
    }

    return { cid };
  } catch (e: any) {
    // Standardize error messages for the UI
    throw new Error(e.message || "Network error while pinning to IPFS.");
  }
}
