// packages/nextjs/app/api/auth/nonce/route.ts
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getClientIp, rateLimit } from "~~/lib/rateLimit";
import { createSupabaseServerClient } from "~~/lib/supabaseServer";

/**
 * POST /api/auth/nonce
 * * @description
 * Generates a cryptographic "Nonce" (Number used ONCE) for Sign-In with Ethereum (SIWE).
 *
 * Flow:
 * 1. Client requests a nonce for their wallet address.
 * 2. Server saves nonce + expiration to DB.
 * 3. Client signs the message `... Nonce: <random_string> ...` using Metamask.
 * 4. Server verifies the signature matches the nonce in DB (in /api/auth/verify).
 *
 * * @security
 * - Rate Limiting: Essential to prevent DB write spam / Resource Exhaustion attacks.
 * - Expiration: Nonces are short-lived (5 mins) to prevent "Pre-generated Nonce" attacks.
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Protection: Rate Limit (e.g., 20 requests per minute per IP)
    // Prevents a single bot from spamming nonce generation.
    const ip = getClientIp(req);
    const limitResult = await rateLimit(req, `auth-nonce:${ip}`, 20, 60_000);
    if (!limitResult.ok && limitResult.response) {
      return limitResult.response;
    }

    // 2. Validation
    const body = await req.json().catch(() => null);
    const { walletAddr } = body || {};

    if (!walletAddr || !/^0x[0-9a-fA-F]{40}$/.test(walletAddr)) {
      return NextResponse.json({ ok: false, error: "Invalid or missing wallet address" }, { status: 400 });
    }

    const supabase = createSupabaseServerClient();

    // 3. Generation
    // 24 bytes = 48 hex characters. Sufficient entropy to prevent guessing.
    const nonce = randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString(); // 5 minutes validity

    // 4. Persistence
    // We use Upsert: If a user refreshes the page, we overwrite their old nonce.
    // This keeps the table clean (1 row per user).
    const { error } = await supabase.from("AuthNonce").upsert(
      {
        wallet_addr: walletAddr.toLowerCase(), // Store canonical address
        nonce,
        expires_at: expiresAt,
      },
      { onConflict: "wallet_addr" },
    );

    if (error) {
      console.error("[Auth] Nonce upsert failed:", error);
      return NextResponse.json({ ok: false, error: "Failed to generate session challenge" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, nonce });
  } catch (e: any) {
    // Passthrough for rate limit response object
    if (e instanceof Response) return e;

    console.error("POST /api/auth/nonce error:", e);
    return NextResponse.json({ ok: false, error: e.message || "Internal Server Error" }, { status: 500 });
  }
}
