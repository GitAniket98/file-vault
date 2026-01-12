// packages/nextjs/app/api/users/me/route.ts
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getRawToken, getSessionFromRequest } from "~~/lib/authSession";
import { getClientIp, rateLimit } from "~~/lib/rateLimit";
import { supabaseAdmin } from "~~/lib/supabaseServer";

type ApiOk = {
  ok: true;
  registered: boolean;
  user?: {
    did: string;
    walletAddr: string;
    enc_alg: string | null;
  } | null;
};

type ApiErr = {
  ok: false;
  error: string;
};

export async function GET(req: NextRequest) {
  try {
    // 1. Rate Limiting
    const ip = getClientIp(req);
    const limitResult = await rateLimit(req, `me:${ip}`, 30, 60_000);
    if (!limitResult.ok && limitResult.response) {
      return limitResult.response;
    }

    const cookieStore = await cookies();

    // 2. Session Verification
    const session = await getSessionFromRequest(req);
    const token = getRawToken(req);

    // If invalid signature or no token, treat as Guest
    if (!session || !token) {
      if (token) cookieStore.delete("auth-token");
      return NextResponse.json<ApiOk>({
        ok: true,
        registered: false,
        user: null,
      });
    }

    // 3. DB Existence Check (Admin Mode)
    const { data: user, error } = await supabaseAdmin
      .from("User")
      .select("did, wallet_addr, enc_alg")
      .eq("wallet_addr", session.walletAddr.toLowerCase())
      .maybeSingle();

    if (error) {
      console.error("[API] /users/me DB error:", error);
      return NextResponse.json<ApiErr>({ ok: false, error: "Database query failed" }, { status: 500 });
    }

    // 4. Handle "User Not Found" (Zombie Session)
    if (!user) {
      console.warn(`[Zombie Session] Token valid for ${session.walletAddr} but row missing. Destroying cookie.`);
      cookieStore.delete("auth-token");
      return NextResponse.json<ApiOk>({
        ok: true,
        registered: false,
        user: null,
      });
    }

    // 5. Valid Member
    return NextResponse.json<ApiOk>({
      ok: true,
      registered: true,
      user: {
        did: user.did,
        // Map database 'wallet_addr' to frontend 'walletAddr'
        walletAddr: user.wallet_addr,
        enc_alg: user.enc_alg,
      },
    });
  } catch (e: any) {
    console.error("GET /api/users/me unhandled error:", e);
    return NextResponse.json<ApiErr>({ ok: false, error: e?.message ?? "internal error" }, { status: 500 });
  }
}
