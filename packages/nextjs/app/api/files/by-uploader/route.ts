// packages/nextjs/app/api/files/by-uploader/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRawToken, getSessionFromRequest } from "~~/lib/authSession";
import { getClientIp, rateLimit } from "~~/lib/rateLimit";
import { createSupabaseServerClient } from "~~/lib/supabaseServer";

type FileRow = {
  id: string;
  file_hash: string;
  cid: string;
  iv: string | null;
  uploader_did: string | null;
  uploader_addr: string;
  size_bytes: number | null;
  mime_type: string | null;
  filename: string | null;
  pin_status: string | null;
  pin_provider: string | null;
  pinned: boolean | null;
  created_at: string;
};

type ApiOk = {
  ok: true;
  files: FileRow[];
};

export async function GET(req: NextRequest) {
  try {
    // 1. Auth Check
    const session = await getSessionFromRequest(req);
    const token = getRawToken(req);

    if (!session || !token) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const walletAddr = session.sub;

    // 2. Rate Limit
    const ip = getClientIp(req);
    const rl = await rateLimit(req, `files-by-uploader:${walletAddr}:${ip}`, 30, 60_000);
    if (!rl?.ok) {
      return NextResponse.json({ ok: false, error: "Too many requests" }, { status: 429 });
    }

    // 3. Init Supabase (User Mode)
    const supabase = createSupabaseServerClient(token);

    // 4. Query
    // RLS automatically filters this query to "My Files Only".
    // The explicit .eq() is defense-in-depth.
    const { data, error } = await supabase
      .from("File")
      .select(
        "id,file_hash,cid,iv,uploader_did,uploader_addr,size_bytes,mime_type,filename,pin_status,pin_provider,pinned,created_at",
      )
      .eq("uploader_addr", walletAddr)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[API] File fetch failed:", error);
      return NextResponse.json({ ok: false, error: "Database query failed" }, { status: 500 });
    }

    return NextResponse.json<ApiOk>({
      ok: true,
      files: (data ?? []) as FileRow[],
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
