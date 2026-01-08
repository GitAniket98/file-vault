// packages/nextjs/lib/supabaseServer.ts
import { SupabaseClient, createClient } from "@supabase/supabase-js";

/**
 * Creates a Supabase client.
 *
 * @param accessToken - (Optional) The raw JWT string from the user's session.
 *
 * Mode 1: User Context (RLS Enabled) -> Pass `accessToken`.
 * - Uses `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
 * - The DB sees `auth.uid()` as the user's wallet address.
 * - This is the SECURE way to fetch user data.
 *
 * Mode 2: Admin Context (Bypass RLS) -> Pass nothing.
 * - Uses `SUPABASE_SERVICE_ROLE_KEY`.
 * - Use ONLY for internal tasks (registration, cron jobs) where you need full access
 * or when the user is not yet logged in (e.g. auth verification).
 */
export function createSupabaseServerClient(accessToken?: string): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;

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
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      throw new Error("Configuration Error: Missing SUPABASE_SERVICE_ROLE_KEY");
    }

    return createClient(url, serviceKey, {
      auth: { persistSession: false },
    });
  }
}
