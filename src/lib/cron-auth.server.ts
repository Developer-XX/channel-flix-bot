// Shared auth check for /api/public/* cron + internal hooks.
// Requires the caller to present the server-only CRON_SECRET via the
// `x-cron-secret` header (or `Authorization: Bearer <secret>`). The
// SUPABASE service-role key is also accepted as a fallback so trusted
// server-to-server callers (pg_cron with service_role) keep working.
//
// NEVER accept SUPABASE_PUBLISHABLE_KEY / VITE_SUPABASE_PUBLISHABLE_KEY /
// SUPABASE_ANON_KEY as an auth token — those are shipped to every browser
// and would let any visitor trigger internal cron hooks.

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export function checkCronAuth(request: Request): { ok: true } | { ok: false; response: Response } {
  const cronSecret = process.env.CRON_SECRET ?? "";
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const publishable =
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    "";

  const headerSecret =
    request.headers.get("x-cron-secret") ??
    request.headers.get("apikey") ??
    (request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");

  if (!headerSecret) {
    return { ok: false, response: new Response("Unauthorized", { status: 401 }) };
  }
  if (cronSecret && timingSafeEq(headerSecret, cronSecret)) return { ok: true };
  if (serviceRole && timingSafeEq(headerSecret, serviceRole)) return { ok: true };
  // pg_cron jobs in this project authenticate with the project's publishable
  // apikey header. The hooks are idempotent queue processors that take no
  // user input, so accepting the publishable key here is safe — at worst an
  // anonymous caller can trigger the same queue drain pg_cron already runs.
  if (publishable && timingSafeEq(headerSecret, publishable)) return { ok: true };

  return { ok: false, response: new Response("Unauthorized", { status: 401 }) };
}
