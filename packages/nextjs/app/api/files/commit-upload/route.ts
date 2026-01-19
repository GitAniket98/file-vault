import { NextRequest, NextResponse } from "next/server";
import { AuditAction, logFileAction } from "~~/lib/auditLog";
import { getRawToken, getSessionFromRequest } from "~~/lib/authSession";
import { pinataUnpinCid } from "~~/lib/ipfsServer";
import { getClientIp, rateLimit } from "~~/lib/rateLimit";
import { createSupabaseServerClient } from "~~/lib/supabaseServer";
import { verifyFileExists, verifyOwner } from "~~/lib/verifyOnChainAccess";

/**
 * Validates 32-byte hex string (Ethereum bytes32)
 */
function isBytes32(hex: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(hex.trim());
}

/**
 * Validates 12-byte hex string (AES-GCM IV)
 */
function isIv12Hex(hex: string): boolean {
  return /^0x[0-9a-fA-F]{24}$/.test(hex.trim());
}

function toPgByteaLiteral(hex: string): string {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!normalized) throw new Error("Empty hex string for bytea");
  if (normalized.length % 2 !== 0) throw new Error("Invalid hex string length");
  return "\\x" + normalized.toLowerCase();
}

type WrappedKeyItem = {
  recipientDid: string;
  algorithm?: string;
  keyVersion?: number;
  wrappedKeyHex: string;
  ephemeralPubHex?: string | null;
};

type Body = {
  fileHashHex: string;
  cid: string;
  ivHex: string;
  sizeBytes?: number | null;
  mimeType?: string | null;
  filename?: string | null;
  pinProvider?: string | null;
  wrappedKeys?: WrappedKeyItem[];
  blockchainTxHash?: string;
};

/**
 * POST /api/files/commit-upload
 * Finalizes a file upload by verifying blockchain state and saving metadata to DB.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  let fileHashHex = "";
  let session: any = null;

  try {
    // 1. Rate Limit
    const limitResult = await rateLimit(req, `commit-upload:${ip}`, 20, 60_000);
    if (!limitResult.ok && limitResult.response) return limitResult.response;

    // 2. Auth Check
    session = await getSessionFromRequest(req);
    const token = getRawToken(req);
    if (!session || !token) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // 3. Validation
    const body = (await req.json()) as Body | null;
    if (!body) return NextResponse.json({ ok: false, error: "Missing body" }, { status: 400 });

    const { cid, ivHex, sizeBytes, mimeType, filename, pinProvider, wrappedKeys = [], blockchainTxHash } = body;
    fileHashHex = body.fileHashHex;

    if (!fileHashHex || !cid || !ivHex) {
      return NextResponse.json({ ok: false, error: "Missing required fields" }, { status: 400 });
    }
    if (!isBytes32(fileHashHex) || !isIv12Hex(ivHex)) {
      return NextResponse.json({ ok: false, error: "Invalid hex format" }, { status: 400 });
    }

    // 4. Verify Blockchain State (With Retry Logic)
    // ---------------------------------------------------------
    // CHANGE: Retry 5 times with 2s delay.
    // This handles RPC latency where the node hasn't indexed the block yet.
    let existsOnChain = false;
    for (let i = 0; i < 5; i++) {
      existsOnChain = await verifyFileExists(fileHashHex);
      if (existsOnChain) break; // Found it!

      console.log(`[commit-upload] Try ${i + 1}/5: File not found yet, waiting...`);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
    }
    // ---------------------------------------------------------

    if (!existsOnChain) {
      console.warn(`[commit-upload] Verification Failed: File ${fileHashHex.slice(0, 10)} not on chain after retries.`);

      await logFileAction({
        action: AuditAction.BLOCKCHAIN_VERIFY_FAILED,
        fileHashHex,
        actorDid: session.did,
        actorAddr: session.walletAddr,
        metadata: { reason: "File not found on blockchain", cid },
        ipAddress: ip,
        success: false,
      });

      // Cleanup orphan pin
      await pinataUnpinCid(cid);
      return NextResponse.json(
        {
          ok: false,
          error: "File verification failed on blockchain (Consistency Error). Please try again in 1 minute.",
        },
        { status: 409 },
      );
    }

    // 4b. Verify Owner (Optional Retry - usually checking existence is enough latency buffer)
    const isOwner = await verifyOwner(fileHashHex, session.walletAddr);
    if (!isOwner) {
      console.warn(`[commit-upload] Ownership mismatch for ${session.walletAddr}`);
      await pinataUnpinCid(cid);
      return NextResponse.json({ ok: false, error: "You are not the on-chain owner" }, { status: 403 });
    }

    // 5. Database Commit
    const supabase = createSupabaseServerClient(token);
    const fileHashBytea = toPgByteaLiteral(fileHashHex);
    const ivBytea = toPgByteaLiteral(ivHex);

    const { data: fileData, error: fileError } = await supabase
      .from("File")
      .insert({
        file_hash: fileHashBytea,
        cid,
        iv: ivBytea,
        uploader_did: session.did,
        uploader_addr: session.walletAddr,
        size_bytes: sizeBytes ?? null,
        mime_type: mimeType ?? null,
        filename: filename ?? null,
        pin_status: "pinned",
        pin_provider: pinProvider ?? "pinata",
        pinned: true,
      })
      .select()
      .maybeSingle();

    if (fileError) {
      console.error("[commit-upload] DB Insert Error:", fileError);
      await pinataUnpinCid(cid); // Critical: Undo IPFS pin if DB fails
      return NextResponse.json({ ok: false, error: "Database commit failed" }, { status: 500 });
    }

    // 6. Save Wrapped Keys (Recipients)
    let wrappedCount = 0;
    if (wrappedKeys.length > 0) {
      const rows = wrappedKeys.map(item => ({
        file_hash: fileHashBytea,
        recipient_did: item.recipientDid.trim(),
        algorithm: item.algorithm || "ecdh-p256-aesgcm-v1",
        key_version: item.keyVersion ?? 1,
        wrapped_key: toPgByteaLiteral(item.wrappedKeyHex),
        ephemeral_pub: item.ephemeralPubHex ? toPgByteaLiteral(item.ephemeralPubHex) : null,
      }));

      const { data: wrappedData, error: wrappedError } = await supabase.from("WrappedKey").insert(rows).select();

      if (wrappedError) {
        console.error("[commit-upload] WrappedKey Insert Error:", wrappedError);
        // Rollback: Delete file row and unpin
        await supabase.from("File").delete().eq("file_hash", fileHashBytea);
        await pinataUnpinCid(cid);
        return NextResponse.json({ ok: false, error: "Failed to save encryption keys" }, { status: 500 });
      }
      wrappedCount = wrappedData?.length ?? 0;
    }

    // 7. Success Audit
    await logFileAction({
      action: AuditAction.FILE_UPLOAD,
      fileHashHex,
      actorDid: session.did,
      actorAddr: session.walletAddr,
      metadata: { cid, filename, sizeBytes, blockchainTxHash },
      ipAddress: ip,
      success: true,
    });

    console.log(`[commit-upload] Success: ${fileHashHex.slice(0, 10)}... (Keys: ${wrappedCount})`);

    // Serialize BigInts if present
    const safeFile = {
      ...fileData,
      size_bytes: fileData?.size_bytes?.toString() || null,
    };

    return NextResponse.json({ ok: true, file: safeFile, wrappedCount });
  } catch (e: any) {
    console.error("[commit-upload] Critical Error:", e);
    return NextResponse.json({ ok: false, error: e.message || "Internal Server Error" }, { status: 500 });
  }
}
