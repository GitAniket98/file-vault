// packages/nextjs/app/api/files/for-recipient/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRawToken, getSessionFromRequest } from "~~/lib/authSession";
import { getClientIp, rateLimit } from "~~/lib/rateLimit";
import { createSupabaseServerClient } from "~~/lib/supabaseServer";

type SharedFileRow = {
  fileHashHex: string | null;
  ivHex: string | null;
  recipientDid: string;
  algorithm: string;
  keyVersion: number;
  wrappedKeyHex: string | null;
  ephemeralPubHex: string | null;
  cid: string;
  mimeType: string | null;
  filename: string | null;
  sizeBytes: number | null;
  createdAt: string;
};

type ApiOk = {
  ok: true;
  rows: SharedFileRow[];
};

function toHex(bytea: string | null): string | null {
  if (!bytea) return null;
  return bytea.startsWith("\\x") ? "0x" + bytea.slice(2) : bytea;
}

export async function POST(req: NextRequest) {
  try {
    // 1. Auth Check
    const session = await getSessionFromRequest(req);
    const token = getRawToken(req);

    if (!session || !token) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const did = session.did;

    // 2. Rate Limit
    const ip = getClientIp(req);
    const rl = await rateLimit(req, `files-for-recipient:${did}:${ip}`, 30, 60_000);
    if (!rl || !rl.ok) {
      return NextResponse.json({ ok: false, error: "Too many requests" }, { status: 429 });
    }

    // 3. Init Supabase (User Mode)
    const supabase = createSupabaseServerClient(token);

    // 4. Query
    // RLS Policy on WrappedKey: "recipient_did = current_user_did"
    // This ensures I can only see keys meant for ME.
    const { data, error } = await supabase
      .from("WrappedKey")
      .select(
        `
                file_hash, recipient_did, algorithm, key_version, wrapped_key, ephemeral_pub,
                File:file_hash ( cid, iv, mime_type, filename, size_bytes, created_at )
            `,
      )
      .eq("recipient_did", did)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[API] files/for-recipient query error:", error);
      return NextResponse.json({ ok: false, error: "Query failed" }, { status: 500 });
    }

    // 5. Transformation
    const rows: SharedFileRow[] = (data ?? []).map((row: any) => {
      const file = row.File || {};
      return {
        fileHashHex: toHex(row.file_hash ?? null),
        ivHex: toHex(file.iv ?? null),
        recipientDid: row.recipient_did,
        algorithm: row.algorithm,
        keyVersion: row.key_version,
        wrappedKeyHex: toHex(row.wrapped_key ?? null),
        ephemeralPubHex: toHex(row.ephemeral_pub ?? null),
        cid: file.cid,
        mimeType: file.mime_type,
        filename: file.filename,
        sizeBytes: file.size_bytes,
        createdAt: file.created_at,
      };
    });

    return NextResponse.json<ApiOk>({ ok: true, rows });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("POST /api/files/for-recipient error:", e);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
