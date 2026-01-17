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
    // 1. Fetch DB Record FIRST (Fix for "File does not exist" error)
    // We check the DB first because the file might already be deleted on-chain.
    const { data: file } = await supabase
      .from("File")
      .select("id,uploader_addr,cid")
      .eq("file_hash", fileHashBytea)
      .maybeSingle();

    // 2. Handle Idempotency (Already deleted)
    if (!file) {
      await pinataUnpinCid(body.cid ?? null);
      return NextResponse.json({ ok: true, cleaned: false, message: "File already removed from DB" });
    }

    // 3. Authorization Logic
    let isAuthorized = false;

    // Check A: Are you the DB Owner? (Primary Check)
    // If this passes, we skip the blockchain call entirely, preventing the crash.
    if (file.uploader_addr?.toLowerCase() === session.walletAddr.toLowerCase()) {
      isAuthorized = true;
    }

    // Check B: Fallback to Chain (Only if DB check fails)
    // Useful if ownership transferred on-chain but DB is stale.
    if (!isAuthorized) {
      try {
        isAuthorized = await verifyOwner(fileHashHex, session.walletAddr);
      } catch (e: any) {
        // If contract reverts with "File does not exist", it means it's gone from chain.
        // Since the user failed Check A (DB) and the file is gone (Chain), they are forbidden.
        console.warn(`[cleanup] Chain verify failed (expected if deleted): ${e.message}`);
        isAuthorized = false;
      }
    }

    if (!isAuthorized) {
      return NextResponse.json({ ok: false, error: "Forbidden: You do not own this file" }, { status: 403 });
    }

    // 4. Cleanup Execution
    const cid = body.cid || file.cid;

    // Delete keys first (Foreign Key constraint usually requires this or CASCADE)
    await supabase.from("WrappedKey").delete().eq("file_hash", fileHashBytea);

    // Delete File record
    const { error: deleteError } = await supabase.from("File").delete().eq("id", file.id);

    if (deleteError) {
      throw new Error(`DB Delete Failed: ${deleteError.message}`);
    }

    // Unpin from IPFS
    try {
      await pinataUnpinCid(cid);
    } catch (ipfsError) {
      console.warn("[cleanup] IPFS unpin failed, but DB cleared:", ipfsError);
    }

    // 5. Audit Log
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
    return NextResponse.json({ ok: false, error: e.message || "Internal Error" }, { status: 500 });
  }
}
