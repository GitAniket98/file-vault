// packages/nextjs/app/api/files/recipients/route.ts
import { NextRequest, NextResponse } from "next/server";
import { AuditAction, logFileAction } from "~~/lib/auditLog";
import { getRawToken, getSessionFromRequest } from "~~/lib/authSession";
import { getClientIp, rateLimit } from "~~/lib/rateLimit";
import { createSupabaseServerClient } from "~~/lib/supabaseServer";
import { verifyOwner } from "~~/lib/verifyOnChainAccess";

function toPgByteaLiteral(hex: string): string {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!normalized) throw new Error("Empty fileHashHex");
  if (normalized.length !== 64) throw new Error("fileHashHex must be 32 bytes (64 hex chars)");
  return "\\x" + normalized.toLowerCase();
}

type RecipientRow = {
  recipientDid: string;
  walletAddr: string;
  algorithm: string;
  keyVersion: number;
  createdAt: string;
};

type ApiOk = { ok: true; recipients: RecipientRow[] };
type ApiErr = { ok: false; error: string };

export async function GET(req: NextRequest) {
  try {
    // 1. Input Validation
    const url = new URL(req.url);
    const fileHashHex = (url.searchParams.get("fileHashHex") || "").trim();

    if (!fileHashHex || !/^0x[0-9a-fA-F]{64}$/.test(fileHashHex)) {
      return NextResponse.json<ApiErr>({ ok: false, error: "Invalid fileHashHex" }, { status: 400 });
    }

    // 2. Auth Check
    const session = await getSessionFromRequest(req);
    const token = getRawToken(req);

    if (!session || !token) {
      return NextResponse.json<ApiErr>({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const ip = getClientIp(req);
    const rl = await rateLimit(req, `recipients-list:${session.walletAddr}:${ip}`, 20, 60_000);
    if (!rl || !rl.ok) {
      return NextResponse.json<ApiErr>({ ok: false, error: "Too many requests" }, { status: 429 });
    }

    // 3. Init Supabase (User Mode)
    const supabase = createSupabaseServerClient(token);
    const fileHashBytea = toPgByteaLiteral(fileHashHex);

    // 4. Authorization: ON-CHAIN VERIFICATION
    // We strictly check if the Smart Contract considers this user the owner.
    const isOwner = await verifyOwner(fileHashHex, session.walletAddr);

    if (!isOwner) {
      return NextResponse.json<ApiErr>({ ok: false, error: "Forbidden: Not file owner on-chain" }, { status: 403 });
    }

    // 5. Fetch Wrapped Keys
    const { data: wrapped, error: wrappedErr } = await supabase
      .from("WrappedKey")
      .select("recipient_did, algorithm, key_version, created_at")
      .eq("file_hash", fileHashBytea);

    if (!wrappedErr) {
      await logFileAction({
        action: AuditAction.ACCESS_VIEW_RECIPIENTS,
        fileHashHex,
        actorDid: session.did,
        actorAddr: session.walletAddr,
        metadata: {
          recipientCount: wrapped?.length || 0,
        },
        ipAddress: getClientIp(req),
        success: true,
      });
    }

    if (wrappedErr) {
      console.error("WrappedKey query error:", wrappedErr);
      return NextResponse.json<ApiErr>({ ok: false, error: "Failed to fetch recipients" }, { status: 500 });
    }

    if (!wrapped || wrapped.length === 0) {
      return NextResponse.json<ApiOk>({ ok: true, recipients: [] });
    }

    // 6. Identity Resolution
    const recipientDids = wrapped.map(w => w.recipient_did as string);
    const { data: users, error: usersErr } = await supabase
      .from("User")
      .select("did, wallet_addr")
      .in("did", recipientDids);

    if (usersErr) {
      return NextResponse.json<ApiErr>({ ok: false, error: "Identity resolution failed" }, { status: 500 });
    }

    const userByDid = new Map<string, string>();
    (users || []).forEach(u => {
      if (u.did && u.wallet_addr) userByDid.set(u.did.toLowerCase(), u.wallet_addr.toLowerCase());
    });

    const recipients: RecipientRow[] = wrapped.map(w => {
      const did = (w.recipient_did as string) || "";
      return {
        recipientDid: did,
        walletAddr: userByDid.get(did.toLowerCase()) ?? "",
        algorithm: (w.algorithm as string) || "",
        keyVersion: (w.key_version as number) ?? 1,
        createdAt: (w.created_at as string) || "",
      };
    });

    return NextResponse.json<ApiOk>({ ok: true, recipients });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("GET /api/files/recipients error:", e);
    return NextResponse.json<ApiErr>({ ok: false, error: "Internal Error" }, { status: 500 });
  }
}
