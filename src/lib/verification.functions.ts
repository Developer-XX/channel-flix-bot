// Server functions exposed to the client for the verification gate.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getVerificationStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getVerificationState } = await import("@/lib/verification.server");
    const st = await getVerificationState(context.supabase, context.userId);
    return st;
  });

export const startVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ mediaFileId: z.string().uuid().nullable().optional() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { startVerificationForUser } = await import("@/lib/verification.server");
    const { getVerificationConfig } = await import("@/lib/config.server");

    const { maxPerWindow, windowMs } = getVerificationConfig();
    const since = new Date(Date.now() - windowMs).toISOString();

    // Soft per-user throttle: count only tokens actually consumed in window.
    const { data: rows } = await supabaseAdmin
      .from("verification_tokens")
      .select("created_at")
      .eq("user_id", context.userId)
      .gte("created_at", since)
      .not("consumed_at", "is", null)
      .order("created_at", { ascending: true });

    const used = rows?.length ?? 0;
    if (used >= maxPerWindow) {
      // earliest attempt determines when cap resets
      const earliest = rows![0].created_at as unknown as string;
      const retryAfterMs = Math.max(
        0,
        new Date(earliest).getTime() + windowMs - Date.now(),
      );
      // Audit the rejection with token/file context (no secrets).
      await supabaseAdmin.from("verification_provider_calls").insert({
        user_id: context.userId,
        provider: "n/a",
        status: "rate_limited",
        short_url_returned: false,
        error: JSON.stringify({
          mediaFileId: data.mediaFileId ?? null,
          used,
          capacity: maxPerWindow,
          windowMs,
          retryAfterMs,
        }).slice(0, 300),
      });
      // Encode structured payload in message so client can parse & backoff.
      throw new Error(
        "RATE_LIMITED:" +
          JSON.stringify({
            code: "rate_limited",
            retryAfterMs,
            capacity: maxPerWindow,
            used,
          }),
      );
    }

    let ip: string | null = null;
    try {
      const { getRequestIP } = await import("@tanstack/react-start/server");
      ip = getRequestIP({ xForwardedFor: true }) ?? null;
    } catch { /* not in a request context */ }

    const out = await startVerificationForUser({
      supabase: supabaseAdmin,
      userId: context.userId,
      mediaFileId: data.mediaFileId ?? null,
      ip,
    });
    return out;
  });
