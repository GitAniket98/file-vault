// packages/nextjs/app/api/files/wrap-keys/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRawToken, getSessionFromRequest } from "~~/lib/authSession";
import { rateLimit } from "~~/lib/rateLimit";
import { createSupabaseServerClient } from "~~/lib/supabaseServer";

/**
 * Helper: Normalizes hex strings for Postgres `bytea` compatibility.
 */
const toPg = (hex: string) => "\\x" + hex.replace(/^0x/, "").toLowerCase();

type WrappedKeyItem = {
  recipientDid: string;
  algorithm: string;
  keyVersion: number;
  wrappedKeyHex: string;
  ephemeralPubHex: string;
};

/**
 * POST /api/files/wrap-keys
 * * @description
 * Adds new recipients (access grants) to an existing file.
 * * @security
 * - RLS Enabled: Inserts run as the authenticated user.
 * - IDOR Protection: Checks ownership of the file before allowing key insertion.
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Rate Limiting
    const limited = await rateLimit(req, "wrap-keys", 20, 60_000);
    if (!limited.ok && limited.response) return limited.response;

    // 2. Auth Check
    const session = await getSessionFromRequest(req);
    const token = getRawToken(req);

    if (!session || !token) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // 3. Input Validation
    const body = await req.json().catch(() => null);
    if (!body?.fileHashHex || !Array.isArray(body.wrappedKeys)) {
      return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    }

    // 4. Init Supabase (User Mode)
    const supabase = createSupabaseServerClient(token);
    const fileHashBytea = toPg(body.fileHashHex);

    // 5. Authorization Check (IDOR Prevention)
    // Verify ownership. RLS policy on "WrappedKey" insert should also enforce this via a check on the parent File table,
    // but this explicit check gives a cleaner 403 error.
    const { data: file } = await supabase
      .from("File")
      .select("uploader_addr")
      .eq("file_hash", fileHashBytea)
      .maybeSingle();

    if (!file) {
      return NextResponse.json({ ok: false, error: "File not found" }, { status: 404 });
    }

    if (file.uploader_addr.toLowerCase() !== session.walletAddr.toLowerCase()) {
      return NextResponse.json({ ok: false, error: "You are not the uploader of this file" }, { status: 403 });
    }

    // 6. Data Transformation
    const rows = body.wrappedKeys.map((k: WrappedKeyItem) => ({
      file_hash: fileHashBytea,
      recipient_did: k.recipientDid,
      algorithm: k.algorithm,
      key_version: k.keyVersion,
      wrapped_key: toPg(k.wrappedKeyHex),
      ephemeral_pub: toPg(k.ephemeralPubHex),
    }));

    // 7. Persistence
    const { data, error } = await supabase.from("WrappedKey").insert(rows).select();

    if (error) {
      console.error("WrappedKey insert failed:", error);
      return NextResponse.json({ ok: false, error: `Failed to grant access: ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true, rows: data });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("POST /api/files/wrap-keys error:", e);
    return NextResponse.json({ ok: false, error: "Internal Error" }, { status: 500 });
  }
}
