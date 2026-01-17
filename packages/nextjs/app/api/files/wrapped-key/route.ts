import { NextRequest, NextResponse } from "next/server";
import { getRawToken, getSessionFromRequest } from "~~/lib/authSession";
import { createSupabaseServerClient } from "~~/lib/supabaseServer";

function toPgByteaLiteral(hex: string): string {
  if (!hex) return "";
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  return "\\x" + normalized.toLowerCase();
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const fileHashHex = searchParams.get("fileHashHex");

    if (!fileHashHex) return NextResponse.json({ ok: false, error: "Missing hash" }, { status: 400 });

    const session = await getSessionFromRequest(req);
    const token = getRawToken(req);

    if (!session || !token) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const supabase = createSupabaseServerClient(token);
    const fileHashBytea = toPgByteaLiteral(fileHashHex);

    const { data: keyRecord, error } = await supabase
      .from("WrappedKey")
      .select("wrapped_key, ephemeral_pub")
      .eq("file_hash", fileHashBytea)
      .eq("recipient_did", session.did)
      .maybeSingle();

    if (error) {
      console.error("[wrapped-key] DB Error:", error);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    if (!keyRecord) {
      return NextResponse.json({ ok: false, error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      encryptedKeyHex: keyRecord.wrapped_key,
      ivHex: keyRecord.ephemeral_pub,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
