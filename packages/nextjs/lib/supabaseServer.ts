// packages/nextjs/lib/supabaseServer.ts
import { SupabaseClient, createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

/**
 * ⚡ SINGLETON ADMIN CLIENT
 * Exported specifically for internal API routes (like /api/users/check)
 * that need to bypass RLS without a user session.
 */
export const supabaseAdmin = serviceKey
  ? createClient(url, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  : ({} as SupabaseClient); // Prevents crash if env vars are missing during build

/**
 * Creates a context-aware Supabase client.
 *
 * @param accessToken - (Optional) The raw JWT string from the user's session.
 *
 * Mode 1: User Context (RLS Enabled) -> Pass `accessToken`.
 * - Uses `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
 * - The DB sees `auth.uid()` as the user's wallet address.
 *
 * Mode 2: Admin Context (Bypass RLS) -> Pass nothing.
 * - Uses `SUPABASE_SERVICE_ROLE_KEY`.
 */
export function createSupabaseServerClient(accessToken?: string): SupabaseClient {
  if (accessToken) {
    // 🛡️ USER MODE (RLS ACTIVE)
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      throw new Error("Configuration Error: Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");
    }

    return createClient(url, anonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`, // Inject User's JWT so Postgres knows who they are
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  } else {
    // ⚡ ADMIN MODE (RLS BYPASSED)
    if (!url || !serviceKey) {
      throw new Error("Configuration Error: Missing SUPABASE_SERVICE_ROLE_KEY");
    }

    return createClient(url, serviceKey, {
      auth: { persistSession: false },
    });
  }
}
