// packages/nextjs/app/api/users/me/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRawToken, getSessionFromRequest } from "~~/lib/authSession";
import { getClientIp, rateLimit } from "~~/lib/rateLimit";
import { createSupabaseServerClient } from "~~/lib/supabaseServer";

type ApiOk = {
  ok: true;
  registered: boolean;
  user?: {
    did: string;
    wallet_addr: string;
    enc_alg: string | null;
  } | null;
};

type ApiErr = {
  ok: false;
  error: string;
};

/**
 * GET /api/users/me
 * * @description
 * Returns the current authentication and registration status of the user.
 *
 * * Logic - Returns a "Tristate" identity:
 * 1. **Guest**: No Session. (registered: false, user: null)
 * 2. **Onboarding**: Valid Session, but no DB Row. (registered: false, user: null)
 * 3. **Member**: Valid Session + DB Row. (registered: true, user: {...})
 *
 * * @security
 * - RLS Enabled: Queries DB using the user's specific JWT access token.
 * - Rate limited to prevent polling abuse.
 */
export async function GET(req: NextRequest) {
  try {
    // 1. Rate Limiting (Lightweight)
    const ip = getClientIp(req);
    const limitResult = await rateLimit(req, `me:${ip}`, 30, 60_000); // 30 req/min
    if (!limitResult.ok && limitResult.response) {
      return limitResult.response;
    }

    // 2. Session & Token Extraction
    const session = await getSessionFromRequest(req);
    const token = getRawToken(req);

    // If either is missing, treat as Guest
    if (!session || !token) {
      return NextResponse.json<ApiOk>({
        ok: true,
        registered: false,
        user: null,
      });
    }

    // 3. Database Init (User Mode)
    // We pass the token so RLS policies are applied.
    const supabase = createSupabaseServerClient(token);

    // 4. Database Lookup
    // Check if the authenticated wallet has completed the registration flow.
    // Note: The `.eq` matches the session, but RLS also enforces `auth.uid() = wallet_addr`.
    const { data, error } = await supabase
      .from("User")
      .select("did, wallet_addr, enc_alg")
      .eq("wallet_addr", session.walletAddr)
      .maybeSingle();

    if (error) {
      console.error("[API] /users/me DB error:", error);
      return NextResponse.json<ApiErr>({ ok: false, error: "Database query failed" }, { status: 500 });
    }

    if (!data) {
      // Scenario B: User is Logged In (SIWE) but has NOT registered a DID yet.
      return NextResponse.json<ApiOk>({
        ok: true,
        registered: false,
        user: null,
      });
    }

    // Scenario C: Fully Registered Member
    return NextResponse.json<ApiOk>({
      ok: true,
      registered: true,
      user: {
        did: data.did,
        wallet_addr: data.wallet_addr,
        enc_alg: data.enc_alg,
      },
    });
  } catch (e: any) {
    // Passthrough for rate limiter
    if (e instanceof Response) return e;

    console.error("GET /api/users/me unhandled error:", e);
    return NextResponse.json<ApiErr>({ ok: false, error: e?.message ?? "internal error" }, { status: 500 });
  }
}
