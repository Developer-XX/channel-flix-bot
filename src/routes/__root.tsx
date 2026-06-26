import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "@/components/ui/sonner";

import appCss from "../styles.css?url";
import faviconAsset from "@/assets/stream-vault-favicon.png.asset.json";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { BuildSyncProvider } from "@/components/BuildSyncProvider";
import { ServerFnErrorScreen, isServerFnError } from "@/components/ServerFnErrorScreen";
import { InterstitialController } from "@/components/InterstitialController";
import { SupportGroupPopup } from "@/components/SupportGroupPopup";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  // Render the friendlier serverFn-specific screen when the failure came
  // from a /_serverFn/* call instead of a generic "this page didn't load".
  if (isServerFnError(error)) {
    return <ServerFnErrorScreen error={error} reset={reset} />;
  }



  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Stream Vault" },
      { name: "description", content: "Stream Vault — browse and download movies and series fast, with a sleek catalog and admin tools." },
      { name: "author", content: "Stream Vault" },
      { property: "og:title", content: "Stream Vault" },
      { property: "og:description", content: "Stream Vault — browse and download movies and series fast, with a sleek catalog and admin tools." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Stream Vault" },
      { name: "twitter:description", content: "Stream Vault — browse and download movies and series fast, with a sleek catalog and admin tools." },
      { property: "og:image", content: faviconAsset.url },
      { name: "twitter:image", content: faviconAsset.url },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: faviconAsset.url },
      { rel: "apple-touch-icon", href: faviconAsset.url },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=DM+Sans:wght@400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    const refreshIfNeeded = async () => {
      const { data } = await supabase.auth.getSession();
      const expiresAt = data.session?.expires_at;
      if (expiresAt && expiresAt * 1000 - Date.now() < 60_000) {
        await supabase.auth.refreshSession();
      }
    };

    supabase.auth.startAutoRefresh();
    void refreshIfNeeded();
    window.addEventListener("focus", refreshIfNeeded);
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      if (event === "SIGNED_OUT") {
        queryClient.clear();
        return;
      }
      queryClient.invalidateQueries();
    });

    // Real-User Monitoring (RUM) — capture Core Web Vitals from real visitors.
    // Lazy-imported so it never blocks the critical path and stays out of SSR.
    void import("@/lib/web-vitals-client").then((m) => m.installWebVitals()).catch(() => {});

    return () => {
      window.removeEventListener("focus", refreshIfNeeded);
      data.subscription.unsubscribe();
      supabase.auth.stopAutoRefresh();
    };
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <Toaster richColors />
      <BuildSyncProvider />
      <InterstitialController />
      <SupportGroupPopup />
    </QueryClientProvider>
  );
}
