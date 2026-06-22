// Verification callback: consume the token, mark the user verified for 24h,
// and redirect them back to the original media-file page so they can click
// Download again. The page reads ?verified=1&file=<id> to auto-trigger the
// download after the redirect.
//
// IMPORTANT: the redirect target MUST use the configured public website
// domain (PUBLIC_BASE_URL), NOT the incoming request's origin — the request
// can land on a stale preview host (`id-preview--*.lovable.app`) that's not
// reachable from the user's browser session.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/v/$token")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { consumeToken } = await import("@/lib/verification.server");
        const { getPublicBaseUrlAsync, isBrokenOrigin } = await import("@/lib/site-url.server");

        const ip =
          request.headers.get("x-forwarded-for") ??
          request.headers.get("cf-connecting-ip") ??
          null;

        const result = await consumeToken({
          supabase: supabaseAdmin,
          token: params.token,
          ip,
        });

        const requestOrigin = (() => {
          try { return new URL(request.url).origin; } catch { return null; }
        })();
        const origin = await getPublicBaseUrlAsync();
        const originMismatch = requestOrigin && requestOrigin !== origin;

        // Structured log for the diagnostics panel + tail logs. Never logs PII
        // beyond the (already hashed) IP available upstream.
        const logBase = {
          tag: "verification.redirect",
          token_prefix: params.token.slice(0, 6),
          request_origin: requestOrigin,
          target_origin: origin,
          origin_mismatch: !!originMismatch,
          request_origin_broken: isBrokenOrigin(requestOrigin),
        };

        if (!result.ok) {
          const url = new URL(`${origin}/`);
          url.searchParams.set("verify_error", result.reason);
          console.warn(JSON.stringify({ ...logBase, ok: false, reason: result.reason, target: url.toString() }));
          return Response.redirect(url.toString(), 303);
        }

        // Find the title slug so we can land on the right page.
        let slug: string | null = null;
        if (result.mediaFileId) {
          const { data: f } = await supabaseAdmin
            .from("media_files")
            .select("title_id, master_titles(slug)")
            .eq("id", result.mediaFileId)
            .maybeSingle();
          slug = ((f as any)?.master_titles?.slug as string | null) ?? null;
        }

        const target = new URL(slug ? `${origin}/title/${slug}` : `${origin}/`);
        target.searchParams.set("verified", "1");
        if (result.mediaFileId) target.searchParams.set("file", result.mediaFileId);
        console.info(JSON.stringify({ ...logBase, ok: true, slug, target: target.toString() }));
        return Response.redirect(target.toString(), 303);
      },
    },
  },
});
