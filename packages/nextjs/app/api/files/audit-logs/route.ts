// packages/nextjs/app/api/files/audit-logs/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRawToken, getSessionFromRequest } from "~~/lib/authSession";
import { rateLimit } from "~~/lib/rateLimit";
// Import supabaseAdmin to bypass RLS
import { supabaseAdmin } from "~~/lib/supabaseServer";
import { verifyOwner } from "~~/lib/verifyOnChainAccess";

function toPgByteaLiteral(hex: string): string {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!normalized) throw new Error("Empty fileHashHex");
  if (normalized.length !== 64) throw new Error("fileHashHex must be 32 bytes");
  return "\\x" + normalized.toLowerCase();
}

function toHex(bytea: string | null): string | null {
  if (!bytea) return null;
  return bytea.startsWith("\\x") ? "0x" + bytea.slice(2) : bytea;
}

type AuditLogRow = {
  id: number;
  action: string;
  fileHashHex: string | null;
  actorDid: string;
  actorAddr: string;
  targetDid: string | null;
  targetAddr: string | null;
  metadata: any;
  ipAddress: string | null;
  userAgent: string | null;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
};

type ApiOk = {
  ok: true;
  logs: AuditLogRow[];
};

type ApiErr = {
  ok: false;
  error: string;
};

/**
 * GET /api/files/audit-logs?fileHashHex=0x...
 * * Returns audit log for a specific file
 */
export async function GET(req: NextRequest) {
  try {
    // 1. Rate limit
    const limitResult = await rateLimit(req, "audit-logs", 30, 60_000);
    if (!limitResult.ok && limitResult.response) {
      return limitResult.response;
    }

    // 2. Auth check
    const session = await getSessionFromRequest(req);
    const token = getRawToken(req);

    if (!session || !token) {
      return NextResponse.json<ApiErr>({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // 3. Input validation
    const url = new URL(req.url);
    let fileHashHex = (url.searchParams.get("fileHashHex") || "").trim();

    // --- Normalization Fix: Convert Postgres \x format to EVM 0x format ---
    if (fileHashHex.startsWith("\\x")) {
      fileHashHex = "0x" + fileHashHex.slice(2);
    }

    if (!fileHashHex || !/^0x[0-9a-fA-F]{64}$/.test(fileHashHex)) {
      return NextResponse.json<ApiErr>({ ok: false, error: "Invalid fileHashHex" }, { status: 400 });
    }

    // 4. Verify ownership on blockchain
    // This is our TRUE security check. If this passes, the user is authorized.
    const isOwner = await verifyOwner(fileHashHex, session.walletAddr);

    if (!isOwner) {
      console.error(
        `[audit-logs] SECURITY: User ${session.walletAddr} attempted to view logs ` +
          `for file ${fileHashHex.slice(0, 10)}... but is NOT the on-chain owner.`,
      );
      return NextResponse.json<ApiErr>(
        {
          ok: false,
          error: "You are not the owner of this file on the blockchain",
        },
        { status: 403 },
      );
    }

    // 5. Fetch audit logs from database
    // FIX: We use supabaseAdmin to bypass RLS.
    // Since we already verified ownership above (Step 4), this is safe.
    // This avoids the "invalid input syntax for type uuid" error caused by RLS.
    const fileHashBytea = toPgByteaLiteral(fileHashHex);

    const { data, error } = await supabaseAdmin
      .from("AuditLog")
      .select("*")
      .eq("file_hash", fileHashBytea)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[audit-logs] Database error:", error);
      return NextResponse.json<ApiErr>({ ok: false, error: "Failed to fetch logs" }, { status: 500 });
    }

    // 6. Transform response
    const logs: AuditLogRow[] = (data || []).map((log: any) => ({
      id: log.id,
      action: log.action,
      fileHashHex: toHex(log.file_hash),
      actorDid: log.actor_did,
      actorAddr: log.actor_addr,
      targetDid: log.target_did,
      targetAddr: log.target_addr,
      metadata: log.metadata ? (typeof log.metadata === "string" ? JSON.parse(log.metadata) : log.metadata) : null,
      ipAddress: log.ip_address,
      userAgent: log.user_agent,
      success: log.success,
      errorMessage: log.error_message,
      createdAt: log.created_at,
    }));

    return NextResponse.json<ApiOk>({ ok: true, logs });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("GET /api/files/audit-logs error:", e);
    return NextResponse.json<ApiErr>({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
