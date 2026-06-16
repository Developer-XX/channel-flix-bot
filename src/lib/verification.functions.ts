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

    // Rate-limit: count tokens in the last hour
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await supabaseAdmin
      .from("verification_tokens")
      .select("token", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .gte("created_at", since);
    if ((count ?? 0) >= 6) {
      throw new Error("Too many verification attempts in the last hour. Please wait and try again.");
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
