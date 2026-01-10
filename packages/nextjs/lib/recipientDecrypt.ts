// packages/nextjs/lib/recipientDecrypt.ts
// Recipient-side decrypt helpers:
// 1) Unwrap AES file key using device ECDH(P-256) private key (Namespaced by wallet)
// 2) Decrypt file ciphertext from IPFS using AES-GCM
import { hexToUint8 } from "~~/lib/bytes";
import { ensureDeviceEncKeyPair } from "~~/lib/deviceEncKeys";

// 👈 Updated signature

/** Normalize to a fresh ArrayBuffer backed by a plain ArrayBuffer (no SharedArrayBuffer). */
function toPlainArrayBuffer(input: ArrayBuffer | ArrayBufferView | Uint8Array): ArrayBuffer {
  let view: Uint8Array;
  if (input instanceof Uint8Array) {
    view = input;
  } else if (input instanceof ArrayBuffer) {
    view = new Uint8Array(input);
  } else {
    // DataView / other typed arrays
    view = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  const out = new Uint8Array(view.byteLength);
  out.set(view);
  return out.buffer;
}

/**
 * Unwrap the 32-byte AES file key for a recipient.
 *
 * - walletAddr: The connected wallet address (Used to find the correct Identity Key)
 * - wrappedKeyHex: 0x + hex( IV_wrap || ciphertext_wrap )
 * - ephemeralPubHex: 0x + hex( ephemeral ECDH P-256 public key, raw )
 * - Uses the device ECDH private key from IndexedDB.
 */
export async function unwrapFileAesKeyForRecipient(
  walletAddr: string, // 👈 New Argument
  wrappedKeyHex: string,
  ephemeralPubHex: string,
): Promise<Uint8Array> {
  if (!walletAddr) throw new Error("Wallet address required for decryption");
  if (!wrappedKeyHex || !ephemeralPubHex) {
    throw new Error("Missing wrappedKeyHex or ephemeralPubHex");
  }

  // 1) Load device ECDH keypair specific to this wallet
  // ensureDeviceEncKeyPair will create one if missing, but typically we expect it to exist here.
  const { privJwk } = await ensureDeviceEncKeyPair(walletAddr);

  const privKey = await crypto.subtle.importKey("jwk", privJwk, { name: "ECDH", namedCurve: "P-256" }, false, [
    "deriveKey",
  ]);

  // 2) Import ephemeral public key
  const ephPubBytes = hexToUint8(ephemeralPubHex);
  const ephPubKey = await crypto.subtle.importKey(
    "raw",
    toPlainArrayBuffer(ephPubBytes),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );

  // 3) Derive shared AES-256-GCM key
  const sharedKey = await crypto.subtle.deriveKey(
    { name: "ECDH", public: ephPubKey },
    privKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );

  // 4) Split wrappedKey into IV + ciphertext
  const wrappedBytes = hexToUint8(wrappedKeyHex);
  if (wrappedBytes.byteLength < 13) {
    throw new Error("wrappedKey too short");
  }
  const ivWrap = wrappedBytes.slice(0, 12);
  const ctWrap = wrappedBytes.slice(12);

  // 5) Decrypt to get the raw 32-byte AES file key
  const fileKeyBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivWrap },
    sharedKey,
    toPlainArrayBuffer(ctWrap),
  );
  const fileKey = new Uint8Array(fileKeyBuf);

  if (fileKey.byteLength !== 32) {
    throw new Error("Unwrapped AES key is not 32 bytes");
  }

  return fileKey;
}

/**
 * Decrypt file ciphertext from IPFS using AES-GCM and return a Blob.
 *
 * - cid: IPFS CID where encrypted file is stored
 * - fileKey: 32-byte AES-256 key
 * - ivHex: 0x + 24 hex (12-byte IV used when encrypting the file)
 */
export async function decryptFileFromIpfs(
  cid: string,
  fileKey: Uint8Array,
  ivHex: string,
  mimeType: string | null | undefined,
): Promise<Blob> {
  if (!cid) throw new Error("Missing CID");
  if (fileKey.byteLength !== 32) throw new Error("decryptFileFromIpfs expects 32-byte AES key");

  // 1) Fetch ciphertext from IPFS (via Pinata public gateway for now)
  const url = `https://gateway.pinata.cloud/ipfs/${cid}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch encrypted file from IPFS: ${res.status} ${res.statusText}`);
  }
  const ctBuf = await res.arrayBuffer();

  // 2) Import AES-GCM key (normalize to plain ArrayBuffer)
  const keyBuf = toPlainArrayBuffer(fileKey);
  const aesKey = await crypto.subtle.importKey("raw", keyBuf, { name: "AES-GCM" }, false, ["decrypt"]);

  // 3) Parse IV for the file
  const iv = new Uint8Array(toPlainArrayBuffer(hexToUint8(ivHex)));
  if (iv.byteLength !== 12) {
    throw new Error("File IV must be 12 bytes");
  }

  // 4) Decrypt file bytes
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    aesKey,
    ctBuf, // already ArrayBuffer (valid BufferSource)
  );
  const mime = mimeType || "application/octet-stream";
  return new Blob([plainBuf], { type: mime });
}
