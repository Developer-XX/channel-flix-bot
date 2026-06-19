// Premium membership — manual UPI/QR + screenshot review.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";

export type PremiumPlan = {
  id: string; name: string; description: string | null;
  price_inr: number; duration_days: number; sort_order: number; is_active: boolean;
};

export type PremiumPaymentConfig = {
  enabled: boolean;
  upiId: string | null;
  upiName: string | null;
  qrUrl: string | null;
  instructions: string | null;
  plans: PremiumPlan[];
};

async function readSetting(key: string): Promise<string | null> {
  try {
    const { getSetting } = await import("@/lib/runtime-settings.server");
    return await getSetting(key);
  } catch { return null; }
}

// Public — used by /premium page (no admin required, but auth required to keep RLS happy on payments)
export const getPremiumConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PremiumPaymentConfig> => {
    const enabled = !/^(0|false|no|off)$/i.test((await readSetting("PREMIUM_ENABLED")) ?? "true");
    const { data } = await context.supabase
      .from("premium_plans")
      .select("id,name,description,price_inr,duration_days,sort_order,is_active")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    return {
      enabled,
      upiId: await readSetting("PREMIUM_UPI_ID"),
      upiName: await readSetting("PREMIUM_UPI_NAME"),
      qrUrl: await readSetting("PREMIUM_QR_URL"),
      instructions: await readSetting("PREMIUM_INSTRUCTIONS"),
      plans: (data ?? []) as PremiumPlan[],
    };
  });

export const getMyPremiumStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: prof } = await context.supabase
      .from("profiles")
      .select("is_premium, premium_until, premium_plan")
      .eq("id", context.userId).maybeSingle();
    const { data: payments } = await context.supabase
      .from("premium_payments")
      .select("id, plan_name, amount_inr, status, admin_note, created_at, reviewed_at, screenshot_url")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false }).limit(20);
    const active = !!(prof?.is_premium && (!prof.premium_until || new Date(prof.premium_until).getTime() > Date.now()));
    return {
      isPremium: active,
      premiumUntil: prof?.premium_until ?? null,
      planName: prof?.premium_plan ?? null,
      payments: payments ?? [],
    };
  });

export const submitPremiumPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    planId: z.string().uuid(),
    screenshotPath: z.string().min(3).max(512),
    userNote: z.string().max(500).optional().nullable(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    // Enforce that the screenshot path lives in the caller's own storage folder.
    // Storage RLS prevents uploads outside `{userId}/...`, but the path string
    // saved on premium_payments was not previously cross-checked, allowing a
    // crafted request to reference another user's screenshot.
    const prefix = `${context.userId}/`;
    const normalized = data.screenshotPath.replace(/^\/+/, "");
    if (!normalized.startsWith(prefix) || normalized.includes("..")) {
      throw new Error("Screenshot must be in your own storage folder");
    }
    // Verify the object actually exists under the caller's folder.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rest = normalized.slice(prefix.length);
    const lastSlash = rest.lastIndexOf("/");
    const dir = lastSlash >= 0 ? `${prefix}${rest.slice(0, lastSlash)}` : prefix.replace(/\/$/, "");
    const fileName = lastSlash >= 0 ? rest.slice(lastSlash + 1) : rest;
    const { data: listed, error: listErr } = await supabaseAdmin
      .storage.from("payment-proofs")
      .list(dir, { search: fileName, limit: 1 });
    if (listErr) throw listErr;
    if (!listed || !listed.some((o) => o.name === fileName)) {
      throw new Error("Screenshot not found in your storage folder");
    }

    const { data: plan, error: planErr } = await context.supabase
      .from("premium_plans").select("id,name,price_inr,duration_days").eq("id", data.planId).maybeSingle();
    if (planErr || !plan) throw new Error("Plan not found");
    const { error } = await context.supabase.from("premium_payments").insert({
      user_id: context.userId,
      plan_id: plan.id,
      plan_name: plan.name,
      amount_inr: plan.price_inr,
      duration_days: plan.duration_days,
      screenshot_url: normalized,
      user_note: data.userNote ?? null,
    } as never);
    if (error) throw error;
    return { ok: true };
  });


// ---------------- Admin ----------------
export const adminListPayments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    status: z.enum(["pending","approved","rejected","all"]).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }).parse(d ?? {}))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin.from("premium_payments")
      .select("id, user_id, plan_name, amount_inr, duration_days, status, screenshot_url, user_note, admin_note, created_at, reviewed_at")
      .order("created_at", { ascending: false }).limit(data.limit ?? 100);
    if (data.status && data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw error;
    const userIds = Array.from(new Set((rows ?? []).map((r: any) => r.user_id))).filter(Boolean);
    const profileMap = new Map<string, { display_name: string | null }>();
    if (userIds.length) {
      const { data: profs } = await supabaseAdmin.from("profiles").select("id, display_name").in("id", userIds);
      for (const p of (profs ?? []) as Array<{ id: string; display_name: string | null }>) {
        profileMap.set(p.id, { display_name: p.display_name });
      }
    }
    // signed URLs for screenshots (private bucket)
    const enriched = await Promise.all((rows ?? []).map(async (r: any) => {
      let signed: string | null = null;
      try {
        const path = (r.screenshot_url ?? "").replace(/^payment-proofs\//, "");
        const { data: s } = await supabaseAdmin.storage.from("payment-proofs").createSignedUrl(path, 3600);
        signed = s?.signedUrl ?? null;
      } catch { /* ignore */ }
      return { ...r, screenshot_signed_url: signed, user_display_name: profileMap.get(r.user_id)?.display_name ?? null };
    }));
    return enriched;
  });

export const adminReviewPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    paymentId: z.string().uuid(),
    action: z.enum(["approve","reject"]),
    adminNote: z.string().max(500).optional().nullable(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: pay, error: e1 } = await supabaseAdmin.from("premium_payments")
      .select("id, user_id, plan_name, duration_days, status").eq("id", data.paymentId).maybeSingle();
    if (e1 || !pay) throw new Error("Payment not found");
    if (pay.status !== "pending") throw new Error(`Already ${pay.status}`);

    const nowIso = new Date().toISOString();
    const { error: e2 } = await supabaseAdmin.from("premium_payments").update({
      status: data.action === "approve" ? "approved" : "rejected",
      reviewed_by: context.userId,
      reviewed_at: nowIso,
      admin_note: data.adminNote ?? null,
    } as never).eq("id", data.paymentId);
    if (e2) throw e2;

    if (data.action === "approve") {
      // Extend premium_until from max(now, current premium_until)
      const { data: prof } = await supabaseAdmin.from("profiles")
        .select("premium_until").eq("id", pay.user_id).maybeSingle();
      const base = prof?.premium_until && new Date(prof.premium_until).getTime() > Date.now()
        ? new Date(prof.premium_until).getTime() : Date.now();
      const newUntil = new Date(base + (pay.duration_days ?? 30) * 86400000).toISOString();
      await supabaseAdmin.from("profiles").update({
        is_premium: true, premium_until: newUntil, premium_plan: pay.plan_name,
      } as never).eq("id", pay.user_id);
    }

    await supabaseAdmin.from("admin_audit_log").insert({
      actor_user_id: context.userId,
      action: `premium.${data.action}`,
      status: "success",
      metadata: { paymentId: data.paymentId, userId: pay.user_id, plan: pay.plan_name },
    } as never);
    return { ok: true };
  });

// Grant / revoke premium for a specific user (no payment row needed).
export const adminGrantPremium = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    userId: z.string().uuid(),
    days: z.number().int().min(1).max(3650),
    planName: z.string().max(80).optional().nullable(),
    note: z.string().max(500).optional().nullable(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prof } = await supabaseAdmin.from("profiles")
      .select("premium_until").eq("id", data.userId).maybeSingle();
    const base = prof?.premium_until && new Date(prof.premium_until).getTime() > Date.now()
      ? new Date(prof.premium_until).getTime() : Date.now();
    const until = new Date(base + data.days * 86400000).toISOString();
    const { error } = await supabaseAdmin.from("profiles").update({
      is_premium: true, premium_until: until, premium_plan: data.planName ?? "manual", premium_note: data.note ?? null,
    } as never).eq("id", data.userId);
    if (error) throw error;
    await supabaseAdmin.from("admin_audit_log").insert({
      actor_user_id: context.userId, action: "premium.grant", status: "success",
      metadata: { userId: data.userId, days: data.days, planName: data.planName ?? "manual" },
    } as never);
    return { ok: true, premiumUntil: until };
  });

export const adminRevokePremium = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("profiles").update({
      is_premium: false, premium_until: null, premium_plan: null,
    } as never).eq("id", data.userId);
    if (error) throw error;
    await supabaseAdmin.from("admin_audit_log").insert({
      actor_user_id: context.userId, action: "premium.revoke", status: "success",
      metadata: { userId: data.userId },
    } as never);
    return { ok: true };
  });

export const adminSearchUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ q: z.string().max(120).optional() }).parse(d ?? {}))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin.from("profiles")
      .select("id, display_name, is_premium, premium_until, premium_plan, created_at")
      .order("created_at", { ascending: false }).limit(50);
    if (data.q && data.q.trim()) q = q.ilike("display_name", `%${data.q.trim()}%`);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

// Plan management
export const adminListPlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.from("premium_plans")
      .select("*").order("sort_order", { ascending: true });
    if (error) throw error;
    return data ?? [];
  });

export const adminUpsertPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid().optional().nullable(),
    name: z.string().min(1).max(80),
    description: z.string().max(500).optional().nullable(),
    price_inr: z.number().int().min(0),
    duration_days: z.number().int().min(1).max(3650),
    sort_order: z.number().int().min(0).max(999).default(0),
    is_active: z.boolean().default(true),
  }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const row: any = { ...data };
    if (!row.id) delete row.id;
    const { error } = await supabaseAdmin.from("premium_plans").upsert(row, { onConflict: "id" });
    if (error) throw error;
    return { ok: true };
  });

export const adminDeletePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("premium_plans").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
