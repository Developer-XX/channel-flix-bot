import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { serverFnErrorLogger } from "@/lib/server-fn-error-logger";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    // Re-throw framework redirects / notFound (they carry a Response or are
    // handled by the router). Everything else we convert to a 5xx Response
    // here — never re-throw, otherwise the outer handler complains that no
    // response was returned ("forgot to return a response from your server
    // route handler").
    if (error instanceof Response) return error;
    const msg = error instanceof Error ? error.message : String(error);
    const isUnauthorized = /^Unauthorized\b/i.test(msg);
    if (!isUnauthorized) console.error(error);
    if (isUnauthorized) {
      return new Response(JSON.stringify({ error: msg }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  // attachSupabaseAuth must run first (so the bearer is attached for
  // requireSupabaseAuth); the error logger wraps everything beneath.
  functionMiddleware: [attachSupabaseAuth, serverFnErrorLogger],
  requestMiddleware: [errorMiddleware],
}));
