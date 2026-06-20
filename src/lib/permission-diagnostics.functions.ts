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

export const getTablePermissionDiagnostic = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ table: z.string().regex(/^[a-z0-9_]{1,63}$/) }).parse(d),
  )
  .handler(async ({ context, data }): Promise<TableDiagnostic> => {
    await requireAdminAccess(context);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: out, error } = await (context.supabase as any).rpc("diagnose_table_permissions", { _table: data.table });
    if (error) throw error as Error;
    return out as TableDiagnostic;
  });

export const runTelegramIngestGrantsCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (context.supabase as any).rpc("check_telegram_ingest_grants");
    if (error) throw error as Error;
    return data as { drift: boolean; missing: Array<{ role: string; privilege: string }>; actual: Record<string, string[]> };
  });
