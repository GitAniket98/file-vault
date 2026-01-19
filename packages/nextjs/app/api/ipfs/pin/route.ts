// packages/nextjs/app/api/ipfs/pin/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "~~/lib/authSession";
import { rateLimit } from "~~/lib/rateLimit";

// Max file size for this endpoint (5MB)
const MAX_SIZE_BYTES = parseInt(process.env.NEXT_PUBLIC_MAX_UPLOAD_SIZE_MB || "5") * 1024 * 1024;

// Retry helper with timeout and exponential backoff
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3,
  timeoutMs = 60000, // 60 seconds
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response;
    } catch (error: any) {
      const isLastAttempt = attempt === maxRetries;
      const isTimeout = error.name === "AbortError" || error.code === "ETIMEDOUT";

      console.log(`[ipfs-pin] Attempt ${attempt + 1}/${maxRetries + 1} failed:`, isTimeout ? "Timeout" : error.message);

      if (isLastAttempt) {
        throw error;
      }

      // Exponential backoff: 2s, 4s, 8s
      const backoffMs = Math.pow(2, attempt + 1) * 1000;
      console.log(`[ipfs-pin] Retrying in ${backoffMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }

  throw new Error("Max retries exceeded");
}

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
  } catch {
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
    console.error("[ipfs-pin] Missing PINATA_JWT in environment");
    return NextResponse.json({ ok: false, error: "Server configuration error" }, { status: 500 });
  }

  try {
    console.log(`[ipfs-pin] Starting upload: ${blob.size} bytes`);

    const form = new FormData();
    form.append("file", blob, "enc.bin");

    // Use retry logic with longer timeout
    const res = await fetchWithRetry(
      "https://api.pinata.cloud/pinning/pinFileToIPFS",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
        body: form,
      },
      3, // 3 retries
      60000, // 60 second timeout per attempt
    );

    if (!res.ok) {
      const text = await res.text();
      console.error(`[ipfs-pin] Pinata Error (${res.status}):`, text);
      return NextResponse.json({ ok: false, error: "IPFS Pinning Failed" }, { status: 502 });
    }

    const json = await res.json();
    console.log(`[ipfs-pin] ✅ Success! CID: ${json.IpfsHash}`);

    return NextResponse.json({ ok: true, cid: json.IpfsHash });
  } catch (e: any) {
    console.error("[ipfs-pin] Error:", e);

    // Provide specific error messages
    if (e.name === "AbortError" || e.code === "ETIMEDOUT") {
      return NextResponse.json(
        {
          ok: false,
          error: "Upload timeout. The file is taking too long to upload. Please check your connection and try again.",
        },
        { status: 504 },
      );
    }

    if (e.code === "ENOTFOUND" || e.code === "ECONNREFUSED") {
      return NextResponse.json(
        {
          ok: false,
          error: "Cannot reach IPFS service. Please try again in a few moments.",
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: "Upload failed due to network error. Please try again.",
      },
      { status: 500 },
    );
  }
}
