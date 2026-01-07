// packages/nextjs/utils/crypto.ts

/**
 * @module crypto
 * @description
 * Client-side cryptographic primitives using the Web Crypto API.
 * Handles AES-256-GCM encryption/decryption and SHA-256 hashing.
 *
 * ⚠️ MEMORY WARNING:
 * These functions process files entirely in memory (ArrayBuffer).
 * For very large files (>500MB), this may crash the browser tab.
 * "Industry-level" handling for large files would require Streams (TransformStream),
 * but this implementation is sufficient for files < 100MB.
 */

export type AesBundle = {
  ciphertext: Uint8Array; // The encrypted data
  iv: Uint8Array; // 12-byte nonce (public)
  rawKey: Uint8Array; // 32-byte symmetric key (secret)
  algo: "AES-GCM";
  version: 1;
};

/**
 * Normalizes any binary view into a standalone ArrayBuffer.
 * Critical for WebCrypto compatibility, which rejects SharedArrayBuffers
 * or views with odd offsets in some browsers.
 */
function toArrayBuffer(x: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (x instanceof ArrayBuffer) return x.slice(0); // Create a copy to ensure immutability
  const { buffer, byteOffset, byteLength } = x;
  const src = new Uint8Array(buffer, byteOffset, byteLength);
  const out = new Uint8Array(byteLength);
  out.set(src);
  return out.buffer;
}

/** * Ensures input is a clean Uint8Array backed by a local ArrayBuffer.
 */
function toPlainU8(input: ArrayBuffer | ArrayBufferView | Uint8Array): Uint8Array {
  if (input instanceof Uint8Array) return new Uint8Array(input); // Copy constructor
  const buf = toArrayBuffer(input as ArrayBuffer | ArrayBufferView);
  return new Uint8Array(buf);
}

/** * Optimized hex conversion (faster than string concatenation for large inputs).
 */
function toHex(u8: Uint8Array): `0x${string}` {
  const hexParts: string[] = new Array(u8.length);
  for (let i = 0; i < u8.length; i++) {
    hexParts[i] = u8[i].toString(16).padStart(2, "0");
  }
  return `0x${hexParts.join("")}`;
}

/**
 * Computes SHA-256 hash of binary data.
 * Used for generating the deterministic `fileHash`.
 */
export async function sha256Hex(data: ArrayBuffer | ArrayBufferView | Uint8Array): Promise<`0x${string}`> {
  const buf = toArrayBuffer(data as ArrayBuffer | ArrayBufferView);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return toHex(new Uint8Array(digest));
}

/**
 * Encrypts a File using AES-256-GCM.
 *
 * Security Spec:
 * - Algorithm: AES-GCM (Authenticated Encryption).
 * - Key Size: 256-bit (Quantum resistant enough for now).
 * - IV: 12 bytes (Standard for GCM). MUST be unique per key.
 * * Architecture:
 * - We generate a fresh ephemeral key for every file.
 * - This key is returned raw (so it can be wrapped/encrypted for recipients later)
 * and discarded from memory by the caller after use.
 */
export async function aesEncryptFile(file: File): Promise<AesBundle> {
  // 1. IV Generation: 12 bytes is the optimal size for GCM performance and security.
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  // 2. Key Generation: AES-256
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true, // extractable: true (we need to export it to wrap it for recipients)
    ["encrypt", "decrypt"],
  );

  // 3. Read File (Memory Intensive Step)
  // Note: file.arrayBuffer() returns a clean ArrayBuffer, no need to copy via toArrayBuffer()
  const plainBuf = await file.arrayBuffer();

  // 4. Encrypt
  const ctBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv }, // default tagLength is 128 (safe)
    key,
    plainBuf,
  );
  const ciphertext = new Uint8Array(ctBuf);

  // 5. Export Key
  const rawKeyBuffer = await crypto.subtle.exportKey("raw", key);
  const rawKey = new Uint8Array(rawKeyBuffer);

  return { ciphertext, iv, rawKey, algo: "AES-GCM", version: 1 };
}

/**
 * Decrypts ciphertext back to a Blob.
 *
 * @param mimeType - Used to reconstruct the original File object (e.g. "image/png").
 */
export async function aesDecryptToBlob(
  ciphertext: ArrayBuffer | ArrayBufferView | Uint8Array,
  iv: ArrayBuffer | ArrayBufferView | Uint8Array,
  rawKey: ArrayBuffer | ArrayBufferView | Uint8Array,
  mimeType: string,
): Promise<Blob> {
  const nonce = toPlainU8(iv);
  if (nonce.byteLength !== 12) throw new Error("Security Error: AES-GCM IV must be 12 bytes");

  const keyBytes = toPlainU8(rawKey);
  if (keyBytes.byteLength !== 32) throw new Error("Security Error: AES-256 key must be 32 bytes");

  // Import the raw key material
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(keyBytes),
    { name: "AES-GCM" },
    false, // not extractable (good practice for decrypt-only session)
    ["decrypt"],
  );

  try {
    const ptBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(nonce) },
      key,
      toArrayBuffer(ciphertext as ArrayBuffer | ArrayBufferView),
    );
    return new Blob([new Uint8Array(ptBuf)], { type: mimeType || "application/octet-stream" });
  } catch {
    throw new Error("Decryption failed: Integrity check failed (Auth Tag mismatch) or wrong key.");
  }
}

/** Helper to wrap bytes in a Blob for downloading/uploading. */
export function uint8ToBlob(u8: ArrayBuffer | ArrayBufferView | Uint8Array, mime = "application/octet-stream"): Blob {
  return new Blob([toArrayBuffer(u8 as ArrayBuffer | ArrayBufferView)], { type: mime });
}

/** Strict validation for 32-byte hex strings (used for file hashes). */
export function isBytes32Hex(s: string): s is `0x${string}` {
  return /^0x[0-9a-fA-F]{64}$/.test((s || "").trim());
}
