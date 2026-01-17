// packages/nextjs/app/api/files/transfer-ownership/route.ts
import { NextRequest, NextResponse } from "next/server";
import { AuditAction, logFileAction } from "~~/lib/auditLog";
import { getRawToken, getSessionFromRequest } from "~~/lib/authSession";
import { getClientIp, rateLimit } from "~~/lib/rateLimit";
import { createSupabaseServerClient } from "~~/lib/supabaseServer";
import { verifyOwner } from "~~/lib/verifyOnChainAccess";

function toPgByteaLiteral(hex: string): string {
  if (!hex) throw new Error("Missing hex string");
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (normalized.length % 2 !== 0) throw new Error("Invalid hex string length");
  return "\\x" + normalized.toLowerCase();
}

type WrappedKeyPayload = {
  wrappedKeyHex: string;
  ephemeralPubHex: string;
  recipientDid?: string;
  algorithm?: string;
  keyVersion?: number;
};

type Body = {
  fileHashHex: string;
  newOwnerAddr: string;
  blockchainTxHash?: string;
  newEncryptedKey?: WrappedKeyPayload;
};

export async function GET() {
  return NextResponse.json({ ok: true, message: "Transfer API is working" });
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  let fileHashHex = "";
  let session: any = null;

  try {
    const limitResult = await rateLimit(req, `transfer-ownership:${ip}`, 10, 60_000);
    if (!limitResult.ok && limitResult.response) return limitResult.response;

    session = await getSessionFromRequest(req);
    const token = getRawToken(req);
    if (!session || !token) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as Body | null;
    if (!body) return NextResponse.json({ ok: false, error: "Missing body" }, { status: 400 });

    const { newOwnerAddr, blockchainTxHash, newEncryptedKey } = body;
    fileHashHex = body.fileHashHex;

    if (!fileHashHex || !/^0x[0-9a-fA-F]{64}$/.test(fileHashHex))
      return NextResponse.json({ ok: false, error: "Invalid fileHashHex" }, { status: 400 });
    if (!newOwnerAddr || !/^0x[0-9a-fA-F]{40}$/.test(newOwnerAddr))
      return NextResponse.json({ ok: false, error: "Invalid newOwnerAddr" }, { status: 400 });

    const normalizedNewOwner = newOwnerAddr.toLowerCase();
    const normalizedCurrentOwner = session.walletAddr.toLowerCase();

    if (normalizedNewOwner === normalizedCurrentOwner)
      return NextResponse.json({ ok: false, error: "Cannot transfer to yourself" }, { status: 400 });

    console.log(`[transfer-ownership] Verifying chain state for ${fileHashHex.slice(0, 10)}...`);
    const newOwnerIsOwner = await verifyOwner(fileHashHex, newOwnerAddr);

    if (!newOwnerIsOwner) {
      await logFileAction({
        action: AuditAction.BLOCKCHAIN_VERIFY_FAILED,
        fileHashHex,
        actorDid: session.did,
        actorAddr: session.walletAddr,
        metadata: { reason: "Chain verify failed", target: newOwnerAddr, tx: blockchainTxHash },
        ipAddress: ip,
        success: false,
      });
      return NextResponse.json({ ok: false, error: "Ownership not confirmed on blockchain." }, { status: 409 });
    }

    const supabase = createSupabaseServerClient(token);
    const fileHashBytea = toPgByteaLiteral(fileHashHex);

    const { data: existingFile } = await supabase
      .from("File")
      .select("id")
      .eq("file_hash", fileHashBytea)
      .maybeSingle();

    if (!existingFile) return NextResponse.json({ ok: false, error: "File not found in DB" }, { status: 404 });

    const { data: newOwnerUser } = await supabase
      .from("User")
      .select("did")
      .ilike("wallet_addr", normalizedNewOwner)
      .maybeSingle();
    const newOwnerDid = newOwnerUser?.did || null;

    if (newEncryptedKey && newOwnerDid) {
      if (!newEncryptedKey.wrappedKeyHex || !newEncryptedKey.ephemeralPubHex) {
        console.error("Invalid Key Payload Received:", newEncryptedKey);
        throw new Error("Missing encryption keys (wrappedKeyHex/ephemeralPubHex) in payload");
      }

      await supabase.from("WrappedKey").delete().eq("file_hash", fileHashBytea).eq("recipient_did", session.did);

      const { error: keyError } = await supabase.from("WrappedKey").upsert({
        file_hash: fileHashBytea,
        recipient_did: newOwnerDid,
        wrapped_key: toPgByteaLiteral(newEncryptedKey.wrappedKeyHex),
        ephemeral_pub: toPgByteaLiteral(newEncryptedKey.ephemeralPubHex),
      });

      if (keyError) console.error("Key rotation error:", keyError);
    }

    const { data: rpcResult, error: rpcError } = await supabase.rpc("transfer_file_ownership", {
      p_file_id: existingFile.id,
      p_current_owner_addr: normalizedCurrentOwner,
      p_new_owner_addr: normalizedNewOwner,
      p_new_owner_did: newOwnerDid,
    });

    if (rpcError) {
      console.error("RPC Error:", rpcError);
      throw new Error(rpcError.message);
    }

    const rowCount = Array.isArray(rpcResult) && rpcResult.length > 0 ? rpcResult[0].row_count : 0;

    if (rowCount === 0) {
      throw new Error("RPC executed but 0 rows updated. Permission or State mismatch.");
    }

    await logFileAction({
      action: AuditAction.FILE_OWNERSHIP_TRANSFER,
      fileHashHex,
      actorDid: session.did,
      actorAddr: session.walletAddr,
      metadata: { previousOwner: normalizedCurrentOwner, newOwner: normalizedNewOwner, blockchainTxHash },
      ipAddress: ip,
      success: true,
    });

    console.log(`[transfer-ownership] SUCCESS: Transferred to ${normalizedNewOwner}`);
    return NextResponse.json({ ok: true, message: "File ownership transferred successfully" });
  } catch (e: any) {
    console.error("[transfer-ownership] Error:", e);
    return NextResponse.json({ ok: false, error: e.message || "Internal error" }, { status: 500 });
  }
}
