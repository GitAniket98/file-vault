// packages/nextjs/app/api/files/recipients/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRawToken, getSessionFromRequest } from "~~/lib/authSession";
import { getClientIp, rateLimit } from "~~/lib/rateLimit";
import { createSupabaseServerClient } from "~~/lib/supabaseServer";

/**
 * Helper: Formats a hex string into a PostgreSQL bytea literal.
 * Used for raw SQL queries or specific Rpc calls if needed,
 * though Supabase client handles simple hex-strings for bytea columns mostly automatically.
 * Here it ensures strict formatting for the 'file_hash' column match.
 */
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

/**
 * GET /api/files/recipients
 * * @description
 * Returns the list of users (recipients) who have been granted access to a specific file.
 * This effectively lists all 'WrappedKeys' associated with a file hash.
 * * @security
 * - **Authentication**: Requires a valid Session Cookie & JWT.
 * - **Authorization**: Application-level check enforces that only the **Uploader** * can see the recipient list.
 * - **RLS**: The DB query runs as the authenticated user, adding a second layer of enforcement.
 */
export async function GET(req: NextRequest) {
  try {
    // ==========================================
    // 1. Input Validation & Sanity Checks
    // ==========================================
    const url = new URL(req.url);
    const fileHashHex = (url.searchParams.get("fileHashHex") || "").trim();

    // Strict hex validation (32 bytes = 64 hex chars) to prevent SQL injection risks via literals
    if (!fileHashHex || !/^0x[0-9a-fA-F]{64}$/.test(fileHashHex)) {
      return NextResponse.json<ApiErr>({ ok: false, error: "Invalid fileHashHex" }, { status: 400 });
    }

    // ==========================================
    // 2. Authentication & Rate Limiting
    // ==========================================
    const session = await getSessionFromRequest(req);
    const token = getRawToken(req);

    if (!session || !token) {
      return NextResponse.json<ApiErr>({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // Rate limit based on Wallet + IP to prevent enumeration attacks
    const ip = getClientIp(req);
    const rl = await rateLimit(req, `recipients-list:${session.walletAddr}:${ip}`, 20, 60_000);
    if (!rl || !rl.ok) {
      return NextResponse.json<ApiErr>({ ok: false, error: "Too many requests" }, { status: 429 });
    }

    // ==========================================
    // 3. Database Initialization (User Mode)
    // ==========================================
    // We init Supabase with the user's JWT. RLS policies will be active.
    const supabase = createSupabaseServerClient(token);
    const fileHashBytea = toPgByteaLiteral(fileHashHex);

    // ==========================================
    // 4. Authorization: Ownership Check
    // ==========================================
    // Defense in Depth: Even if RLS allows reading, we explicitly verify application logic here.
    // Rule: Only the person who uploaded the file (owner) should see who has access to it.
    const { data: file, error: fileErr } = await supabase
      .from("File")
      .select("uploader_addr")
      .eq("file_hash", fileHashBytea)
      .maybeSingle();

    if (fileErr) return NextResponse.json<ApiErr>({ ok: false, error: "File lookup failed" }, { status: 500 });
    if (!file) return NextResponse.json<ApiErr>({ ok: false, error: "File not found" }, { status: 404 });

    // Explicit Check: Reject if requester is not the uploader
    if (file.uploader_addr.toLowerCase() !== session.walletAddr.toLowerCase()) {
      return NextResponse.json<ApiErr>({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    // ==========================================
    // 5. Fetch Wrapped Keys (The "Access List")
    // ==========================================
    // We fetch the metadata of keys wrapped for this file.
    // This effectively tells us *who* (recipient_did) has access.
    const { data: wrapped, error: wrappedErr } = await supabase
      .from("WrappedKey")
      .select("recipient_did, algorithm, key_version, created_at")
      .eq("file_hash", fileHashBytea);

    if (wrappedErr) {
      console.error("WrappedKey query error:", wrappedErr);
      return NextResponse.json<ApiErr>({ ok: false, error: "Failed to fetch recipients" }, { status: 500 });
    }

    // Return early if no access has been granted yet
    if (!wrapped || wrapped.length === 0) {
      return NextResponse.json<ApiOk>({ ok: true, recipients: [] });
    }

    // ==========================================
    // 6. Identity Resolution (Join Logic)
    // ==========================================
    // The 'WrappedKey' table stores DIDs. For the UI, we want human-readable Wallet Addresses.
    // We perform an application-side join to fetch user details for these DIDs.
    const recipientDids = wrapped.map(w => w.recipient_did as string);

    const { data: users, error: usersErr } = await supabase
      .from("User")
      .select("did, wallet_addr")
      .in("did", recipientDids);

    if (usersErr) {
      return NextResponse.json<ApiErr>({ ok: false, error: "Identity resolution failed" }, { status: 500 });
    }

    // Create a quick lookup map: DID -> Wallet Address
    const userByDid = new Map<string, string>();
    (users || []).forEach(u => {
      if (u.did && u.wallet_addr) userByDid.set(u.did.toLowerCase(), u.wallet_addr.toLowerCase());
    });

    // ==========================================
    // 7. Response Formatting
    // ==========================================
    const recipients: RecipientRow[] = wrapped.map(w => {
      const did = (w.recipient_did as string) || "";
      return {
        recipientDid: did,
        walletAddr: userByDid.get(did.toLowerCase()) ?? "", // Fallback to empty if user lookup failed
        algorithm: (w.algorithm as string) || "",
        keyVersion: (w.key_version as number) ?? 1,
        createdAt: (w.created_at as string) || "",
      };
    });

    return NextResponse.json<ApiOk>({ ok: true, recipients });
  } catch (e: any) {
    // Standard Next.js Error Handling pattern
    if (e instanceof Response) return e;
    console.error("GET /api/files/recipients error:", e);
    return NextResponse.json<ApiErr>({ ok: false, error: "Internal Error" }, { status: 500 });
  }
}
