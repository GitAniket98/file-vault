// packages/nextjs/app/api/files/cleanup/route.ts
import { NextRequest, NextResponse } from "next/server";
import { AuditAction, logFileAction } from "~~/lib/auditLog";
import { getRawToken, getSessionFromRequest } from "~~/lib/authSession";
import { pinataUnpinCid } from "~~/lib/ipfsServer";
import { getClientIp, rateLimit } from "~~/lib/rateLimit";
import { createSupabaseServerClient } from "~~/lib/supabaseServer";
import { verifyOwner } from "~~/lib/verifyOnChainAccess";

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

export async function POST(req: NextRequest) {
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

  const session = await getSessionFromRequest(req);
  const token = getRawToken(req);

  if (!session || !token) {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }

  const supabase = createSupabaseServerClient(token);
  const fileHashBytea = toPgByteaLiteral(fileHashHex);

  try {
    // 4. Authorization: ON-CHAIN & DB
    // First, verify on-chain ownership if possible
    const isOwner = await verifyOwner(fileHashHex, session.walletAddr);

    // Note: If the file was NEVER successfully committed to chain (upload failed midway),
    // verifyOwner might return false or throw. In that cleanup case, we fallback to DB check.

    const { data: file } = await supabase
      .from("File")
      .select("id,uploader_addr,cid")
      .eq("file_hash", fileHashBytea)
      .maybeSingle();

    if (!file) {
      // Not in DB? Just unpin from IPFS to be clean.
      await pinataUnpinCid(body.cid ?? null);
      return NextResponse.json({ ok: true, cleaned: false });
    }

    // Strict Check: DB Owner OR Chain Owner must match
    const isDbOwner = file.uploader_addr?.toLowerCase() === session.walletAddr.toLowerCase();

    if (!isDbOwner && !isOwner) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const cid = body.cid || file.cid;

    // 5. Cleanup
    await supabase.from("WrappedKey").delete().eq("file_hash", fileHashBytea);
    await supabase.from("File").delete().eq("id", file.id);
    await pinataUnpinCid(cid);

    await logFileAction({
      action: AuditAction.FILE_DELETE,
      fileHashHex,
      actorDid: session.did,
      actorAddr: session.walletAddr,
      metadata: {
        cid: cid,
        reason: "User cleanup",
      },
      ipAddress: getClientIp(req),
      success: true,
    });

    return NextResponse.json({ ok: true, cleaned: true });
  } catch (e: any) {
    console.error("[files/cleanup] Unexpected error:", e);
    return NextResponse.json({ ok: false, error: "Internal Error" }, { status: 500 });
  }
}
