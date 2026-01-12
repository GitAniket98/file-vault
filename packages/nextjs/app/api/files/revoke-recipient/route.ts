// packages/nextjs/app/api/files/revoke-recipient/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRawToken, getSessionFromRequest } from "~~/lib/authSession";
import { rateLimit } from "~~/lib/rateLimit";
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
  recipientDid: string;
};

type ApiOk = { ok: true; deleted: number };
type ApiErr = { ok: false; error: string };

export async function POST(req: NextRequest) {
  try {
    const limitResult = await rateLimit(req, "revoke-recipient", 20, 60_000);
    if (!limitResult.ok && limitResult.response) {
      return limitResult.response;
    }

    const session = await getSessionFromRequest(req);
    const token = getRawToken(req);

    if (!session || !token) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as Body | null;
    if (!body) return NextResponse.json<ApiErr>({ ok: false, error: "Missing body" }, { status: 400 });

    const { fileHashHex, recipientDid } = body;

    if (!fileHashHex || !/^0x[0-9a-fA-F]{64}$/.test(fileHashHex)) {
      return NextResponse.json<ApiErr>({ ok: false, error: "Invalid fileHashHex" }, { status: 400 });
    }
    if (!recipientDid) {
      return NextResponse.json<ApiErr>({ ok: false, error: "recipientDid required" }, { status: 400 });
    }

    // 4. Authorization: ON-CHAIN VERIFICATION
    // Must be the owner on-chain to revoke access
    const isOwner = await verifyOwner(fileHashHex, session.walletAddr);
    if (!isOwner) {
      return NextResponse.json<ApiErr>({ ok: false, error: "Forbidden: Not file owner on-chain" }, { status: 403 });
    }

    const supabase = createSupabaseServerClient(token);
    const fileHashBytea = toPgByteaLiteral(fileHashHex);

    const { error, count } = await supabase
      .from("WrappedKey")
      .delete({ count: "exact" })
      .eq("file_hash", fileHashBytea)
      .eq("recipient_did", recipientDid);

    if (error) {
      console.error("WrappedKey delete error:", error);
      return NextResponse.json<ApiErr>({ ok: false, error: "Delete failed" }, { status: 500 });
    }

    return NextResponse.json<ApiOk>({ ok: true, deleted: count ?? 0 });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("POST /api/files/revoke-recipient error:", e);
    return NextResponse.json<ApiErr>({ ok: false, error: "Internal Error" }, { status: 500 });
  }
}
