// packages/nextjs/app/api/auth/verify/route.ts
import { NextRequest, NextResponse } from "next/server";
import { verifyMessage } from "viem";
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS, signSessionJwt } from "~~/lib/jwt";
import { getClientIp, rateLimit } from "~~/lib/rateLimit";
import { createSupabaseServerClient } from "~~/lib/supabaseServer";

/**
 * POST /api/auth/verify
 * * @description
 * Completes the SIWE flow.
 * 1. Validates the signature against the stored Nonce.
 * 2. Prevents Replay Attacks by consuming the Nonce.
 * 3. Mints a Stateless JWT Session (HTTP-Only Cookie).
 *
 * * @security
 * - Rate Limiting: Strict (5 req/min) to prevent signature brute-forcing (unlikely but safe).
 * - Replay Protection: Nonce is deleted immediately after use.
 * - Cookie Security: HttpOnly, Secure, SameSite=Lax.
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Rate Limiting
    const ip = getClientIp(req);
    const limitResult = await rateLimit(req, `auth-verify:${ip}`, 5, 60_000);
    if (!limitResult.ok && limitResult.response) {
      return limitResult.response;
    }

    const body = await req.json().catch(() => null);
    const { walletAddr, signature } = body || {};

    if (!walletAddr || !signature) {
      return NextResponse.json({ ok: false, error: "Missing walletAddr or signature" }, { status: 400 });
    }

    const normalizedAddr = walletAddr.toLowerCase();
    const supabase = createSupabaseServerClient();

    // 2. Fetch Pending Nonce
    const { data: nonceRow } = await supabase
      .from("AuthNonce")
      .select("*")
      .eq("wallet_addr", normalizedAddr)
      .maybeSingle();

    if (!nonceRow) {
      return NextResponse.json({ ok: false, error: "Login request expired or invalid. Try again." }, { status: 400 });
    }

    // Check Expiry
    if (new Date(nonceRow.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ ok: false, error: "Nonce expired" }, { status: 400 });
    }

    // 3. Cryptographic Verification
    // The message format MUST match exactly what was signed on the frontend.
    const message = `FileVault login:\nAddress: ${normalizedAddr}\nNonce: ${nonceRow.nonce}`;

    const valid = await verifyMessage({
      address: normalizedAddr as `0x${string}`,
      message,
      signature,
    });

    if (!valid) {
      return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
    }

    // 4. Replay Protection (Critical)
    // Delete the nonce so it cannot be used again.
    await supabase.from("AuthNonce").delete().eq("wallet_addr", normalizedAddr);

    // 5. DID Resolution
    // We check if the user is already registered to get their DID.
    // If not, we generate a transient DID (they are authenticated, but not yet registered).
    const { data: user } = await supabase.from("User").select("did").eq("wallet_addr", normalizedAddr).maybeSingle();

    // Fallback DID for unregistered users (allows them to hit /register endpoint)
    // Note: Hardcoding chainId 1 (Mainnet) or 31337 (Localhost) as default
    const chainId = process.env.NEXT_PUBLIC_CHAIN_ID || "1";
    const did = user?.did || `did:pkh:eip155:${chainId}:${normalizedAddr}`;

    // 6. Session Generation (Stateless JWT)
    const token = await signSessionJwt(normalizedAddr, did);

    const res = NextResponse.json({ ok: true, did });

    // 7. Cookie Setting
    res.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: token,
      httpOnly: true, // JavaScript cannot read this (XSS protection)
      secure: process.env.NODE_ENV === "production", // HTTPS only
      sameSite: "lax", // Allows top-level navigation while protecting CSRF
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    return res;
  } catch (e: any) {
    // Passthrough for rate limit response
    if (e instanceof Response) return e;

    console.error("POST /api/auth/verify error:", e);
    return NextResponse.json({ ok: false, error: e.message || "Authentication failed" }, { status: 500 });
  }
}
