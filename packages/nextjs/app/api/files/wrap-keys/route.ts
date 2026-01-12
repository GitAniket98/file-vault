// packages/nextjs/app/api/files/wrap-keys/route.ts
import { NextRequest, NextResponse } from "next/server";
import { AuditAction, logFileAction } from "~~/lib/auditLog";
import { getRawToken, getSessionFromRequest } from "~~/lib/authSession";
import { getClientIp, rateLimit } from "~~/lib/rateLimit";
import { createSupabaseServerClient } from "~~/lib/supabaseServer";
import { verifyOwner } from "~~/lib/verifyOnChainAccess";

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
 * Grants access to recipients by storing wrapped keys
 *
 * @security
 * - Verifies caller is on-chain owner before allowing key insertion
 */
export async function POST(req: NextRequest) {
  try {
    const limited = await rateLimit(req, "wrap-keys", 20, 60_000);
    if (!limited.ok && limited.response) return limited.response;

    const session = await getSessionFromRequest(req);
    const token = getRawToken(req);

    if (!session || !token) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body?.fileHashHex || !Array.isArray(body.wrappedKeys)) {
      return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    }

    const fileHashHex = body.fileHashHex;

    if (!/^0x[0-9a-fA-F]{64}$/.test(fileHashHex)) {
      return NextResponse.json({ ok: false, error: "Invalid fileHashHex format" }, { status: 400 });
    }

    // Verify ownership on blockchain
    const isOwner = await verifyOwner(fileHashHex, session.walletAddr);

    if (!isOwner) {
      console.error(
        `[wrap-keys] ❌ SECURITY: User ${session.walletAddr} attempted to wrap keys for file ${fileHashHex.slice(0, 10)}... ` +
          `but is NOT the on-chain owner.`,
      );
      return NextResponse.json(
        {
          ok: false,
          error: "You are not the owner of this file on the blockchain",
        },
        { status: 403 },
      );
    }

    const supabase = createSupabaseServerClient(token);
    const fileHashBytea = toPg(fileHashHex);

    // Data transformation
    const rows = body.wrappedKeys.map((k: WrappedKeyItem) => ({
      file_hash: fileHashBytea,
      recipient_did: k.recipientDid,
      algorithm: k.algorithm,
      key_version: k.keyVersion,
      wrapped_key: toPg(k.wrappedKeyHex),
      ephemeral_pub: toPg(k.ephemeralPubHex),
    }));

    // Insert wrapped keys
    const { data, error } = await supabase.from("WrappedKey").insert(rows).select();

    if (error) {
      console.error("WrappedKey insert failed:", error);
      return NextResponse.json({ ok: false, error: `Failed to grant access: ${error.message}` }, { status: 500 });
    }

    console.log(
      `[wrap-keys] ✅ SUCCESS: User ${session.walletAddr} granted access to ${rows.length} recipients ` +
        `for file ${fileHashHex.slice(0, 10)}...`,
    );

    if (!error && data) {
      // Log each recipient separately
      for (const recipient of body.wrappedKeys) {
        await logFileAction({
          action: AuditAction.ACCESS_GRANT,
          fileHashHex,
          actorDid: session.did,
          actorAddr: session.walletAddr,
          targetDid: recipient.recipientDid,
          targetAddr: null, // Could resolve from recipientDid if needed
          metadata: {
            algorithm: recipient.algorithm,
            keyVersion: recipient.keyVersion,
          },
          ipAddress: getClientIp(req),
          success: true,
        });
      }
    }

    return NextResponse.json({ ok: true, rows: data });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("POST /api/files/wrap-keys error:", e);
    return NextResponse.json({ ok: false, error: "Internal Error" }, { status: 500 });
  }
}
