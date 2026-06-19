import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";

export type TableDiagnostic = {
  table: string;
  rls_enabled: boolean;
  table_grants: Array<{ grantee: string; privilege: string }>;
  column_grants: Array<{ grantee: string; privilege: string; column: string }>;
  policies: Array<{ name: string; cmd: string; roles: string[]; using: string | null; check: string | null }>;
  checked_at: string;
};

// Read grants + RLS policies for a public table. Admin-gated server-side.
export const getTablePermissionDiagnostic = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ table: z.string().regex(/^[a-z0-9_]{1,63}$/) }).parse(d),
  )
  .handler(async ({ context, data }): Promise<TableDiagnostic> => {
    await requireAdminAccess(context);
    const { data: rpc, error } = await context.supabase.rpc(
      // @ts-expect-error - rpc name not yet in generated types
      "diagnose_table_permissions",
      { _table: data.table },
    );
    if (error) throw error;
    return rpc as unknown as TableDiagnostic;
  });

// Manually run the nightly drift check from the UI.
export const runTelegramIngestGrantsCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const { data, error } = await context.supabase.rpc(
      // @ts-expect-error - rpc name not yet in generated types
      "check_telegram_ingest_grants",
    );
    if (error) throw error;
    return data as { drift: boolean; missing: Array<{ role: string; privilege: string }>; actual: Record<string, string[]> };
  });
