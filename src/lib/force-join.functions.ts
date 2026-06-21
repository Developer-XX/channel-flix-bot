// Admin CRUD for multi-channel force-join configuration.
// Each row is one Telegram channel users must join. Optional categories[]
// scopes the requirement to certain content categories ("movie", "anime", ...).
// An empty categories[] means the rule applies to every category.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";

const CATEGORY = z.enum(["movie", "series", "anime", "cartoon", "kdrama", "documentary"]);

export type ForceJoinChannelRow = {
  id: string;
  title: string;
  chat_id: string;
  invite_url: string | null;
  categories: string[];
  rule_group: string;
  is_active: boolean;
  priority: number;
  created_at: string;
  updated_at: string;
};

export const listForceJoinChannels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("force_join_channels")
      .select("*")
      .order("priority", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as ForceJoinChannelRow[];
  });

export const upsertForceJoinChannel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      title: z.string().min(1).max(120),
      chat_id: z.string().min(2).max(64),
      invite_url: z.string().url().max(400).nullable().optional(),
      categories: z.array(CATEGORY).max(8).default([]),
      is_active: z.boolean().default(true),
      priority: z.number().int().min(-100).max(100).default(0),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const payload = {
      ...(data.id ? { id: data.id } : {}),
      title: data.title.trim(),
      chat_id: data.chat_id.trim(),
      invite_url: data.invite_url?.trim() || null,
      categories: data.categories,
      is_active: data.is_active,
      priority: data.priority,
    };
    const { data: row, error } = await supabaseAdmin
      .from("force_join_channels")
      .upsert(payload as never, { onConflict: "id" })
      .select("*")
      .single();
    if (error) throw error;
    return row as ForceJoinChannelRow;
  });

export const deleteForceJoinChannel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("force_join_channels")
      .delete()
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

// Convenience: verify a chat_id by calling getChat through the bot.
export const verifyForceJoinChannel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ chat_id: z.string().min(2).max(64) }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    try {
      const { getChat } = await import("@/lib/telegram-api.server");
      const chat: any = await getChat(data.chat_id.trim());
      return {
        ok: true as const,
        title: chat?.title ?? chat?.username ?? null,
        type: chat?.type ?? null,
        id: chat?.id ?? null,
        username: chat?.username ?? null,
      };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });
