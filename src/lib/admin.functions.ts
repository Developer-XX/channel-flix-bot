import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAdminAccess, requireAdminAccess } from "@/lib/admin-auth";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

const CategorySchema = z.enum(["movie", "series", "anime", "cartoon", "kdrama", "documentary"]);
const StatusSchema = z.enum(["draft", "published", "archived"]);
const RequestStatusSchema = z.enum(["pending", "approved", "rejected", "fulfilled"]);

export const getAdminGate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const access = await getAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count, error } = await supabaseAdmin
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    if (error) throw error;
    const email = (context.claims as { email?: string } | null)?.email ?? null;
    return {
      ...access,
      hasAnyAdmin: (count ?? 0) > 0,
      userId: context.userId,
      email,
    };
  });

export const claimFirstAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count, error: countError } = await supabaseAdmin
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    if (countError) throw countError;
    if ((count ?? 0) > 0) throw new Error("Forbidden: an admin already exists");

    const { error } = await supabaseAdmin.from("user_roles").insert({ user_id: context.userId, role: "admin" });
    if (error) throw error;
    return { isAdmin: true };
  });

export const getAdminStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const [titles, requests, files, downloads] = await Promise.all([
      context.supabase.from("master_titles").select("id", { count: "exact", head: true }),
      context.supabase.from("content_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
      context.supabase.from("media_files").select("id", { count: "exact", head: true }),
      context.supabase.from("download_logs").select("id", { count: "exact", head: true }),
    ]);
    const error = titles.error ?? requests.error ?? files.error ?? downloads.error;
    if (error) throw error;
    return {
      titles: titles.count ?? 0,
      requests: requests.count ?? 0,
      files: files.count ?? 0,
      downloads: downloads.count ?? 0,
    };
  });

export const listAdminTitles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const { data, error } = await context.supabase
      .from("master_titles")
      .select("id, slug, title, category, status, release_year, rating, poster_url, is_trending, is_featured")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return data ?? [];
  });

export const updateAdminTitleStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid(), status: StatusSchema }).parse(input))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const update: TablesUpdate<"master_titles"> = { status: data.status };
    const { error } = await context.supabase.from("master_titles").update(update).eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const updateAdminTitleFlag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid(), field: z.enum(["is_trending", "is_featured"]), value: z.boolean() }).parse(input))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const update: TablesUpdate<"master_titles"> = { [data.field]: data.value };
    const { error } = await context.supabase.from("master_titles").update(update).eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const deleteAdminTitle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { error } = await context.supabase.from("master_titles").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const createAdminTitle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({
    slug: z.string().min(1).max(220),
    title: z.string().min(1).max(300),
    original_title: z.string().nullable().optional(),
    category: CategorySchema,
    status: StatusSchema.default("published"),
    overview: z.string().nullable().optional(),
    poster_url: z.string().nullable().optional(),
    backdrop_url: z.string().nullable().optional(),
    release_year: z.number().int().nullable().optional(),
    release_date: z.string().nullable().optional(),
    runtime_minutes: z.number().int().nullable().optional(),
    rating: z.number().nullable().optional(),
    language: z.string().nullable().optional(),
    genres: z.array(z.string()).nullable().optional(),
    cast_names: z.array(z.string()).nullable().optional(),
    tmdb_id: z.number().int().nullable().optional(),
    imdb_id: z.string().nullable().optional(),
  }).parse(input))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const payload: TablesInsert<"master_titles"> = data;
    const { error } = await context.supabase.from("master_titles").insert(payload);
    if (error) throw error;
    return { ok: true };
  });

export const listAdminRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const { data, error } = await context.supabase
      .from("content_requests")
      .select("id, title, category, notes, status, created_at, user_id")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return data ?? [];
  });

export const updateAdminRequestStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid(), status: RequestStatusSchema }).parse(input))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const update: TablesUpdate<"content_requests"> = { status: data.status };
    const { error } = await context.supabase.from("content_requests").update(update).eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

// Audit feed of verification rate-limit rejections, with token/file context,
// for the Verification Limits admin page.
export const listVerificationRateLimits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("verification_provider_calls")
      .select("id, created_at, user_id, provider, status, short_url_returned, error")
      .eq("status", "rate_limited")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return (data ?? []).map((r) => {
      let parsed: Record<string, unknown> | null = null;
      try { parsed = r.error ? JSON.parse(r.error) : null; } catch { /* keep raw */ }
      return { ...r, parsed };
    });
  });
