// packages/nextjs/lib/authSession.ts
// JWT-based session helper for API routes.
// - Reads the fv_session cookie (JWT signed with JWT_SECRET via lib/jwt.ts)
// - Optionally falls back to Authorization: Bearer <token>
// - Verifies via verifySessionJwt and returns a normalized Session object.
import { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, type SessionPayload, verifySessionJwt } from "~~/lib/jwt";

export type Session = {
  did: string;
  sub: string; // wallet address (lowercased)
  walletAddr: `0x${string}`; // alias for sub
  iat?: number;
  exp?: number;
};

/**
 * Try to extract a wallet-bound session from the request.
 * Priority:
 *   1. fv_session cookie (recommended)
 *   2. Authorization: Bearer <jwt> header (fallback)
 *
 * Returns null if missing/invalid/expired.
 */
export async function getSessionFromRequest(req: NextRequest): Promise<Session | null> {
  let token: string | null = null;

  // 1) Cookie (fv_session) – preferred
  try {
    const cookieToken = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (cookieToken && typeof cookieToken === "string") {
      token = cookieToken;
    }
  } catch {
    // ignore cookie parsing issues and fall back to header
  }

  // 2) Optional Authorization: Bearer <jwt> header
  if (!token) {
    const header = req.headers.get("authorization") || req.headers.get("Authorization");
    if (header && header.toLowerCase().startsWith("bearer ")) {
      const maybeToken = header.slice("bearer ".length).trim();
      if (maybeToken) {
        token = maybeToken;
      }
    }
  }

  if (!token) return null;

  try {
    const payload: SessionPayload = await verifySessionJwt(token);

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
    // invalid or expired token
    return null;
  }
}
