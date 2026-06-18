import { Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { decodeServerFnId, logClientError } from "@/lib/client-error-log";

/**
 * Friendly fallback shown by the root errorComponent when a server function
 * call fails with 500. Decodes the failing fn name from the request URL,
 * offers Retry and a link to admin diagnostics. Replaces the previous
 * blank-screen experience for serverFn 500s.
 */
export function ServerFnErrorScreen({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  const router = useRouter();
  const [now] = useState(() => new Date());

  // Try to extract a /_serverFn/... URL from the error message.
  const { fnExport, fnFile, statusHint } = useMemo(() => parseError(error), [error]);

  useEffect(() => {
    logClientError({
      kind: "server_fn_boundary",
      message: error.message?.slice(0, 500),
      fnExport,
      fnFile,
      stack: error.stack?.slice(0, 1000),
    });
  }, [error, fnExport, fnFile]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
        <h1 className="text-xl font-semibold">Something went wrong on the server</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A backend call didn&apos;t complete. This is usually transient — try again.
        </p>

        <dl className="mt-4 space-y-1 rounded-md border border-border bg-muted/40 p-3 text-xs font-mono">
          {fnExport && (
            <div className="flex gap-2">
              <dt className="text-muted-foreground">function</dt>
              <dd className="break-all">{fnExport}</dd>
            </div>
          )}
          {fnFile && (
            <div className="flex gap-2">
              <dt className="text-muted-foreground">file</dt>
              <dd className="break-all">{fnFile}</dd>
            </div>
          )}
          {statusHint && (
            <div className="flex gap-2">
              <dt className="text-muted-foreground">status</dt>
              <dd>{statusHint}</dd>
            </div>
          )}
          <div className="flex gap-2">
            <dt className="text-muted-foreground">time</dt>
            <dd>{now.toISOString()}</dd>
          </div>
        </dl>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            Hard reload
          </button>
          <Link
            to="/admin/diagnostics"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            Diagnostics
          </Link>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            Home
          </a>
        </div>
      </div>
    </div>
  );
}

function parseError(error: Error): {
  fnExport: string | null;
  fnFile: string | null;
  statusHint: string | null;
} {
  const msg = error.message ?? "";
  const urlMatch = msg.match(/\/_serverFn\/[^\s'"`)]+/);
  const url = urlMatch?.[0] ?? "";
  const { fnExport, fnFile } = decodeServerFnId(url);
  const statusMatch = msg.match(/\b(4\d\d|5\d\d)\b/);
  return {
    fnExport,
    fnFile,
    statusHint: statusMatch ? statusMatch[1] : null,
  };
}

export function isServerFnError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /\/_serverFn\//.test(error.message ?? "");
}
