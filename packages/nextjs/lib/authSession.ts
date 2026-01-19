// packages/nextjs/lib/authSession.ts

/**
 * @module authSession
 * @description
 * Middleware helpers to manage User Identity and Database Context.
 *
 * * Architecture:
 * - `getRawToken`: Extracts the JWT string (needed for Supabase RLS).
 * - `getSessionFromRequest`: Verifies the JWT and returns a typed Session object (needed for API logic).
 */
import { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, type SessionPayload, verifySessionJwt } from "~~/lib/jwt";

export type Session = {
  did: string;
  sub: string; // wallet address (lowercased)
  walletAddr: `0x${string}`; // typed alias for sub
  iat?: number;
  exp?: number;
};

/**
 * Helper: Extracts the raw JWT string from the request.
 *
 * * Strategy: "Dual Extraction"
 * 1. HTTP-Only Cookie (Primary - Secure for Browser)
 * 2. Authorization Header (Fallback - For API testing/Mobile)
 *
 * @returns The raw token string or undefined.
 */
export function getRawToken(req: NextRequest): string | undefined {
  // 1. Try Cookie
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (cookie) return cookie;

  // 2. Try Header
  const header = req.headers.get("authorization") || req.headers.get("Authorization");
  if (header && header.toLowerCase().startsWith("bearer ")) {
    return header.slice("bearer ".length).trim();
  }

  return undefined;
}

/**
 * Validates the request and returns a normalized Session object.
 * Returns null if the user is unauthenticated (missing/invalid/expired token).
 */
export async function getSessionFromRequest(req: NextRequest): Promise<Session | null> {
  const token = getRawToken(req);
  if (!token) return null;

  try {
    // Verify signature & claims using our updated RLS-compatible logic
    const payload: SessionPayload = await verifySessionJwt(token);

    // Sanitize Wallet Address
    const addr = payload.sub?.toLowerCase();
    if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      return null;
    }

    return {
      did: payload.did,
      sub: addr,
      walletAddr: addr as `0x${string}`,
      iat: typeof payload.iat === "number" ? payload.iat : undefined,
      exp: typeof payload.exp === "number" ? payload.exp : undefined,
    };
  } catch {
    // Fail silently on auth errors (expired, signature mismatch)
    return null;
  }
}
