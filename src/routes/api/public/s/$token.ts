// Dedicated shortener-side redirect endpoint.
//
// Unlike /api/public/v/:token (which always 303-redirects and is meant for
// the actual user verification flow), /api/public/s/:token returns a
// structured JSON response on failure so AdrinoLinks/NanoLinks health
// checks and admin diagnostics get the exact failure reason — instead of
// the generic "Opening Link in Chrome…" HTML the shorteners wrap around
// real redirects.
//
//   GET /api/public/s/:token?debug=1
//   GET /api/public/s/:token        + Accept: application/json
//     -> 200 application/json { ok, reason, missingField, targetUrl }
//
//   GET /api/public/s/:token        (browser)
//     -> 303 redirect to target (or to / with ?verify_error=… on failure)

import { createFileRoute } from "@tanstack/react-router";

type Reason =
  | "ok"
  | "token_missing"
  | "token_invalid"
  | "token_expired"
  | "token_consumed"
  | "ip_mismatch"
  | "source_missing"
  | "internal_error";

function wantsJson(request: Request): boolean {
  const u = new URL(request.url);
  if (u.searchParams.get("debug") === "1") return true;
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("application/json");
}

export const Route = createFileRoute("/api/public/s/$token")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const json = wantsJson(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { consumeToken } = await import("@/lib/verification.server");
        const { getPublicBaseUrlAsync } = await import("@/lib/site-url.server");

        const ip =
          request.headers.get("x-forwarded-for") ??
          request.headers.get("cf-connecting-ip") ??
          null;

        const respond = async (
          status: number,
          payload: { ok: boolean; reason: Reason; missingField?: string | null; targetUrl?: string | null },
        ) => {
          if (json) {
            return new Response(JSON.stringify(payload), {
              status,
              headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
            });
          }
          const origin = await getPublicBaseUrlAsync();
          if (payload.ok && payload.targetUrl) return Response.redirect(payload.targetUrl, 303);
          const u = new URL(`${origin}/`);
          u.searchParams.set("verify_error", payload.reason);
          if (payload.missingField) u.searchParams.set("missing", payload.missingField);
          return Response.redirect(u.toString(), 303);
        };

        if (!params.token || params.token.length < 6) {
          return respond(400, { ok: false, reason: "token_missing", missingField: "token" });
        }

        try {
          const result = await consumeToken({ supabase: supabaseAdmin, token: params.token, ip });

          if (!result.ok) {
            const reason: Reason =
              result.reason === "not_found" ? "token_invalid" :
              result.reason === "expired" ? "token_expired" :
              result.reason === "already_used" ? "token_consumed" :
              result.reason === "ip_mismatch" ? "ip_mismatch" : "token_invalid";
            // Audit
            try {
              await supabaseAdmin.from("admin_audit_log").insert({
                action: "shortener.redirect",
                status: "failed",
                metadata: { reason, token_prefix: params.token.slice(0, 6) },
              } as never);
            } catch {}
            return respond(410, { ok: false, reason, targetUrl: null });
          }

          // Build target URL — must use the configured public domain.
          let slug: string | null = null;
          if (result.mediaFileId) {
            const { data: f } = await supabaseAdmin
              .from("media_files")
              .select("title_id, master_titles(slug)")
              .eq("id", result.mediaFileId)
              .maybeSingle();
            slug = ((f as any)?.master_titles?.slug as string | null) ?? null;
          }
          const origin = await getPublicBaseUrlAsync();
          if (!origin) {
            return respond(500, { ok: false, reason: "source_missing", missingField: "PUBLIC_BASE_URL" });
          }
          const target = new URL(slug ? `${origin}/title/${slug}` : `${origin}/`);
          target.searchParams.set("verified", "1");
          if (result.mediaFileId) target.searchParams.set("file", result.mediaFileId);

          try {
            await supabaseAdmin.from("admin_audit_log").insert({
              action: "shortener.redirect",
              status: "success",
              metadata: { token_prefix: params.token.slice(0, 6), slug, mediaFileId: result.mediaFileId },
            } as never);
          } catch {}

          return respond(200, { ok: true, reason: "ok", targetUrl: target.toString() });
        } catch (e: any) {
          console.error("[shortener-redirect] internal error", e);
          return respond(500, {
            ok: false,
            reason: "internal_error",
            missingField: e?.message ?? null,
            targetUrl: null,
          });
        }
      },
    },
  },
});
