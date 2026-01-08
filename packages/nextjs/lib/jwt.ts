// packages/nextjs/lib/jwt.ts

/**
 * @module jwt
 * @description
 * Implements Stateless Session Management using JSON Web Tokens (JWT).
 * * 🔐 SECURITY ARCHITECTURE (RLS COMPATIBILITY):
 * - We use the `SUPABASE_JWT_SECRET` instead of a random secret.
 * - This allows the Postgres database to verify the signature natively.
 * - We inject the `role: "authenticated"` claim so policies recognize the user.
 * - We verify standard claims (iss, aud) to prevent token substitution attacks.
 */
import { JWTPayload, SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE_NAME = "fv_session";
// 7 days: Balances security (re-auth frequency) vs UX
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

// Extended Payload to satisfy both our App logic AND Supabase RLS
export type SessionPayload = JWTPayload & {
  sub: string; // "Subject": The wallet address (Maps to auth.uid() in SQL)
  did: string; // "Decentralized ID": Used for specific policies (e.g. sharing)
  role: string; // REQUIRED: Must be "authenticated" for RLS policies to trigger
};

/**
 * Retrieves the signing secret from environment variables.
 * ⚠️ CRITICAL: This must match the "JWT Secret" in your Supabase Project Settings.
 */
function getSecretKey(): Uint8Array {
  // CHANGED: We now use the Supabase-specific secret
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    throw new Error("Operational Error: SUPABASE_JWT_SECRET env var is required for RLS compatibility.");
  }
  // `jose` expects a Uint8Array for secret material, not a string
  return new TextEncoder().encode(secret);
}

/**
 * Mint a new Session Token compatible with Supabase RLS.
 *
 * @param walletAddr - The Ethereum address (becomes auth.uid()).
 * @param did - The resolved DID for the user (accessible via auth.jwt()).
 * @returns JWT string signed with HS256.
 */
export async function signSessionJwt(walletAddr: string, did: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  return await new SignJWT({
    sub: walletAddr.toLowerCase(), // Canonicalize address to prevent case-sensitivity bugs
    did, // Custom claim: auth.jwt() ->> 'did'
    role: "authenticated", // REQUIRED: Tells Supabase "this user is logged in"
    app_metadata: { provider: "siwe" },
    user_metadata: { did },
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

  // Ensure role is present (sanity check)
  if (payload.role !== "authenticated") {
    // We log this but don't crash, as legacy tokens might miss it during migration
    console.warn(`[JWT] Warning: Token for ${payload.sub} missing 'authenticated' role.`);
  }

  return {
    ...(payload as JWTPayload),
    sub: payload.sub.toLowerCase(),
    did: payload.did,
    role: (payload.role as string) || "authenticated",
  } as SessionPayload;
}
