// packages/nextjs/app/api/files/commit-upload/route.ts
import { NextRequest, NextResponse } from "next/server";
import { AuditAction, logFileAction } from "~~/lib/auditLog";
import { getRawToken, getSessionFromRequest } from "~~/lib/authSession";
import { pinataUnpinCid } from "~~/lib/ipfsServer";
import { getClientIp, rateLimit } from "~~/lib/rateLimit";
import { createSupabaseServerClient } from "~~/lib/supabaseServer";
import { verifyFileExists, verifyOwner } from "~~/lib/verifyOnChainAccess";

function toPgByteaLiteral(hex: string): string {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!normalized) throw new Error("Empty hex string for bytea");
  if (normalized.length % 2 !== 0) throw new Error("Invalid hex string length");
  return "\\x" + normalized.toLowerCase();
}

function isBytes32(hex: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(hex.trim());
}

function isIv12Hex(hex: string): boolean {
  return /^0x[0-9a-fA-F]{24}$/.test(hex.trim());
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

type ApiOk = {
  ok: true;
  file: any;
  wrappedCount: number;
};

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  let fileHashHex = "";
  let session: any = null;

  try {
    // 1. Rate Limit
    const limitResult = await rateLimit(req, `commit-upload:${ip}`, 20, 60_000);
    if (!limitResult.ok && limitResult.response) {
      return limitResult.response;
    }

    // 2. Auth Check
    session = await getSessionFromRequest(req);
    const token = getRawToken(req);

    if (!session || !token) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const uploaderDid = session.did;
    const uploaderAddr = session.walletAddr;

    // 3. Body Validation
    let body: Body | null = null;
    try {
      body = (await req.json()) as Body | null;
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
    }

    if (!body) return NextResponse.json({ ok: false, error: "Missing body" }, { status: 400 });

    const { cid, ivHex, sizeBytes, mimeType, filename, pinProvider, wrappedKeys = [], blockchainTxHash } = body;

    fileHashHex = body.fileHashHex;

    if (!fileHashHex || !cid || !ivHex) {
      return NextResponse.json({ ok: false, error: "Missing required fields" }, { status: 400 });
    }
    if (!isBytes32(fileHashHex) || !isIv12Hex(ivHex)) {
      return NextResponse.json({ ok: false, error: "Invalid hex format" }, { status: 400 });
    }

    // 4. Blockchain Verification
    console.log(`[commit-upload] Verifying file ${fileHashHex.slice(0, 10)}... on blockchain...`);

    const existsOnChain = await verifyFileExists(fileHashHex);

    if (!existsOnChain) {
      console.error(`[commit-upload] ❌ SECURITY: File ${fileHashHex.slice(0, 10)}... does NOT exist on blockchain.`);

      // ⭐ Log failed verification
      await logFileAction({
        action: AuditAction.BLOCKCHAIN_VERIFY_FAILED,
        fileHashHex,
        actorDid: uploaderDid,
        actorAddr: uploaderAddr,
        metadata: { reason: "File not found on blockchain", cid },
        ipAddress: ip,
        success: false,
        errorMessage: "File not found on blockchain",
      });

      await pinataUnpinCid(cid);

      return NextResponse.json(
        {
          ok: false,
          error: "File not found on blockchain. Ensure storeFileHash() succeeded before calling this endpoint.",
        },
        { status: 409 },
      );
    }

    const isOwner = await verifyOwner(fileHashHex, uploaderAddr);

    if (!isOwner) {
      console.error(
        `[commit-upload] ❌ SECURITY: User ${uploaderAddr} attempted to commit file ${fileHashHex.slice(0, 10)}... ` +
          `but is NOT the on-chain owner.`,
      );

      // ⭐ Log failed ownership check
      await logFileAction({
        action: AuditAction.BLOCKCHAIN_VERIFY_FAILED,
        fileHashHex,
        actorDid: uploaderDid,
        actorAddr: uploaderAddr,
        metadata: { reason: "Not the on-chain owner" },
        ipAddress: ip,
        success: false,
        errorMessage: "Not the on-chain owner",
      });

      await pinataUnpinCid(cid);

      return NextResponse.json(
        {
          ok: false,
          error: "You are not the owner of this file on the blockchain",
        },
        { status: 403 },
      );
    }

    console.log(`[commit-upload] ✅ Blockchain verification passed for ${fileHashHex.slice(0, 10)}...`);

    // 5. Init Supabase
    const supabase = createSupabaseServerClient(token);

    const fileHashBytea = toPgByteaLiteral(fileHashHex);
    const ivBytea = toPgByteaLiteral(ivHex);

    let fileRow: any | null = null;
    let wrappedCount = 0;

    // 6. Insert File Metadata
    const { data: fileData, error: fileError } = await supabase
      .from("File")
      .insert({
        file_hash: fileHashBytea,
        cid,
        iv: ivBytea,
        uploader_did: uploaderDid,
        uploader_addr: uploaderAddr,
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
      console.error("[commit-upload] File insert error:", fileError);
      await pinataUnpinCid(cid);
      return NextResponse.json({ ok: false, error: `File insert failed: ${fileError.message}` }, { status: 500 });
    }

    fileRow = fileData;

    // ⭐ 7. Log successful file upload
    await logFileAction({
      action: AuditAction.FILE_UPLOAD,
      fileHashHex,
      actorDid: uploaderDid,
      actorAddr: uploaderAddr,
      metadata: {
        cid,
        filename,
        mimeType,
        sizeBytes,
        blockchainTxHash,
      },
      ipAddress: ip,
      success: true,
    });

    // 8. Insert Wrapped Keys
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
        console.error("[commit-upload] WrappedKey error:", wrappedError);
        await supabase.from("File").delete().eq("file_hash", fileHashBytea);
        await pinataUnpinCid(cid);
        return NextResponse.json({ ok: false, error: "Failed to save keys. Upload aborted." }, { status: 500 });
      }
      wrappedCount = wrappedData?.length ?? 0;
    }

    // 9. Sanitize & Return
    const safeFile = fileRow
      ? {
          ...fileRow,
          size_bytes: fileRow.size_bytes ? fileRow.size_bytes.toString() : null,
        }
      : null;

    console.log(
      `[commit-upload] ✅ SUCCESS: File ${fileHashHex.slice(0, 10)}... committed to database. ` +
        `Owner: ${uploaderAddr}, Wrapped keys: ${wrappedCount}`,
    );

    return NextResponse.json<ApiOk>({ ok: true, file: safeFile, wrappedCount });
  } catch (e: any) {
    // Log unexpected errors
    if (fileHashHex && session) {
      await logFileAction({
        action: AuditAction.FILE_UPLOAD,
        fileHashHex,
        actorDid: session.did,
        actorAddr: session.walletAddr,
        metadata: { error: e?.message },
        ipAddress: ip,
        success: false,
        errorMessage: e?.message || "Internal error",
      });
    }

    if (e instanceof Response) return e;
    console.error("[commit-upload] Critical error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Internal error" }, { status: 500 });
  }
}
