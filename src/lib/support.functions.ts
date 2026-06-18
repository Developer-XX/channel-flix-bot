// Ticket-style support chat.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";

export const createTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    subject: z.string().min(2).max(200),
    body: z.string().min(2).max(4000),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: ticket, error } = await context.supabase.from("support_tickets")
      .insert({ user_id: context.userId, subject: data.subject, last_message_by: "user" } as never)
      .select("id").single();
    if (error) throw error;
    const tid = (ticket as any).id as string;
    await context.supabase.from("support_messages").insert({
      ticket_id: tid, sender_id: context.userId, sender_role: "user", body: data.body,
    } as never);
    return { id: tid };
  });

export const listMyTickets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("support_tickets")
      .select("id, subject, status, last_message_at, last_message_by, unread_for_user, created_at")
      .eq("user_id", context.userId)
      .order("last_message_at", { ascending: false }).limit(50);
    if (error) throw error;
    return data ?? [];
  });

export const getTicket = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: ticket, error } = await context.supabase.from("support_tickets")
      .select("id, user_id, subject, status, created_at, last_message_at")
      .eq("id", data.id).maybeSingle();
    if (error) throw error;
    if (!ticket) throw new Error("Ticket not found");
    const { data: msgs } = await context.supabase.from("support_messages")
      .select("id, sender_role, sender_id, body, created_at")
      .eq("ticket_id", data.id).order("created_at", { ascending: true });
    // Mark read for current viewer
    const isOwner = (ticket as any).user_id === context.userId;
    if (isOwner) {
      await context.supabase.from("support_tickets")
        .update({ unread_for_user: false } as never).eq("id", data.id);
    } else {
      await context.supabase.from("support_tickets")
        .update({ unread_for_admin: false } as never).eq("id", data.id);
    }
    return { ticket, messages: msgs ?? [] };
  });

export const replyTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    ticketId: z.string().uuid(),
    body: z.string().min(1).max(4000),
    statusOverride: z.enum(["open","pending_user","resolved","closed"]).optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: ticket } = await context.supabase.from("support_tickets")
      .select("id, user_id").eq("id", data.ticketId).maybeSingle();
    if (!ticket) throw new Error("Ticket not found");
    // Is admin?
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId, _role: "admin",
    } as never);
    const role: "user" | "admin" = isAdmin ? "admin" : "user";
    if (role === "user" && (ticket as any).user_id !== context.userId) throw new Error("Forbidden");

    const { error } = await context.supabase.from("support_messages").insert({
      ticket_id: data.ticketId, sender_id: context.userId, sender_role: role, body: data.body,
    } as never);
    if (error) throw error;
    await context.supabase.from("support_tickets").update({
      last_message_at: new Date().toISOString(),
      last_message_by: role,
      unread_for_admin: role === "user",
      unread_for_user: role === "admin",
      status: data.statusOverride ?? (role === "admin" ? "pending_user" : "open"),
    } as never).eq("id", data.ticketId);
    return { ok: true };
  });

export const adminListTickets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    status: z.enum(["open","pending_user","resolved","closed","all"]).optional(),
  }).parse(d ?? {}))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin.from("support_tickets")
      .select("id, user_id, subject, status, last_message_at, last_message_by, unread_for_admin, created_at")
      .order("last_message_at", { ascending: false }).limit(100);
    if (data.status && data.status !== "all") q = q.eq("status", data.status);
    const { data: tickets, error } = await q;
    if (error) throw error;
    const ids = (tickets ?? []).map((t: any) => t.user_id);
    const profMap = new Map<string, string | null>();
    if (ids.length) {
      const { data: profs } = await supabaseAdmin.from("profiles").select("id, display_name").in("id", ids);
      for (const p of (profs ?? []) as Array<{ id: string; display_name: string | null }>) {
        profMap.set(p.id, p.display_name);
      }
    }
    return (tickets ?? []).map((t: any) => ({ ...t, user_display_name: profMap.get(t.user_id) ?? null }));
  });

export const adminStartTicketWithUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    userId: z.string().uuid(),
    subject: z.string().min(2).max(200),
    body: z.string().min(1).max(4000),
  }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ticket, error } = await supabaseAdmin.from("support_tickets")
      .insert({ user_id: data.userId, subject: data.subject, last_message_by: "admin", unread_for_admin: false, unread_for_user: true } as never)
      .select("id").single();
    if (error) throw error;
    const tid = (ticket as any).id as string;
    await supabaseAdmin.from("support_messages").insert({
      ticket_id: tid, sender_id: context.userId, sender_role: "admin", body: data.body,
    } as never);
    return { id: tid };
  });

export const getUnreadCounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { count: userUnread } = await context.supabase.from("support_tickets")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId).eq("unread_for_user", true);
    return { userUnread: userUnread ?? 0 };
  });
