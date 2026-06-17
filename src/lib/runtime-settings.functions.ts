import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";

// Keys editable from the admin Settings panel. is_secret hides the
// value from the client and only returns a "has value" flag.
export const SETTING_KEYS = [
  { key: "PUBLIC_BASE_URL",             group: "Domain",        isSecret: false, placeholder: "https://channel-flix-bot.lovable.app" },
  { key: "TMDB_API_KEY",                group: "TMDB",          isSecret: true,  placeholder: "v3 API key" },
  { key: "ADRINOLINKS_API_KEY",         group: "Shorteners",    isSecret: true,  placeholder: "adrinolinks.in API key" },
  { key: "NANOLINKS_API_KEY",           group: "Shorteners",    isSecret: true,  placeholder: "nanolinks.in API key" },
  { key: "VERIFICATION_WINDOW_MINUTES", group: "Verification",  isSecret: false, placeholder: "60" },
  { key: "VERIFICATION_MAX_PER_HOUR",   group: "Verification",  isSecret: false, placeholder: "10" },
  { key: "SHORTENER_TOKEN_TTL_SECONDS", group: "Verification",  isSecret: false, placeholder: "1800" },
] as const;

const KEYS = new Set(SETTING_KEYS.map((s) => s.key));
const SECRET_KEYS = new Set(SETTING_KEYS.filter((s) => s.isSecret).map((s) => s.key));

export type SettingView = {
  key: string;
  group: string;
  isSecret: boolean;
  placeholder: string;
  description: string | null;
  hasValue: boolean;
  hasEnvFallback: boolean;
  value: string | null; // null for secrets
  updatedAt: string | null;
  updatedBy: string | null;
};

export const listAppSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("app_settings")
      .select("key, value, description, updated_at, updated_by");
    if (error) throw error;
    const byKey = new Map((data ?? []).map((r: any) => [r.key, r]));
    return SETTING_KEYS.map<SettingView>((s) => {
      const row = byKey.get(s.key);
      const v: string | null = row?.value ?? null;
      const envVal = process.env[s.key];
      return {
        key: s.key,
        group: s.group,
        isSecret: s.isSecret,
        placeholder: s.placeholder,
        description: row?.description ?? null,
        hasValue: !!v,
        hasEnvFallback: !!envVal,
        value: s.isSecret ? null : v,
        updatedAt: row?.updated_at ?? null,
        updatedBy: row?.updated_by ?? null,
      };
    });
  });

export const updateAppSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      key: z.string().min(1).max(80),
      value: z.string().max(4000).nullable(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    if (!KEYS.has(data.key)) throw new Error(`Unknown setting key: ${data.key}`);
    const isSecret = SECRET_KEYS.has(data.key);
    const cleanedValue = data.value && data.value.trim() !== "" ? data.value.trim() : null;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert(
        {
          key: data.key,
          value: cleanedValue,
          is_secret: isSecret,
          updated_by: context.userId,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "key" },
      );
    if (error) throw error;
    // Best-effort audit + cache bust
    try {
      await supabaseAdmin.from("admin_audit_log").insert({
        actor_user_id: context.userId,
        actor_email: (context.claims as any)?.email ?? null,
        action: "settings.update",
        status: "success",
        metadata: { key: data.key, isSecret, hasValue: !!cleanedValue },
      } as never);
    } catch (e) {
      console.warn("[settings] audit insert failed", (e as Error).message);
    }
    const { bumpSettingsVersion } = await import("@/lib/runtime-settings.server");
    bumpSettingsVersion();
    return { ok: true };
  });
