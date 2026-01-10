// packages/nextjs/app/api/users/check/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "~~/lib/supabaseServer";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const walletAddr = searchParams.get("walletAddr");

    if (!walletAddr) {
      return NextResponse.json({ error: "Missing walletAddr" }, { status: 400 });
    }

    // Use admin client to bypass RLS for this simple existence check
    const { data, error } = await supabaseAdmin
      .from("User")
      .select("did")
      .eq("wallet_addr", walletAddr.toLowerCase())
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 is "Row not found"
      console.error("User check error:", error);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    // If data exists, they are registered
    return NextResponse.json({ registered: !!data, did: data?.did || null });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
