import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/admin/google-oauth-help")({
  component: HelpPage,
});

function HelpPage() {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://your-app.example";
  const redirectUri = `${origin}/admin/google-oauth-callback`;

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-3xl mx-auto">
      <div className="flex items-center gap-2">
        <Link to="/admin/google-oauth"><Button size="sm" variant="ghost"><ArrowLeft className="h-3 w-3 mr-1" /> Google OAuth</Button></Link>
      </div>
      <h1 className="font-display text-2xl sm:text-3xl font-bold mt-3">Setting up Google OAuth 2.0</h1>
      <p className="text-sm text-muted-foreground mt-1">Step-by-step guide to creating a Google OAuth client and wiring it into this app.</p>

      <ol className="mt-6 space-y-6 list-decimal list-inside">
        <li>
          <span className="font-semibold">Open Google Cloud Console.</span>
          <div className="text-sm mt-1">
            Go to <a className="text-primary underline" href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">console.cloud.google.com <ExternalLink className="inline h-3 w-3" /></a> and select (or create) a project.
          </div>
        </li>

        <li>
          <span className="font-semibold">Configure the OAuth consent screen.</span>
          <div className="text-sm mt-1">
            Navigate to <em>APIs &amp; Services → OAuth consent screen</em>. Choose <strong>External</strong>, fill in the app name, user support email, and developer contact.
          </div>
          <div className="text-sm mt-2">Under <em>Scopes</em>, add the non-sensitive scopes:</div>
          <ul className="text-sm list-disc list-inside ml-4 mt-1 text-muted-foreground">
            <li><code>.../auth/userinfo.email</code></li>
            <li><code>.../auth/userinfo.profile</code></li>
            <li><code>openid</code></li>
          </ul>
          <div className="text-sm mt-2">
            Under <em>Authorized domains</em>, add this app's domain (e.g. <code>{origin.replace(/^https?:\/\//, "")}</code>).
          </div>
        </li>

        <li>
          <span className="font-semibold">Create OAuth credentials.</span>
          <div className="text-sm mt-1">
            Go to <em>APIs &amp; Services → Credentials</em>, then click <em>Create Credentials → OAuth client ID</em>. Choose application type <strong>Web application</strong>.
          </div>
        </li>

        <li>
          <span className="font-semibold">Add Authorized redirect URIs.</span>
          <div className="text-sm mt-1">Paste this exact URL into the <em>Authorized redirect URIs</em> field:</div>
          <pre className="mt-2 rounded-md border border-border bg-muted px-3 py-2 text-xs font-mono break-all">{redirectUri}</pre>
          <p className="text-xs text-muted-foreground mt-1">
            If you publish to a custom domain, add that variant too. Each URL must match exactly — trailing slashes and scheme matter.
          </p>
        </li>

        <li>
          <span className="font-semibold">Copy the Client ID and Client Secret.</span>
          <div className="text-sm mt-1">
            After creation, Google shows the values once. Copy both, then paste them into the form on the <Link to="/admin/google-oauth" className="text-primary underline">Google OAuth admin page</Link>.
          </div>
        </li>

        <li>
          <span className="font-semibold">Run the quick check.</span>
          <div className="text-sm mt-1">
            Back on the admin page, click <em>Run quick check</em>. It verifies the Client ID format, that Google's discovery endpoint is reachable, and that Google recognizes the Client ID + redirect URI.
          </div>
        </li>

        <li>
          <span className="font-semibold">Run the full token exchange.</span>
          <div className="text-sm mt-1">
            Click <em>Run full OAuth test</em>. You'll be sent to Google's consent screen and redirected back. A successful run confirms the Client Secret is correct and the redirect URI is registered.
          </div>
        </li>
      </ol>

      <h2 className="font-semibold mt-8 mb-2">Common errors</h2>
      <div className="space-y-3 text-sm">
        <ErrorRow code="invalid_client" desc="Client ID or Client Secret is wrong. Re-copy from Google Cloud Console." />
        <ErrorRow code="redirect_uri_mismatch" desc="The redirect URI sent by the app is not in your OAuth client's Authorized redirect URIs. Paste the exact value shown above." />
        <ErrorRow code="invalid_grant" desc="The authorization code expired or was already used. Run the test again." />
        <ErrorRow code="access_denied" desc="You declined the consent screen. Approve it to complete the test." />
      </div>
    </div>
  );
}

function ErrorRow({ code, desc }: { code: string; desc: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <code className="text-xs font-mono">{code}</code>
      <div className="text-muted-foreground mt-1">{desc}</div>
    </div>
  );
}
