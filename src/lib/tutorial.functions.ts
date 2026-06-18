// Public read of tutorial video configuration (no auth required).
// Safe to expose: only non-secret tutorial keys are returned.
import { createServerFn } from "@tanstack/react-start";

export type TutorialConfig = {
  enabled: boolean;
  type: "youtube" | "mp4" | "storage" | null;
  url: string | null;
  title: string;
  description: string | null;
};

export const getTutorialConfig = createServerFn({ method: "GET" }).handler(async () => {
  const { getSetting } = await import("@/lib/runtime-settings.server");
  const [enabledRaw, typeRaw, url, title, description] = await Promise.all([
    getSetting("TUTORIAL_ENABLED"),
    getSetting("TUTORIAL_VIDEO_TYPE"),
    getSetting("TUTORIAL_VIDEO_URL"),
    getSetting("TUTORIAL_TITLE"),
    getSetting("TUTORIAL_DESCRIPTION"),
  ]);
  const enabled = enabledRaw == null
    ? !!url
    : /^(1|true|yes|on)$/i.test(String(enabledRaw).trim());
  const t = (typeRaw ?? "").toLowerCase();
  const type: TutorialConfig["type"] =
    t === "youtube" || t === "mp4" || t === "storage"
      ? (t as TutorialConfig["type"])
      : url
        ? /youtu\.?be/i.test(url) ? "youtube" : "mp4"
        : null;
  return {
    enabled: enabled && !!url,
    type,
    url: url ?? null,
    title: title?.trim() || "How to download",
    description: description?.trim() || null,
  } satisfies TutorialConfig;
});
