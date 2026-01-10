// packages/nextjs/app/api/auth/logout/route.ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST() {
  const cookieStore = await cookies();

  // Delete the session cookie
  // We must match the path and secure flags used during creation
  cookieStore.delete("auth-token");

  return NextResponse.json({ ok: true });
}
