// packages/nextjs/lib/auditLog.ts

/**
 * Audit Logging Utilities
 * * Provides functions to log file-related actions to the AuditLog table.
 * Uses service role to bypass RLS and ensure logs cannot be tampered with.
 */
import { createSupabaseServerClient, supabaseAdmin } from "./supabaseServer";

/**
 * Action types for audit logging
 */
export enum AuditAction {
  FILE_UPLOAD = "FILE_UPLOAD",
  FILE_DOWNLOAD = "FILE_DOWNLOAD",
  FILE_DECRYPT = "FILE_DECRYPT",
  FILE_DELETE = "FILE_DELETE",
  ACCESS_GRANT = "ACCESS_GRANT",
  ACCESS_REVOKE = "ACCESS_REVOKE",
  ACCESS_VIEW_RECIPIENTS = "ACCESS_VIEW_RECIPIENTS",
  FILE_OWNERSHIP_TRANSFER = "FILE_OWNERSHIP_TRANSFER",
  BLOCKCHAIN_VERIFY = "BLOCKCHAIN_VERIFY",
  BLOCKCHAIN_VERIFY_FAILED = "BLOCKCHAIN_VERIFY_FAILED",
}

type AuditLogParams = {
  action: AuditAction;
  fileHashHex: string;
  actorDid: string;
  actorAddr: string;
  targetDid?: string | null;
  targetAddr?: string | null;
  metadata?: Record<string, any> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  success?: boolean;
  errorMessage?: string | null;
};

/**
 * Convert hex string to PostgreSQL bytea format
 */
function toPgByteaLiteral(hex: string): string {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  return "\\x" + normalized.toLowerCase();
}

/**
 * Log an action to the audit table
 * Uses service role to bypass RLS (logs cannot be tampered with)
 */
export async function logFileAction(params: AuditLogParams): Promise<void> {
  try {
    const {
      action,
      fileHashHex,
      actorDid,
      actorAddr,
      targetDid = null,
      targetAddr = null,
      metadata = null,
      ipAddress = null,
      userAgent = null,
      success = true,
      errorMessage = null,
    } = params;

    const fileHashBytea = toPgByteaLiteral(fileHashHex);

    const { error } = await supabaseAdmin.from("AuditLog").insert({
      action,
      file_hash: fileHashBytea,
      actor_did: actorDid,
      actor_addr: actorAddr.toLowerCase(),
      target_did: targetDid,
      target_addr: targetAddr?.toLowerCase() || null,
      metadata: metadata ? JSON.stringify(metadata) : null,
      ip_address: ipAddress,
      user_agent: userAgent,
      success,
      error_message: errorMessage,
    });

    if (error) {
      console.error("[AuditLog] Failed to log action:", error);
      // Don't throw - audit logging failures shouldn't break the app
    }
  } catch (err) {
    console.error("[AuditLog] Exception while logging:", err);
  }
}

/**
 * Log multiple actions in batch (for performance)
 */
export async function logFileActionBatch(actions: AuditLogParams[]): Promise<void> {
  try {
    const rows = actions.map(params => ({
      action: params.action,
      file_hash: toPgByteaLiteral(params.fileHashHex),
      actor_did: params.actorDid,
      actor_addr: params.actorAddr.toLowerCase(),
      target_did: params.targetDid || null,
      target_addr: params.targetAddr?.toLowerCase() || null,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      ip_address: params.ipAddress || null,
      user_agent: params.userAgent || null,
      success: params.success ?? true,
      error_message: params.errorMessage || null,
    }));

    const { error } = await supabaseAdmin.from("AuditLog").insert(rows);

    if (error) {
      console.error("[AuditLog] Batch insert failed:", error);
    }
  } catch (err) {
    console.error("[AuditLog] Batch exception:", err);
  }
}

/**
 * Get audit logs for a specific file
 * This can be called from API routes with user token
 */
export async function getFileAuditLogs(fileHashHex: string, token: string) {
  try {
    // REFACTOR: Use the shared helper to create a user-context client
    const supabaseUser = createSupabaseServerClient(token);

    const fileHashBytea = toPgByteaLiteral(fileHashHex);

    const { data, error } = await supabaseUser
      .from("AuditLog")
      .select("*")
      .eq("file_hash", fileHashBytea)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[AuditLog] Failed to fetch logs:", error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error("[AuditLog] Exception while fetching:", err);
    return [];
  }
}
