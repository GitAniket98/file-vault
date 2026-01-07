// packages/nextjs/lib/jwt.ts

/**
 * @module jwt
 * @description
 * Implements Stateless Session Management using JSON Web Tokens (JWT).
 *
 * Architecture:
 * - We use the `jose` library because it is lightweight and compatible with
 * Next.js Edge Runtime / Cloudflare Workers (standard `crypto` module is not).
 * - Algorithm: HS256 (HMAC with SHA-256).
 * Since the backend is both the minter and verifier of the token, symmetric encryption
 * is faster and sufficient compared to asymmetric (RS256).
 */
import { JWTPayload, SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE_NAME = "fv_session";
// 7 days: Balances security (re-auth frequency) vs UX
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export type SessionPayload = JWTPayload & {
  sub: string; // The "Subject": The wallet address (canonical lowercased)
  did: string; // Decentralized Identifier: did:pkh:eip155:<chain>:<addr>
};

/**
 * Retrieves the signing secret from environment variables.
 * Throws immediately if missing to prevent insecure defaults.
 */
function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("Operational Error: JWT_SECRET env var is required for auth");
  }
  // `jose` expects a Uint8Array for secret material, not a string
  return new TextEncoder().encode(secret);
}

/**
 * Mint a new Session Token.
 *
 * @param walletAddr - The Ethereum address authenticated via SIWE.
 * @param did - The resolved DID for the user.
 * @returns JWT string signed with HS256.
 */
export async function signSessionJwt(walletAddr: string, did: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  return await new SignJWT({
    sub: walletAddr.toLowerCase(), // Canonicalize address to prevent case-sensitivity bugs
    did,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_MAX_AGE_SECONDS)
    // Security Claims: Prevent this token from being accepted by other services
    .setIssuer("filevault")
    .setAudience("filevault-app")
    .sign(getSecretKey());
}

/**
 * Validates a Session Token.
 *
 * @param token - The raw JWT string from the cookie.
 * @returns The decoded payload if valid.
 * @throws Error if signature is invalid, expired, or claims mismatch.
 */
export async function verifySessionJwt(token: string): Promise<SessionPayload> {
  const { payload } = await jwtVerify(token, getSecretKey(), {
    // Enforce claim matching to prevent token substitution attacks
    issuer: "filevault",
    audience: "filevault-app",
  });

  // Type Guarding: Ensure the payload actually contains our required fields
  if (!payload.sub || typeof payload.sub !== "string") {
    throw new Error("Invalid JWT payload: 'sub' (wallet address) missing");
  }

  if (!payload.did || typeof payload.did !== "string") {
    throw new Error("Invalid JWT payload: 'did' missing");
  }

  return {
    ...(payload as JWTPayload),
    sub: payload.sub.toLowerCase(),
    did: payload.did,
  } as SessionPayload;
}
