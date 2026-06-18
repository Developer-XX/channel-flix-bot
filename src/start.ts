import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { serverFnErrorLogger } from "@/lib/server-fn-error-logger";

/**
 * Map an arbitrary error to an HTTP status + machine code.
 * Centralized so /_serverFn/* RPC responses are predictable.
 */
function classifyError(error: unknown): { status: number; code: string; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (/^Unauthorized\b/i.test(message)) return { status: 401, code: "unauthorized", message };
  if (/^Forbidden\b/i.test(message)) return { status: 403, code: "forbidden", message };
  if (/^Not ?Found\b/i.test(message)) return { status: 404, code: "not_found", message };
  if (/\brate ?limit\b/i.test(message)) return { status: 429, code: "rate_limited", message };
  if (/\b(validation|invalid input|zoderror)\b/i.test(message)) {
    return { status: 400, code: "bad_request", message };
  }
  return { status: 500, code: "internal_error", message };
}

const errorMiddleware = createMiddleware().server(async ({ next, request }) => {
  try {
    return await next();
  } catch (error) {
    // Pass through framework Responses (redirects, notFound, raw Response throws).
    if (error instanceof Response) return error;

    const { status, code, message } = classifyError(error);
    if (status >= 500) console.error("[errorMiddleware]", error);

    // Server-function RPC requests MUST receive a JSON envelope — the TanStack
    // RPC client parses the body as JSON and otherwise resolves to `undefined`,
    // which surfaces in callers as "can't access property X, r is undefined".
    const url = (() => {
      try {
        return new URL(request.url);
      } catch {
        return null;
      }
    })();
    const isServerFn = url ? url.pathname.startsWith("/_serverFn/") : false;
    const wantsJson =
      isServerFn ||
      (request.headers.get("accept") ?? "").includes("application/json") ||
      (request.headers.get("content-type") ?? "").includes("application/json");

    if (wantsJson) {
      return new Response(
        JSON.stringify({
          error: code,
          message,
          status,
          timestamp: new Date().toISOString(),
        }),
        { status, headers: { "content-type": "application/json; charset=utf-8" } },
      );
    }

    return new Response(renderErrorPage(), {
      status,
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
