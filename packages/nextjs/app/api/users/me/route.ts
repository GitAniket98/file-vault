// packages/nextjs/app/api/users/me/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "~~/lib/authSession";
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
 * - Identity is derived ONLY from the JWT.
 * - Rate limited to prevent polling abuse by frontend clients.
 */
export async function GET(req: NextRequest) {
  try {
    // 1. Rate Limiting (Lightweight)
    // Prevents aggressive polling hooks (e.g., useInterval) from hammering the DB.
    const ip = getClientIp(req);
    const limitResult = await rateLimit(req, `me:${ip}`, 30, 60_000); // 30 req/min
    if (!limitResult.ok && limitResult.response) {
      return limitResult.response;
    }

    // 2. Session Validation
    const session = await getSessionFromRequest(req);

    if (!session) {
      // Scenario A: User is not logged in (Guest)
      return NextResponse.json<ApiOk>({
        ok: true,
        registered: false,
        user: null,
      });
    }

    const walletAddr = session.walletAddr.toLowerCase();
    const supabase = createSupabaseServerClient();

    // 3. Database Lookup
    // Check if the authenticated wallet has completed the registration flow.
    const { data, error } = await supabase
      .from("User")
      .select("did, wallet_addr, enc_alg")
      .eq("wallet_addr", walletAddr)
      .maybeSingle();

    if (error) {
      console.error("[API] /users/me DB error:", error);
      return NextResponse.json<ApiErr>({ ok: false, error: "Database query failed" }, { status: 500 });
    }

    if (!data) {
      // Scenario B: User is Logged In (SIWE) but has NOT registered a DID yet.
      // Frontend should redirect them to /register.
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
