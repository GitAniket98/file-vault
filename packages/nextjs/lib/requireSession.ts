// packages/nextjs/lib/requireSession.ts
// Helper for server components / layouts to read the JWT session
// from the fv_session cookie.
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, type SessionPayload, verifySessionJwt } from "~~/lib/jwt";

export type ServerSession = {
  did: string;
  walletAddr: `0x${string}`;
  sub: string;
  iat?: number;
  exp?: number;
};

export async function requireSession(): Promise<ServerSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) return null;

  try {
    const payload: SessionPayload = await verifySessionJwt(token);
    const addr = payload.sub?.toLowerCase();

    if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      return null;
    }

    return {
      did: payload.did,
      walletAddr: addr as `0x${string}`,
      sub: addr,
      iat: typeof payload.iat === "number" ? payload.iat : undefined,
      exp: typeof payload.exp === "number" ? payload.exp : undefined,
    };
  } catch {
    return null;
  }
}
