import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "~~/lib/authSession";
import { rateLimit } from "~~/lib/rateLimit";

// Max file size for this endpoint (5MB)
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export async function POST(req: NextRequest) {
  // 1. Rate Limit (Stricter for uploads)
  const rl = await rateLimit(req, "ipfs-pin", 10, 60_000);
  if (!rl.ok) return rl.response;

  // 2. Auth Check
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // 3. Validate File
  let blob: Blob;
  try {
    blob = await req.blob();
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Invalid upload data" }, { status: 400 });
  }

  if (!blob || blob.size === 0) {
    return NextResponse.json({ ok: false, error: "Empty file" }, { status: 400 });
  }

  if (blob.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ ok: false, error: "File exceeds 5MB limit" }, { status: 413 });
  }

  // 4. Pin to Pinata
  const jwt = process.env.PINATA_JWT?.trim();
  if (!jwt) {
    console.error("Missing PINATA_JWT in environment");
    return NextResponse.json({ ok: false, error: "Server configuration error" }, { status: 500 });
  }

  try {
    const form = new FormData();
    form.append("file", blob, "enc.bin");

    const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}` },
      body: form,
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[ipfs-pin] Pinata Error (${res.status}): ${text}`);
      return NextResponse.json({ ok: false, error: "IPFS Pinning Failed" }, { status: 502 });
    }

    const json = await res.json();
    return NextResponse.json({ ok: true, cid: json.IpfsHash });
  } catch (e: any) {
    console.error("[ipfs-pin] Network Error:", e);
    return NextResponse.json({ ok: false, error: "Upload failed due to network error" }, { status: 500 });
  }
}
