// packages/nextjs/lib/wrapKeys.ts
// Real wrapping: ECDH(P-256) + AES-GCM over the AES file key.
// Hardened: skips invalid recipient keys instead of crashing uploads.
import { bytesToHex } from "~~/lib/bytes";

export type RecipientUser = {
  did: string;
  wallet_addr: string;
  enc_alg: string;
  enc_pubkey_hex: string; // JSON-encoded JWK
};

export type WrappedKeyPayload = {
  recipientDid: string;
  algorithm: string;
  keyVersion: number;
  wrappedKeyHex: `0x${string}`; // IV || ciphertext
  ephemeralPubHex: `0x${string}`; // raw P-256 public key
};

function toPlainArrayBuffer(input: ArrayBuffer | ArrayBufferView | Uint8Array): ArrayBuffer {
  let view: Uint8Array;
  if (input instanceof Uint8Array) {
    view = input;
  } else if (input instanceof ArrayBuffer) {
    view = new Uint8Array(input);
  } else {
    view = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  const out = new Uint8Array(view.byteLength);
  out.set(view);
  return out.buffer;
}

/**
 * Import recipient EC P-256 public key from stored JWK JSON.
 * Returns null if invalid instead of throwing (hardened).
 */
async function importRecipientPubKeyFromJwkJson(jwkJson: string): Promise<CryptoKey | null> {
  let jwk: JsonWebKey;

  try {
    jwk = JSON.parse(jwkJson);
  } catch {
    console.warn("wrapKeys: invalid JWK JSON");
    return null;
  }

  if (jwk.kty !== "EC" || jwk.crv !== "P-256") {
    console.warn("wrapKeys: recipient key is not EC P-256", jwk);
    return null;
  }

  try {
    return await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, []);
  } catch (e) {
    console.warn("wrapKeys: failed to import recipient public key", e);
    return null;
  }
}

export async function wrapAesKeyForRecipients(
  rawKey: ArrayBuffer | ArrayBufferView | Uint8Array,
  recipients: RecipientUser[],
): Promise<WrappedKeyPayload[]> {
  const rawBuf = toPlainArrayBuffer(rawKey);
  const rawBytes = new Uint8Array(rawBuf);

  if (rawBytes.byteLength !== 32) {
    throw new Error("wrapAesKeyForRecipients expects a 32-byte AES-256 key");
  }

  const results: WrappedKeyPayload[] = [];

  for (const user of recipients) {
    const recipientPub = await importRecipientPubKeyFromJwkJson(user.enc_pubkey_hex);

    if (!recipientPub) {
      console.warn(`wrapKeys: skipping recipient ${user.did} due to invalid public key`);
      continue;
    }

    const eph = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);

    const sharedKey = await crypto.subtle.deriveKey(
      { name: "ECDH", public: recipientPub },
      eph.privateKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );

    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);

    const ctBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, sharedKey, rawBytes);

    const ct = new Uint8Array(ctBuf);
    const wrappedWithIv = new Uint8Array(iv.length + ct.length);
    wrappedWithIv.set(iv, 0);
    wrappedWithIv.set(ct, iv.length);

    const ephPubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));

    results.push({
      recipientDid: user.did,
      algorithm: user.enc_alg || "ecdh-p256-aesgcm-v1",
      keyVersion: 1,
      wrappedKeyHex: bytesToHex(wrappedWithIv),
      ephemeralPubHex: bytesToHex(ephPubRaw),
    });
  }

  return results;
}
