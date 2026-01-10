// packages/nextjs/app/api/files/revoke-recipient/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRawToken, getSessionFromRequest } from "~~/lib/authSession";
import { rateLimit } from "~~/lib/rateLimit";
import { createSupabaseServerClient } from "~~/lib/supabaseServer";

/**
 * Helper: Formats hex string into a PostgreSQL bytea literal.
 * Ensures the value is safe for SQL queries and matches the DB format.
 */
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

/**
 * POST /api/files/revoke-recipient
 * * @description
 * Revokes access for a specific recipient by deleting their 'WrappedKey' entry.
 * This effectively removes their ability to decrypt the file, as they lose access to the AES key.
 * * @security
 * - **Rate Limiting**: Applied to prevent abuse or denial-of-service attacks.
 * - **Authentication**: Requires a valid user session.
 * - **Authorization**: Strict check ensures only the *Uploader* of the file can revoke keys.
 */
export async function POST(req: NextRequest) {
  try {
    // ==========================================
    // 1. Rate Limiting
    // ==========================================
    // Limit: 20 revocations per minute per IP to prevent spamming
    const limitResult = await rateLimit(req, "revoke-recipient", 20, 60_000);
    if (!limitResult.ok && limitResult.response) {
      return limitResult.response;
    }

    // ==========================================
    // 2. Authentication Check
    // ==========================================
    const session = await getSessionFromRequest(req);
    const token = getRawToken(req);

    if (!session || !token) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // ==========================================
    // 3. Input Validation
    // ==========================================
    const body = (await req.json()) as Body | null;
    if (!body) return NextResponse.json<ApiErr>({ ok: false, error: "Missing body" }, { status: 400 });

    const { fileHashHex, recipientDid } = body;

    // Validate hex format (32 bytes = 64 chars) to prevent SQL injection risks
    if (!fileHashHex || !/^0x[0-9a-fA-F]{64}$/.test(fileHashHex)) {
      return NextResponse.json<ApiErr>({ ok: false, error: "Invalid fileHashHex" }, { status: 400 });
    }
    if (!recipientDid) {
      return NextResponse.json<ApiErr>({ ok: false, error: "recipientDid required" }, { status: 400 });
    }

    // ==========================================
    // 4. Init Supabase (User Mode)
    // ==========================================
    // Connect as the authenticated user so RLS policies are active
    const supabase = createSupabaseServerClient(token);
    const fileHashBytea = toPgByteaLiteral(fileHashHex);

    // ==========================================
    // 5. Ownership Verification (Authorization)
    // ==========================================
    // Before deleting, verify that the requester is the OWNER of the file.
    const { data: file } = await supabase
      .from("File")
      .select("uploader_addr")
      .eq("file_hash", fileHashBytea)
      .maybeSingle();

    if (!file) return NextResponse.json<ApiErr>({ ok: false, error: "File not found" }, { status: 404 });

    // Explicit Check: If requester's wallet != uploader's wallet -> 403 Forbidden
    if (file.uploader_addr.toLowerCase() !== session.walletAddr.toLowerCase()) {
      return NextResponse.json<ApiErr>({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    // ==========================================
    // 6. Execute Revocation (Delete Wrapped Key)
    // ==========================================
    // Removes the row linking the recipient DID to this specific file hash.
    const { error, count } = await supabase
      .from("WrappedKey")
      .delete({ count: "exact" })
      .eq("file_hash", fileHashBytea)
      .eq("recipient_did", recipientDid);

    if (error) {
      console.error("WrappedKey delete error:", error);
      return NextResponse.json<ApiErr>({ ok: false, error: "Delete failed" }, { status: 500 });
    }

    // Return success with count of deleted rows (should be 1)
    return NextResponse.json<ApiOk>({ ok: true, deleted: count ?? 0 });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("POST /api/files/revoke-recipient error:", e);
    return NextResponse.json<ApiErr>({ ok: false, error: "Internal Error" }, { status: 500 });
  }
}
