// packages/nextjs/app/api/users/register/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRawToken, getSessionFromRequest } from "~~/lib/authSession";
import { rateLimit } from "~~/lib/rateLimit";
import { createSupabaseServerClient } from "~~/lib/supabaseServer";

type RegisterBody = {
  encAlg: string;
  encPubkeyHex: string; // JSON JWK string
};

function normalizeEcJwk(jwk: JsonWebKey): JsonWebKey {
  if (jwk.kty?.toUpperCase() !== "EC") throw new Error("Invalid JWK: kty must be EC");
  if (jwk.crv?.toUpperCase() !== "P-256") throw new Error("Invalid JWK: crv must be P-256");
  return { ...jwk, kty: "EC", crv: "P-256" };
}

/**
 * POST /api/users/register
 * * @description
 * Completes the onboarding process by saving the user's Encryption Public Key.
 * * @security
 * - Rely on the Session (JWT) established in Step 1 (Auth).
 * - RLS: The DB `INSERT` policy ensures I can only write to a row where `wallet_addr == my_auth_uid`.
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Auth Check (Session Required)
    const session = await getSessionFromRequest(req);
    const token = getRawToken(req);

    if (!session || !token) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // 2. Input Validation
    const body = (await req.json()) as RegisterBody | null;
    if (!body || !body.encPubkeyHex) {
      return NextResponse.json({ ok: false, error: "Missing public key" }, { status: 400 });
    }

    // 3. JWK Normalization (Security Sanitization)
    let parsedJwk: JsonWebKey;
    try {
      parsedJwk = normalizeEcJwk(JSON.parse(body.encPubkeyHex));
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: `Invalid Key: ${e.message}` }, { status: 400 });
    }

    // 4. Rate Limit
    const rl = await rateLimit(req, `register:${session.walletAddr}`, 5, 60_000);
    if (!rl.ok && rl.response) return rl.response;

    // 5. Init Supabase (User Mode)
    const supabase = createSupabaseServerClient(token);

    // 6. DB Update
    // We use the DID/Wallet from the TRUSTED SESSION, not the body.
    const { data, error } = await supabase
      .from("User")
      .upsert(
        {
          did: session.did,
          wallet_addr: session.walletAddr,
          enc_alg: body.encAlg || "ECDH-ES+A256GCM", // Default algo
          enc_pubkey_hex: JSON.stringify(parsedJwk),
        },
        { onConflict: "wallet_addr" },
      )
      .select()
      .maybeSingle();

    if (error) {
      console.error("Register DB error:", error);
      return NextResponse.json({ ok: false, error: "Registration failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, user: data });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("POST /register error:", e);
    return NextResponse.json({ ok: false, error: "Internal Error" }, { status: 500 });
  }
}
