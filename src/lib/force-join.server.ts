// Shared helper to evaluate whether a user satisfies all (or any) of the
// configured force-join Telegram channels before a file is delivered.
//
// Selection rules:
// 1. Active rows from public.force_join_channels matching the file's category
//    (an empty categories[] = "applies to every category").
// 2. If no DB rows match, fall back to the legacy single-channel settings
//    (FORCE_JOIN_CHANNEL / FORCE_JOIN_CHANNEL_URL / FORCE_JOIN_CHANNEL_TITLE)
//    so existing deployments keep working without re-configuration.

export type ForceJoinChannelCheck = {
  id: string;
  title: string;
  chatId: string;
  inviteUrl: string | null;
  status: "joined" | "not_joined" | "check_failed";
  memberStatus?: string | null;
  error?: string;
};

export type ForceJoinCheckResult = {
  enabled: boolean;
  required: boolean;
  passed: boolean;
  rule: "and" | "or";
  channels: ForceJoinChannelCheck[];
};

function deriveJoinUrl(chatId: string, explicit: string | null | undefined): string {
  if (explicit && explicit.trim()) return explicit.trim();
  const v = chatId.trim();
  if (v.startsWith("@")) return `https://t.me/${v.slice(1)}`;
  return "";
}

export async function evaluateForceJoin(args: {
  supabaseAdmin: any;
  telegramUserId: number;
  category: string | null;
}): Promise<ForceJoinCheckResult> {
  const { supabaseAdmin, telegramUserId, category } = args;
  const { getSetting } = await import("@/lib/runtime-settings.server");

  const enabledRaw = (await getSetting("FORCE_JOIN_ENABLED")) ?? "";
  const enabled = /^(1|true|yes|on)$/i.test(enabledRaw.trim());
  if (!enabled) {
    return { enabled: false, required: false, passed: true, rule: "and", channels: [] };
  }

  const ruleRaw = ((await getSetting("FORCE_JOIN_RULE")) ?? "and").toLowerCase().trim();
  const rule: "and" | "or" = ruleRaw === "or" ? "or" : "and";

  // 1) Try the multi-channel table.
  const { data: rows } = await supabaseAdmin
    .from("force_join_channels")
    .select("id, title, chat_id, invite_url, categories, priority")
    .eq("is_active", true)
    .order("priority", { ascending: false });

  let candidates: Array<{ id: string; title: string; chat_id: string; invite_url: string | null; categories: string[] }> = (rows ?? []).filter((r: any) => {
    const cats: string[] = Array.isArray(r.categories) ? r.categories : [];
    if (cats.length === 0) return true; // global rule
    if (!category) return false; // category-scoped rule but file has no category
    return cats.includes(category);
  });

  // 2) Legacy fallback (single-channel settings) when nothing matched.
  if (candidates.length === 0) {
    const legacyChannel = ((await getSetting("FORCE_JOIN_CHANNEL")) ?? "").trim();
    if (legacyChannel) {
      const legacyUrl = ((await getSetting("FORCE_JOIN_CHANNEL_URL")) ?? "").trim();
      const legacyTitle = ((await getSetting("FORCE_JOIN_CHANNEL_TITLE")) ?? legacyChannel).trim();
      candidates = [{
        id: `legacy:${legacyChannel}`,
        title: legacyTitle || legacyChannel,
        chat_id: legacyChannel,
        invite_url: legacyUrl || null,
        categories: [],
      }];
    }
  }

  if (candidates.length === 0) {
    return { enabled: true, required: false, passed: true, rule, channels: [] };
  }

  const { getChatMember } = await import("@/lib/telegram-api.server");
  const checks: ForceJoinChannelCheck[] = [];
  for (const c of candidates) {
    const inviteUrl = deriveJoinUrl(c.chat_id, c.invite_url);
    try {
      const member: any = await getChatMember(c.chat_id, telegramUserId);
      const ms: string | null = member?.status ?? null;
      const isMember = !!ms && !["left", "kicked"].includes(ms);
      checks.push({
        id: c.id,
        title: c.title,
        chatId: c.chat_id,
        inviteUrl: inviteUrl || null,
        status: isMember ? "joined" : "not_joined",
        memberStatus: ms,
      });
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      checks.push({
        id: c.id,
        title: c.title,
        chatId: c.chat_id,
        inviteUrl: inviteUrl || null,
        status: "check_failed",
        error: msg.slice(0, 300),
      });
    }
  }

  // AND: every channel must be joined (a check_failed counts as not joined so we
  // fail closed). OR: at least one joined channel is enough.
  const joined = checks.filter((c) => c.status === "joined");
  const passed = rule === "or" ? joined.length > 0 : joined.length === checks.length;

  return { enabled: true, required: true, passed, rule, channels: checks };
}
