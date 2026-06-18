import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    // Use getSession() — reads from localStorage, no network call.
    // getUser() hits the network and can throw NetworkError, which would
    // incorrectly bounce a signed-in user to /auth (and then back to /).
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      // Don't redirect on transient network errors — let the route render
      // and individual loaders handle auth as needed.
      return { user: null };
    }
    if (!data.session) {
      throw redirect({ to: "/auth", search: { redirect: location.href } as never });
    }
    return { user: data.session.user };
  },
  component: () => <Outlet />,
});
