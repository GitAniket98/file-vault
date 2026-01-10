import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "~~/lib/authSession";
import { rateLimit } from "~~/lib/rateLimit";

// Removed the import of "form-data" as we will use the native FormData

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, "ipfs-pin", 10, 60_000);
  if (!rl.ok) return rl.response;

  const session = getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const blob = await req.blob();
  if (!blob || blob.size === 0) {
    return NextResponse.json({ ok: false, error: "Empty file" }, { status: 400 });
  }

  if (blob.size > 5 * 1024 * 1024) {
    return NextResponse.json({ ok: false, error: "File too large" }, { status: 413 });
  }

  const jwt = process.env.PINATA_JWT!;
  if (!jwt) return NextResponse.json({ ok: false, error: "Pinata server JWT missing" });

  const form = new FormData();
  form.append("file", blob, "enc.bin");

  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });

  if (!res.ok) {
    const t = await res.text();
    return NextResponse.json({ ok: false, error: t }, { status: 500 });
  }

  const json = await res.json();
  return NextResponse.json({ ok: true, cid: json.IpfsHash });
}
