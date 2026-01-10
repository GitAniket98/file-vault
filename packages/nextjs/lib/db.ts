// packages/nextjs/lib/db.ts
import { createSupabaseServerClient } from "./supabaseServer";

type InsertFileArgs = {
  fileHashHex: string; // 0x + 64 hex chars
  cid: string; // IPFS CID
  ivHex: string; // 0x + 24 hex chars (12-byte IV)
  uploaderDid?: string | null;
  uploaderAddr: string; // 0x...
  sizeBytes?: number | null;
  mimeType?: string | null;
  filename?: string | null;
  pinProvider?: string | null; // e.g. "pinata"
};

/** Convert 0x-prefixed hex to Postgres bytea literal string ("\\x..."). */
function toPgByteaLiteral(hex: string): string {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!normalized) {
    throw new Error("Empty hex string for bytea");
  }
  if (normalized.length % 2 !== 0) {
    throw new Error("Invalid hex string length for bytea");
  }
  // Postgres expects \x + lowercase hex
  return "\\x" + normalized.toLowerCase();
}

export async function insertFileRecord(args: InsertFileArgs) {
  const supabase = createSupabaseServerClient();

  const { fileHashHex, cid, ivHex, uploaderDid, uploaderAddr, sizeBytes, mimeType, filename, pinProvider } = args;

  const { data, error } = await supabase
    .from("File")
    .insert({
      // IMPORTANT: send bytea as string literal, not Buffer/Uint8Array
      file_hash: toPgByteaLiteral(fileHashHex),
      cid,
      iv: toPgByteaLiteral(ivHex),
      uploader_did: uploaderDid ?? null,
      uploader_addr: uploaderAddr,
      size_bytes: sizeBytes ?? null,
      mime_type: mimeType ?? null,
      filename: filename ?? null,
      pin_status: "pending",
      pin_provider: pinProvider ?? null,
      pinned: false,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`insertFileRecord failed: ${error.message}`);
  }

  return data;
}

export async function insertAuditLog(action: string, payloadHashHex: string, prevHashHex?: string | null) {
  const supabase = createSupabaseServerClient();

  const { data, error } = await supabase
    .from("AuditLog")
    .insert({
      action,
      payload_hash: toPgByteaLiteral(payloadHashHex),
      prev_hash: prevHashHex ? toPgByteaLiteral(prevHashHex) : null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`insertAuditLog failed: ${error.message}`);
  }

  return data;
}
