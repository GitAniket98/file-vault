// packages/nextjs/lib/bytes.ts
// Hex <-> Uint8Array/Buffer helpers for cryptographic operations and DB storage.

/**
 * Validates if a string is a valid hex representation.
 * Supports optional 0x prefix.
 */
function isValidHex(hex: string): boolean {
  return /^0x?[0-9a-fA-F]*$/.test(hex);
}

/**
 * Converts a hex string (0x-prefixed or plain) to a standard Uint8Array.
 * Optimized for browser usage (no Node.js Buffer dependency).
 * * @param hex - The hex string to parse
 * @returns Uint8Array containing the binary data
 * @throws Error if string length is odd or contains invalid characters
 */
export function hexToUint8(hex: string): Uint8Array {
  if (!isValidHex(hex)) {
    throw new Error("Invalid hex string characters");
  }

  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;

  if (normalized.length % 2 !== 0) {
    throw new Error("Invalid hex string length (must be even)");
  }

  const len = normalized.length / 2;
  const out = new Uint8Array(len);

  for (let i = 0; i < len; i++) {
    out[i] = parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }

  return out;
}

/**
 * Converts a hex string to a Node.js Buffer.
 * * ⚠️ SERVER-SIDE ONLY:
 * This function returns a Node.js `Buffer` object.
 * Avoid using this in Client Components ("use client") to prevent
 * bundling heavy polyfills or causing runtime errors in edge environments.
 */
export function hexToBuffer(hex: string): Buffer {
  if (!isValidHex(hex)) {
    throw new Error("Invalid hex string characters");
  }

  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;

  if (normalized.length % 2 !== 0) {
    throw new Error("Invalid hex string length");
  }

  return Buffer.from(normalized, "hex");
}

/**
 * Converts raw binary data (Buffer, Uint8Array, ArrayBuffer) to a 0x-prefixed hex string.
 * * @performance
 * Uses Array.map + join instead of string concatenation to avoid O(n²) memory allocation issues
 * on large files.
 */
export function bytesToHex(bytes: ArrayBuffer | ArrayBufferView): `0x${string}` {
  let u8: Uint8Array;

  if (bytes instanceof Uint8Array) {
    u8 = bytes;
  } else if (bytes instanceof ArrayBuffer) {
    u8 = new Uint8Array(bytes);
  } else {
    // Handle Node.js Buffer or DataView
    u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  // Optimization: Pre-allocate array size for performance rather than dynamic push
  const hexParts: string[] = new Array(u8.length);

  for (let i = 0; i < u8.length; i++) {
    // toString(16) is faster than parseInt logic for encoding
    hexParts[i] = u8[i].toString(16).padStart(2, "0");
  }

  return `0x${hexParts.join("")}`;
}
