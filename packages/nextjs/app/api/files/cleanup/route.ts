// packages/nextjs/app/api/files/cleanup/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRawToken, getSessionFromRequest } from "~~/lib/authSession";
import { pinataUnpinCid } from "~~/lib/ipfsServer";
import { rateLimit } from "~~/lib/rateLimit";
import { createSupabaseServerClient } from "~~/lib/supabaseServer";

/**
 * Utility to format hex strings for PostgreSQL `bytea` columns.
 */
function toPgByteaLiteral(hex: string): string {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!normalized) throw new Error("Empty hex string for bytea");
  if (normalized.length % 2 !== 0) throw new Error("Invalid hex string length for bytea");
  return "\\x" + normalized.toLowerCase();
}

type Body = {
  fileHashHex: string;
  cid?: string | null;
};

/**
 * POST /api/files/cleanup
 * * @description
 * Compensating Transaction: Rolls back DB state and Unpins from IPFS if an upload fails.
 * * @security
 * - RLS Enabled: Delete operations run as the authenticated user.
 * - Ownership: Explicit check ensures users can only clean up their own files.
 */
export async function POST(req: NextRequest) {
  // 1. Rate Limit
  const limitResult = await rateLimit(req, "files-cleanup", 20, 60_000);
  if (!limitResult.ok && limitResult.response) {
    return limitResult.response;
  }

  let body: Body | null = null;
  try {
    body = (await req.json()) as Body | null;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body?.fileHashHex) {
    return NextResponse.json({ ok: false, error: "Missing fileHashHex" }, { status: 400 });
  }

  const fileHashHex = body.fileHashHex.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(fileHashHex)) {
    return NextResponse.json({ ok: false, error: "fileHashHex must be bytes32" }, { status: 400 });
  }

  // 2. Auth Check
  const session = await getSessionFromRequest(req);
  const token = getRawToken(req); // <--- RLS Token

  if (!session || !token) {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }

  // 3. Init Supabase (User Mode)
  const supabase = createSupabaseServerClient(token);
  const fileHashBytea = toPgByteaLiteral(fileHashHex);

  try {
    // 4. Authorization & Fetch
    // We fetch first to confirm ownership before attempting delete.
    const { data: file, error: fetchError } = await supabase
      .from("File")
      .select("id,uploader_addr,cid")
      .eq("file_hash", fileHashBytea)
      .maybeSingle();

    if (fetchError) {
      console.error("[files/cleanup] Fetch error:", fetchError);
      return NextResponse.json({ ok: false, error: "DB Fetch failed" }, { status: 500 });
    }

    // Scenario: File not in DB (Insert failed). Just unpin IPFS.
    if (!file) {
      await pinataUnpinCid(body.cid ?? null);
      return NextResponse.json({ ok: true, cleaned: false });
    }

    // 5. Hard Authorization Check
    if (file.uploader_addr?.toLowerCase() !== session.walletAddr.toLowerCase()) {
      return NextResponse.json({ ok: false, error: "You are not the uploader of this file" }, { status: 403 });
    }

    const cid = body.cid || file.cid;

    // 6. Atomic-like Cleanup
    // RLS will allow these deletes because we own the file.

    // A. Delete Keys
    await supabase.from("WrappedKey").delete().eq("file_hash", fileHashBytea);

    // B. Delete File Metadata
    await supabase.from("File").delete().eq("id", file.id);

    // C. Unpin IPFS (Non-transactional)
    await pinataUnpinCid(cid);

    return NextResponse.json({ ok: true, cleaned: true });
  } catch (e: any) {
    console.error("[files/cleanup] Unexpected error:", e);
    return NextResponse.json({ ok: false, error: "Internal Error" }, { status: 500 });
  }
}
