// Verification callback: consume the token, mark the user verified for 24h,
// and redirect them back to the original media-file page so they can click
// Download again. The page reads ?verified=1&file=<id> to auto-trigger the
// download after the redirect.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/v/$token")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { consumeToken } = await import("@/lib/verification.server");

        const ip =
          request.headers.get("x-forwarded-for") ??
          request.headers.get("cf-connecting-ip") ??
          null;

        const result = await consumeToken({
          supabase: supabaseAdmin,
          token: params.token,
          ip,
        });

        const origin = new URL(request.url).origin;

        if (!result.ok) {
          const url = new URL(`${origin}/`);
          url.searchParams.set("verify_error", result.reason);
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
        return Response.redirect(target.toString(), 303);
      },
    },
  },
});
