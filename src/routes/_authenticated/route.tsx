import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getSession();
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.debug("[_authenticated guard]", {
        path: location.pathname,
        href: location.href,
        hasSession: !!data?.session,
        userId: data?.session?.user?.id ?? null,
        error: error?.message ?? null,
      });
    }
    if (error) {
      // Don't redirect on transient network errors — let the route render
      // and individual loaders handle auth as needed.
      return { user: null };
    }
    if (!data.session) {
      throw redirect({
        to: "/auth",
        search: { redirect: location.href } as never,
      });
    }
    return { user: data.session.user };
  },
  component: () => <Outlet />,
});
