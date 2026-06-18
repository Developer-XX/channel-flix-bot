// Global server-function middleware that times every server-fn call,
// generates a request id, and routes failures through the centralized
// server logger (which writes to admin_error_log).
//
// Registered in src/start.ts.

import { createMiddleware } from "@tanstack/react-start";

export const serverFnErrorLogger = createMiddleware({ type: "function" }).server(
  async ({ next, context }) => {
    const { logServerFnRequest, newRequestId } = await import("./server-logger.server");
    const requestId = newRequestId();
    const startedAt = Date.now();
    const ctx = context as { userId?: string | null } | undefined;
    try {
      const result = await next();
      void logServerFnRequest(
        {
          requestId,
          fnExport: null,
          userId: ctx?.userId ?? null,
          status: 200,
          durationMs: Date.now() - startedAt,
        },
        false,
      );
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      void logServerFnRequest(
        {
          requestId,
          fnExport: null,
          userId: ctx?.userId ?? null,
          status: 500,
          durationMs: Date.now() - startedAt,
          message: err.message,
          stack: err.stack,
        },
        true,
      );
      throw error;
    }
  },
);
