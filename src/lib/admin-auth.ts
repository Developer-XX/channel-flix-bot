import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type SupabaseAuthContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
};

export async function getAdminAccess(context: SupabaseAuthContext) {
  const [admin, moderator] = await Promise.all([
    context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
    context.supabase.rpc("has_role", { _user_id: context.userId, _role: "moderator" }),
  ]);

  if (admin.error) throw admin.error;
  if (moderator.error) throw moderator.error;

  return {
    isAdmin: Boolean(admin.data),
    isModerator: Boolean(moderator.data),
    canAccessAdmin: Boolean(admin.data || moderator.data),
  };
}

export async function requireAdminAccess(context: SupabaseAuthContext) {
  const access = await getAdminAccess(context);
  if (!access.canAccessAdmin) {
    throw new Error("Forbidden: admin or moderator role required");
  }
  return access;
}