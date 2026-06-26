// Public read of support-group + download preflight configuration.
// Safe to expose — only non-secret, user-facing strings.
import { createServerFn } from "@tanstack/react-start";

export type SupportGroupConfig = {
  enabled: boolean;
  url: string | null;
  title: string;
  description: string | null;
};

export type DownloadPreflightConfig = {
  tutorial: {
    enabled: boolean;
    type: "youtube" | "mp4" | "storage" | null;
    url: string | null;
    title: string;
    description: string | null;
  };
  rotationHours: number;
  supportGroup: SupportGroupConfig;
};

function parseBool(v: string | null, fallback: boolean): boolean {
  if (v == null) return fallback;
  return /^(1|true|yes|on)$/i.test(String(v).trim());
}

async function readSupport(): Promise<SupportGroupConfig> {
  const { getSetting } = await import("@/lib/runtime-settings.server");
  const { parseTelegramLink } = await import("@/lib/telegram-link");
  const [enabledRaw, urlRaw, title, description] = await Promise.all([
    getSetting("SUPPORT_GROUP_ENABLED"),
    getSetting("SUPPORT_GROUP_URL"),
    getSetting("SUPPORT_GROUP_TITLE"),
    getSetting("SUPPORT_GROUP_DESCRIPTION"),
  ]);
  // Normalize + validate the configured URL. Invalid or non-Telegram URLs are
  // treated as "no link configured" so the popup/preflight can degrade gracefully.
  const info = parseTelegramLink(urlRaw);
  const cleanUrl = info.valid && info.https ? info.https : null;
  const enabled = parseBool(enabledRaw, !!cleanUrl) && !!cleanUrl;
  return {
    enabled,
    url: cleanUrl,
    title: title?.trim() || "Join our Help & Support Group",
    description:
      description?.trim() ||
      "Get fast help, request titles, and stay updated — join our Telegram support group.",
  };
}

export const getSupportGroupConfig = createServerFn({ method: "GET" }).handler(
  async () => await readSupport(),
);

export const getDownloadPreflightConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<DownloadPreflightConfig> => {
    const { getSetting, getSettingNumber } = await import("@/lib/runtime-settings.server");
    const [enabledRaw, typeRaw, url, title, description, rotationHours, supportGroup] =
      await Promise.all([
        getSetting("TUTORIAL_ENABLED"),
        getSetting("TUTORIAL_VIDEO_TYPE"),
        getSetting("TUTORIAL_VIDEO_URL"),
        getSetting("TUTORIAL_TITLE"),
        getSetting("TUTORIAL_DESCRIPTION"),
        getSettingNumber("SHORTENER_ROTATION_HOURS", 24),
        readSupport(),
      ]);
    const enabled = enabledRaw == null ? !!url : parseBool(enabledRaw, false);
    const t = (typeRaw ?? "").toLowerCase();
    const type =
      t === "youtube" || t === "mp4" || t === "storage"
        ? (t as "youtube" | "mp4" | "storage")
        : url
          ? /youtu\.?be/i.test(url) ? "youtube" : "mp4"
          : null;
    return {
      tutorial: {
        enabled: enabled && !!url,
        type,
        url: url ?? null,
        title: title?.trim() || "How to download",
        description: description?.trim() || null,
      },
      rotationHours: Math.max(1, Math.round(rotationHours || 24)),
      supportGroup,
    };
  },
);
