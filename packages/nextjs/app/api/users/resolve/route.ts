// packages/nextjs/app/api/users/resolve/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRawToken, getSessionFromRequest } from "~~/lib/authSession";
import { getClientIp, rateLimit } from "~~/lib/rateLimit";
import { createSupabaseServerClient } from "~~/lib/supabaseServer";

type ResolveBody = {
  addresses: string[];
};

type ResolvedUser = {
  did: string;
  wallet_addr: string;
  enc_alg: string;
  enc_pubkey_hex: string;
};

type ApiOk = {
  ok: true;
  found: ResolvedUser[];
  missing: string[];
};

/**
 * POST /api/users/resolve
 * * @description
 * Resolves a list of Wallet Addresses into their cryptographic public keys (DID + PubKey).
 * This is the core "Phonebook" lookup required to encrypt data for other users.
 * * @security
 * - **Authentication**: Required. Only logged-in users can look up others.
 * - **Privacy**: Only returns public keys and DIDs (no sensitive metadata).
 * - **RLS**: Relies on "Public Read Profiles" policy in the database.
 */
export async function POST(req: NextRequest) {
  try {
    // ==========================================
    // 1. Authentication Check
    // ==========================================
    // We require a valid session token. Anonymous lookups are disabled to prevent scraping.
    const session = await getSessionFromRequest(req);
    const token = getRawToken(req);

    if (!session || !token) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // ==========================================
    // 2. Input Validation (Batch)
    // ==========================================
    const body = (await req.json()) as ResolveBody | null;
    if (!body || !Array.isArray(body.addresses)) {
      return NextResponse.json({ ok: false, error: "addresses[] required" }, { status: 400 });
    }

    // Normalize & Filter: Only keep valid EVM addresses
    const addresses = body.addresses.map(a => a.toLowerCase().trim()).filter(a => /^0x[0-9a-fA-F]{40}$/.test(a));

    if (addresses.length === 0) {
      return NextResponse.json({ ok: true, found: [], missing: [] } satisfies ApiOk);
    }

    // ==========================================
    // 3. Rate Limiting
    // ==========================================
    // Limit: 60 lookups per minute per IP.
    // Generous enough for batch UI usage, strict enough to stop scraping.
    const ip = getClientIp(req);
    const rl = await rateLimit(req, `resolve:${ip}`, 60, 60_000);
    if (!rl || !rl.ok) {
      return NextResponse.json({ ok: false, error: "Too many requests" }, { status: 429 });
    }

    // ==========================================
    // 4. Database Query (Supabase RLS)
    // ==========================================
    const supabase = createSupabaseServerClient(token);

    // Fetch public profiles matching the requested addresses.
    // The RLS policy for the "User" table must allow "authenticated" role to SELECT these columns.
    const { data, error } = await supabase
      .from("User")
      .select("did, wallet_addr, enc_alg, enc_pubkey_hex")
      .in("wallet_addr", addresses);

    if (error) {
      console.error("User resolve error:", error);
      return NextResponse.json({ ok: false, error: "Resolve failed" }, { status: 500 });
    }

    // ==========================================
    // 5. Response Formatting
    // ==========================================
    const found = (data ?? []) as ResolvedUser[];

    // Identify which requested addresses were NOT found (not registered)
    const foundSet = new Set(found.map(u => u.wallet_addr.toLowerCase()));
    const missing = addresses.filter(a => !foundSet.has(a));

    return NextResponse.json<ApiOk>({ ok: true, found, missing });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("POST /api/users/resolve error:", e);
    return NextResponse.json({ ok: false, error: "Internal Error" }, { status: 500 });
  }
}
