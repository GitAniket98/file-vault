// packages/nextjs/app/api/files/transfer-ownership/route.ts
import { NextRequest, NextResponse } from "next/server";
import { AuditAction, logFileAction } from "~~/lib/auditLog";
import { getRawToken, getSessionFromRequest } from "~~/lib/authSession";
import { getClientIp, rateLimit } from "~~/lib/rateLimit";
import { createSupabaseServerClient } from "~~/lib/supabaseServer";
import { verifyOwner } from "~~/lib/verifyOnChainAccess";

function toPgByteaLiteral(hex: string): string {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!normalized) throw new Error("Empty fileHashHex");
  if (normalized.length !== 64) throw new Error("fileHashHex must be 32 bytes");
  return "\\x" + normalized.toLowerCase();
}

type Body = {
  fileHashHex: string;
  newOwnerAddr: string;
  blockchainTxHash?: string;
};

export async function GET(req: NextRequest) {
  return NextResponse.json({ ok: true, message: "Transfer API is working" });
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  let fileHashHex = "";
  let session: any = null;

  try {
    // 1. Rate Limit
    const limitResult = await rateLimit(req, `transfer-ownership:${ip}`, 10, 60_000);
    if (!limitResult.ok && limitResult.response) return limitResult.response;

    // 2. Auth Check
    session = await getSessionFromRequest(req);
    const token = getRawToken(req);

    if (!session || !token) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // 3. Input Validation
    const body = (await req.json()) as Body | null;
    if (!body) return NextResponse.json({ ok: false, error: "Missing body" }, { status: 400 });

    const { newOwnerAddr, blockchainTxHash } = body;
    fileHashHex = body.fileHashHex;

    if (!fileHashHex || !/^0x[0-9a-fA-F]{64}$/.test(fileHashHex)) {
      return NextResponse.json({ ok: false, error: "Invalid fileHashHex" }, { status: 400 });
    }
    if (!newOwnerAddr || !/^0x[0-9a-fA-F]{40}$/.test(newOwnerAddr)) {
      return NextResponse.json({ ok: false, error: "Invalid newOwnerAddr" }, { status: 400 });
    }

    const normalizedNewOwner = newOwnerAddr.toLowerCase();
    const normalizedCurrentOwner = session.walletAddr.toLowerCase();

    if (normalizedNewOwner === normalizedCurrentOwner) {
      return NextResponse.json({ ok: false, error: "Cannot transfer to yourself" }, { status: 400 });
    }

    // 4. 🔐 CRITICAL: Verify ownership transferred on blockchain
    console.log(`[transfer-ownership] Verifying ownership transfer for ${fileHashHex.slice(0, 10)}...`);

    const newOwnerIsOwner = await verifyOwner(fileHashHex, newOwnerAddr);

    if (!newOwnerIsOwner) {
      console.error(`[transfer-ownership] ❌ SECURITY: Transfer not confirmed on-chain.`);

      await logFileAction({
        action: AuditAction.BLOCKCHAIN_VERIFY_FAILED,
        fileHashHex,
        actorDid: session.did,
        actorAddr: session.walletAddr,
        metadata: { reason: "Chain verify failed", target: newOwnerAddr, tx: blockchainTxHash },
        ipAddress: ip,
        success: false,
      });

      return NextResponse.json(
        {
          ok: false,
          error: "Ownership transfer not confirmed on blockchain. Please wait a few seconds and try again.",
        },
        { status: 409 },
      );
    }

    // 5. Init Supabase
    const supabase = createSupabaseServerClient(token);
    const fileHashBytea = toPgByteaLiteral(fileHashHex);

    // 6. Resolve New Owner's DID (Important for DB consistency)
    // We try to find if the new owner has an account in our system
    const { data: newOwnerUser } = await supabase
      .from("User")
      .select("did")
      .ilike("wallet_addr", normalizedNewOwner)
      .maybeSingle();

    const newOwnerDid = newOwnerUser?.did || null; // Might be null if they haven't registered yet

    // 7. Update Database Ownership
    const { data: file, error: updateError } = await supabase
      .from("File")
      .update({
        uploader_addr: normalizedNewOwner,
        uploader_did: newOwnerDid, // Update DID if found, otherwise set null (or keep old? usually null is safer)
      })
      .eq("file_hash", fileHashBytea)
      .select()
      .maybeSingle();

    if (updateError) throw new Error(updateError.message);
    if (!file) return NextResponse.json({ ok: false, error: "File not found in DB" }, { status: 404 });

    // 8. Audit Log
    await logFileAction({
      action: AuditAction.FILE_OWNERSHIP_TRANSFER,
      fileHashHex,
      actorDid: session.did,
      actorAddr: session.walletAddr, // The OLD owner performed the action
      metadata: {
        previousOwner: normalizedCurrentOwner,
        newOwner: normalizedNewOwner,
        blockchainTxHash,
      },
      ipAddress: ip,
      success: true,
    });

    console.log(`[transfer-ownership]  SUCCESS: Transferred to ${normalizedNewOwner}`);

    return NextResponse.json({
      ok: true,
      message: "File ownership transferred successfully",
    });
  } catch (e: any) {
    console.error("[transfer-ownership] Error:", e);
    return NextResponse.json({ ok: false, error: e.message || "Internal error" }, { status: 500 });
  }
}
