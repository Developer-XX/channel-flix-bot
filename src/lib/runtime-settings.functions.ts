import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";

// Keys editable from the admin Settings panel. is_secret hides the
// value from the client and only returns a "has value" flag.
export const SETTING_KEYS = [
  { key: "PUBLIC_BASE_URL",             group: "Domain",        isSecret: false, placeholder: "https://channel-flix-bot.lovable.app" },
  { key: "TELEGRAM_BOT_TOKEN",          group: "Telegram",      isSecret: true,  placeholder: "123456:ABC-DEF... (overrides env)" },
  { key: "TMDB_API_KEY",                group: "TMDB",          isSecret: true,  placeholder: "v3 API key" },
  { key: "ADRINOLINKS_API_KEY",         group: "Shorteners",    isSecret: true,  placeholder: "adrinolinks.in API key" },
  { key: "NANOLINKS_API_KEY",           group: "Shorteners",    isSecret: true,  placeholder: "nanolinks.in API key" },
  { key: "AROLINKS_API_KEY",            group: "Shorteners",    isSecret: true,  placeholder: "arolinks.com API key" },
  { key: "LINKPAYS_API_KEY",            group: "Shorteners",    isSecret: true,  placeholder: "linkpays.in API key" },
  { key: "SHORTENER_ENABLED_ADRINOLINKS", group: "Shorteners",  isSecret: false, placeholder: "true / false (default true)" },
  { key: "SHORTENER_ENABLED_NANOLINKS",   group: "Shorteners",  isSecret: false, placeholder: "true / false (default true)" },
  { key: "SHORTENER_ENABLED_AROLINKS",    group: "Shorteners",  isSecret: false, placeholder: "true / false (default false)" },
  { key: "SHORTENER_ENABLED_LINKPAYS",    group: "Shorteners",  isSecret: false, placeholder: "true / false (default false)" },
  { key: "SHORTENER_ROTATION_HOURS",      group: "Shorteners",  isSecret: false, placeholder: "24 (hours a verification stays valid AND each provider stays active per user)" },
  { key: "DOWNLOAD_RESEND_COOLDOWN_SECONDS", group: "Downloads", isSecret: false, placeholder: "8 (min seconds between repeat sends of the same file)" },
  { key: "DOWNLOAD_AUTO_DELETE_VALUE",    group: "Downloads",   isSecret: false, placeholder: "30 (auto-delete delivered file from user's chat after this many units; 0 disables)" },
  { key: "DOWNLOAD_CAPTION_TIP",          group: "Downloads",   isSecret: false, placeholder: "Player tip appended to the delivered file caption. Leave blank to use the default MX Player / VLC tip." },
  { key: "FORCE_JOIN_ENABLED",            group: "Force Join",  isSecret: false, placeholder: "true / false — require users to join the main channel before bot delivers files" },
  { key: "FORCE_JOIN_CHANNEL",            group: "Force Join",  isSecret: false, placeholder: "@your_channel or -1001234567890 (bot must be admin so it can call getChatMember)" },
  { key: "FORCE_JOIN_CHANNEL_URL",        group: "Force Join",  isSecret: false, placeholder: "https://t.me/your_channel (link shown to users who haven't joined)" },
  { key: "FORCE_JOIN_CHANNEL_TITLE",      group: "Force Join",  isSecret: false, placeholder: "Display name shown in the join prompt (e.g. StreamVault Official)" },
  { key: "DOWNLOAD_AUTO_DELETE_UNIT",     group: "Downloads",   isSecret: false, placeholder: "minutes (one of: seconds, minutes, hours)" },
  { key: "VERIFICATION_WINDOW_MINUTES", group: "Verification",  isSecret: false, placeholder: "60" },
  { key: "VERIFICATION_MAX_PER_HOUR",   group: "Verification",  isSecret: false, placeholder: "10" },
  { key: "SHORTENER_TOKEN_TTL_SECONDS", group: "Verification",  isSecret: false, placeholder: "1800" },
  { key: "VERIFICATION_GRACE_DAYS",     group: "Verification",  isSecret: false, placeholder: "2 (days new users skip token verification, 0 to disable)" },
  { key: "TUTORIAL_ENABLED",            group: "Tutorial",      isSecret: false, placeholder: "true / false" },
  { key: "TUTORIAL_VIDEO_TYPE",         group: "Tutorial",      isSecret: false, placeholder: "youtube | mp4 | storage" },
  { key: "TUTORIAL_VIDEO_URL",          group: "Tutorial",      isSecret: false, placeholder: "https://youtu.be/... or https://.../video.mp4" },
  { key: "TUTORIAL_TITLE",              group: "Tutorial",      isSecret: false, placeholder: "How to download (shown at bottom of every title)" },
  { key: "TUTORIAL_DESCRIPTION",        group: "Tutorial",      isSecret: false, placeholder: "Short description shown above the video" },
  { key: "PREMIUM_ENABLED",             group: "Premium",       isSecret: false, placeholder: "true / false (default true)" },
  { key: "PREMIUM_UPI_ID",              group: "Premium",       isSecret: false, placeholder: "yourname@upi" },
  { key: "PREMIUM_UPI_NAME",            group: "Premium",       isSecret: false, placeholder: "Payee name shown to users" },
  { key: "PREMIUM_QR_URL",              group: "Premium",       isSecret: false, placeholder: "https://.../qr.png" },
  { key: "PREMIUM_INSTRUCTIONS",        group: "Premium",       isSecret: false, placeholder: "Short note shown above the QR code" },
  { key: "SHORTENER_ALERT_THRESHOLD",   group: "Alerts",        isSecret: false, placeholder: "0.4 (failure rate 0-1)" },
  { key: "SHORTENER_ALERT_MIN_SAMPLES", group: "Alerts",        isSecret: false, placeholder: "5 (min samples before alerting)" },
  { key: "SHORTENER_ALERT_WINDOW_MIN",  group: "Alerts",        isSecret: false, placeholder: "30 (freshness window minutes)" },
  { key: "ALERT_TELEGRAM_CHAT_ID",      group: "Alerts",        isSecret: false, placeholder: "Telegram chat id for admin alerts" },
  { key: "HOMEPAGE_SLIDESHOW_ENABLED",  group: "Homepage",      isSecret: false, placeholder: "true / false (default true)" },
  { key: "HOMEPAGE_SECTION_ORDER",      group: "Homepage",      isSecret: false, placeholder: "trending,latest,movies,series,anime,kdrama" },
  { key: "PUBLIC_BROWSING_ENABLED",     group: "Browsing",      isSecret: false, placeholder: "true (anyone can browse titles) / false (sign-in required to view titles)" },
  { key: "ADS_ENABLED",                 group: "Ads",           isSecret: false, placeholder: "true / false (premium users never see ads)" },
  { key: "AD_INTERSTITIAL_ENABLED",     group: "Ads",           isSecret: false, placeholder: "true / false — show full-screen video interstitials" },
  { key: "AD_INTERSTITIAL_ON_LOGIN",    group: "Ads",           isSecret: false, placeholder: "true / false — show one right after sign-in / register" },
  { key: "AD_INTERSTITIAL_CANCEL_SECONDS", group: "Ads",        isSecret: false, placeholder: "12 (3–60) seconds before cancel button appears" },
  { key: "AD_INTERSTITIAL_PERIODIC_MINUTES", group: "Ads",      isSecret: false, placeholder: "120 minutes between periodic interstitials (0 disables)" },
  { key: "AD_INTERSTITIAL_BEFORE_DOWNLOAD_COOLDOWN_MINUTES", group: "Ads", isSecret: false, placeholder: "120 minutes minimum gap between before-download interstitials" },
] as const;

const KEYS: Set<string> = new Set(SETTING_KEYS.map((s) => s.key));
const SECRET_KEYS: Set<string> = new Set(SETTING_KEYS.filter((s) => s.isSecret).map((s) => s.key));

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
