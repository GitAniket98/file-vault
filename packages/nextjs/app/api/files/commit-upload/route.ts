// packages/nextjs/app/api/files/commit-upload/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRawToken, getSessionFromRequest } from "~~/lib/authSession";
import { pinataUnpinCid } from "~~/lib/ipfsServer";
import { getClientIp, rateLimit } from "~~/lib/rateLimit";
import { createSupabaseServerClient } from "~~/lib/supabaseServer";

/** Utility: Formats hex strings for Postgres `bytea` insertion. */
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
};

type ApiOk = {
  ok: true;
  file: any;
  wrappedCount: number;
};

/**
 * POST /api/files/commit-upload
 * * @description
 * Finalizes a file upload.
 * * @security
 * - RLS Enabled: Inserts run as the authenticated user.
 * - Atomic-ish: If DB write fails, we rollback the IPFS pin.
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Rate Limit
    const ip = getClientIp(req);
    const limitResult = await rateLimit(req, `commit-upload:${ip}`, 20, 60_000);
    if (!limitResult.ok && limitResult.response) {
      return limitResult.response;
    }

    // 2. Auth Check (Session + Token)
    const session = await getSessionFromRequest(req);
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

    const { fileHashHex, cid, ivHex, sizeBytes, mimeType, filename, pinProvider, wrappedKeys = [] } = body;

    if (!fileHashHex || !cid || !ivHex) {
      return NextResponse.json({ ok: false, error: "Missing required fields" }, { status: 400 });
    }
    if (!isBytes32(fileHashHex) || !isIv12Hex(ivHex)) {
      return NextResponse.json({ ok: false, error: "Invalid hex format" }, { status: 400 });
    }

    // 4. Init Supabase in USER MODE (RLS Active)
    const supabase = createSupabaseServerClient(token);

    const fileHashBytea = toPgByteaLiteral(fileHashHex);
    const ivBytea = toPgByteaLiteral(ivHex);

    let fileRow: any | null = null;
    let wrappedCount = 0;

    // 5. Insert File Metadata
    const { data: fileData, error: fileError } = await supabase
      .from("File")
      .insert({
        file_hash: fileHashBytea,
        cid,
        iv: ivBytea,
        uploader_did: uploaderDid, // Must match JWT claim or RLS will block
        uploader_addr: uploaderAddr, // Must match JWT claim or RLS will block
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
      // Compensating Action: Unpin IPFS
      await pinataUnpinCid(cid);
      return NextResponse.json({ ok: false, error: `File insert failed: ${fileError.message}` }, { status: 500 });
    }

    fileRow = fileData;

    // 6. Audit Log (Best Effort)
    await supabase.from("AuditLog").insert({
      action: "FILE_UPLOAD",
      payload_hash: fileHashBytea,
    });

    // 7. Insert Wrapped Keys (Access Control)
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
        // Rollback: Delete file row + Unpin
        await supabase.from("File").delete().eq("file_hash", fileHashBytea);
        await pinataUnpinCid(cid);
        return NextResponse.json({ ok: false, error: "Failed to save keys. Upload aborted." }, { status: 500 });
      }
      wrappedCount = wrappedData?.length ?? 0;
    }

    // 8. Sanitize & Return
    const safeFile = fileRow
      ? {
          ...fileRow,
          size_bytes: fileRow.size_bytes ? fileRow.size_bytes.toString() : null,
        }
      : null;

    return NextResponse.json<ApiOk>({ ok: true, file: safeFile, wrappedCount });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[commit-upload] Critical error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Internal error" }, { status: 500 });
  }
}
