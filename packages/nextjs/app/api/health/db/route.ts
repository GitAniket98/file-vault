// packages/nextjs/app/api/health/db/route.ts
import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "~~/lib/rateLimit";
import { createSupabaseServerClient } from "~~/lib/supabaseServer";

type RowCountResult = { count: number | null; error: string | null };

async function countRows(table: string): Promise<RowCountResult> {
  const supabase = createSupabaseServerClient();
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });

  return {
    count: count ?? 0,
    error: error ? error.message : null,
  };
}

export async function GET(req: NextRequest) {
  // ✅ FIX: Use the new async pattern for rate limiting
  const limitResult = await rateLimit(req, "health-db", 10, 60_000);

  // If rate limit failed (ok: false), return the error response immediately
  if (!limitResult.ok && limitResult.response) {
    return limitResult.response;
  }

  try {
    const [fileRes, wrappedRes, auditRes] = await Promise.all([
      countRows("File"),
      countRows("WrappedKey"),
      countRows("AuditLog"),
    ]);

    return NextResponse.json({
      ok: true,
      results: {
        file: fileRes,
        wrapped: wrappedRes,
        audit: auditRes,
      },
    });
  } catch (e: any) {
    console.error("GET /api/health/db error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Health check failed" }, { status: 500 });
  }
}
