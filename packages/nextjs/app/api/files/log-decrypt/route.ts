// packages/nextjs/app/api/files/log-decrypt/route.ts

/**
 * POST /api/files/log-decrypt
 *
 * Logs when a user actually decrypts/downloads a file
 * Called from frontend AFTER successful decryption
 */
import { NextRequest, NextResponse } from "next/server";
import { AuditAction, logFileAction } from "~~/lib/auditLog";
import { getRawToken, getSessionFromRequest } from "~~/lib/authSession";
import { getClientIp, rateLimit } from "~~/lib/rateLimit";
import { verifyAccess } from "~~/lib/verifyOnChainAccess";

type Body = {
  fileHashHex: string;
  filename?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
};

export async function POST(req: NextRequest) {
  try {
    // 1. Rate limit (prevent spam)
    const ip = getClientIp(req);
    const limitResult = await rateLimit(req, `log-decrypt:${ip}`, 100, 60_000);
    if (!limitResult.ok && limitResult.response) {
      return limitResult.response;
    }

    // 2. Auth check
    const session = await getSessionFromRequest(req);
    const token = getRawToken(req);

    if (!session || !token) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // 3. Parse body
    const body = (await req.json()) as Body;
    const { fileHashHex, filename, mimeType, sizeBytes } = body;

    if (!fileHashHex || !/^0x[0-9a-fA-F]{64}$/.test(fileHashHex)) {
      return NextResponse.json({ ok: false, error: "Invalid fileHashHex" }, { status: 400 });
    }

    // 4. Verify access on blockchain (important!)
    const hasAccess = await verifyAccess(fileHashHex, session.walletAddr);

    if (!hasAccess) {
      console.warn(
        `[log-decrypt] ⚠️ User ${session.walletAddr} attempted to log decrypt ` +
          `for file ${fileHashHex.slice(0, 10)}... but is NOT authorized on blockchain.`,
      );
      return NextResponse.json({ ok: false, error: "Not authorized" }, { status: 403 });
    }

    // 5. Log the decrypt action
    await logFileAction({
      action: AuditAction.FILE_DECRYPT,
      fileHashHex,
      actorDid: session.did,
      actorAddr: session.walletAddr,
      metadata: {
        filename,
        mimeType,
        sizeBytes,
      },
      ipAddress: ip,
      success: true,
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("POST /api/files/log-decrypt error:", e);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
