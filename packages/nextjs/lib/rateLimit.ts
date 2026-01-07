// packages/nextjs/lib/rateLimit.ts
import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export type RateLimitResult = { ok: true } | { ok: false; response: NextResponse; resetAt: number };

/**
 * IP Extraction Strategy
 * ----------------------
 * Security Critical: We must determine the client's true IP to prevent bypasses.
 * * 1. Vercel Platform (`req.ip`): The most trusted source when deployed. Vercel strips
 * headers from the client and inserts the verified edge IP.
 * * 2. X-Forwarded-For: Fallback for local dev or custom proxies. We take the *first*
 * IP in the list, assuming the first proxy in our chain is trusted to append correctly.
 */
export function getClientIp(req: NextRequest): string {
  // TypeScript workaround: .ip is injected by Vercel/Next.js edge runtime
  const ip = (req as any).ip;
  if (ip) return ip;

  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    return xff.split(",")[0].trim();
  }

  return "127.0.0.1";
}

// Singleton Redis Client
// We initialize this outside the handler to reuse the TCP/HTTP connection
// across hot lambda invocations.
const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? Redis.fromEnv() : null;

/**
 * Fallback: In-Memory Token Bucket
 * --------------------------------
 * Used when Redis is not configured or unreachable.
 * * Trade-off: This is "stateful" per serverless container.
 * If Vercel spins up 10 lambdas, a user technically gets 10x the limit.
 * This is acceptable as a fallback, but not for strict production enforcement.
 * * Implementation: Naive Fixed Window + LRU-ish cleanup.
 */
const memoryStore = new Map<string, { count: number; expiresAt: number }>();
const MEMORY_CACHE_LIMIT = 500; // Prevent memory leaks in long-running containers

function memoryRateLimit(ip: string, limit: number, windowMs: number): { success: boolean; reset: number } {
  const now = Date.now();

  // Self-Healing: Prevent map from growing indefinitely under DDoS
  if (memoryStore.size > MEMORY_CACHE_LIMIT) {
    const keysToDelete = Array.from(memoryStore.keys()).slice(0, 250);
    keysToDelete.forEach(k => memoryStore.delete(k));
  }

  const record = memoryStore.get(ip);

  // New window or expired window
  if (!record || now > record.expiresAt) {
    memoryStore.set(ip, { count: 1, expiresAt: now + windowMs });
    return { success: true, reset: now + windowMs };
  }

  // Check limit
  if (record.count >= limit) {
    return { success: false, reset: record.expiresAt };
  }

  // Increment
  record.count++;
  return { success: true, reset: record.expiresAt };
}

/**
 * Core Rate Limiter Middleware
 * * Usage:
 * await rateLimit(req, "upload-endpoint", 10, 60000);
 * * @param bucketId - Unique semantic identifier (e.g., "auth", "upload") to segregate quotas.
 * @param limit - Max requests allowed in the window.
 * @param windowMs - Duration of the sliding window in milliseconds.
 */
export async function rateLimit(
  req: NextRequest,
  bucketId: string,
  limit = 10,
  windowMs = 60_000,
): Promise<RateLimitResult> {
  // DX: Disable rate limiting in development to prevent frustration during testing.
  if (process.env.NODE_ENV !== "production") {
    return { ok: true };
  }

  const ip = getClientIp(req);
  const identifier = `${bucketId}:${ip}`;
  const now = Date.now();

  let success = true;
  let reset = now + windowMs;

  // Strategy Pattern: Prefer Distributed Redis -> Fallback to Local Memory
  if (redis) {
    try {
      // We create a lightweight limiter instance on the fly to support dynamic window sizes.
      // The heavy Redis client is reused from the global scope.
      const customLimiter = new Ratelimit({
        redis: redis,
        // Sliding Window is fairer than Fixed Window (prevents "bursts" at boundary edges)
        limiter: Ratelimit.slidingWindow(limit, `${windowMs} ms` as any),
        analytics: true,
        prefix: "fv_ratelimit",
      });

      const result = await customLimiter.limit(identifier);
      success = result.success;
      reset = result.reset;
    } catch (err) {
      console.error("[RateLimit] Redis failed, falling back to memory:", err);
      // Fail-open or Fail-closed? Here we fail-open to memory to keep the app alive.
      const result = memoryRateLimit(identifier, limit, windowMs);
      success = result.success;
      reset = result.reset;
    }
  } else {
    // No Redis config present
    const result = memoryRateLimit(identifier, limit, windowMs);
    success = result.success;
    reset = result.reset;
  }

  if (!success) {
    return {
      ok: false,
      resetAt: reset,
      response: NextResponse.json(
        { ok: false, error: "Too many requests. Please slow down." },
        {
          status: 429,
          headers: {
            "Retry-After": Math.ceil((reset - Date.now()) / 1000).toString(),
            "X-RateLimit-Limit": limit.toString(),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": reset.toString(),
          },
        },
      ),
    };
  }

  return { ok: true };
}
