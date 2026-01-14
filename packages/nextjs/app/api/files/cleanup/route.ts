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
    let isOwner = false;

    // --- UPDATED LOGIC START ---
    try {
      // First, try to verify on-chain ownership
      isOwner = await verifyOwner(fileHashHex, session.walletAddr);
    } catch (e: any) {
      // If the file was just deleted on-chain by the frontend, the contract calls revert
      // with "File does not exist". We must catch this specific case.
      const isFileDeletedError =
        e.message?.includes("File does not exist") ||
        e.shortMessage?.includes("File does not exist") ||
        e.reason?.includes("File does not exist");

      if (isFileDeletedError) {
        // This is expected during cleanup. We will rely on the DB check (isDbOwner) below.
        isOwner = false;
      } else {
        // Real network/contract error? Re-throw it.
        throw e;
      }
    }
    // --- UPDATED LOGIC END ---

    // Fetch the file record to verify DB ownership
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
    // If it was deleted on-chain (isOwner=false), this check ensures only the
    // original uploader (stored in DB) can remove the DB record.
    const isDbOwner = file.uploader_addr?.toLowerCase() === session.walletAddr.toLowerCase();

    if (!isDbOwner && !isOwner) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const cid = body.cid || file.cid;

    // 5. Cleanup
    // Remove Recipients (WrappedKeys) and the File record itself
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
