import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/trust")({
  component: TrustPage,
  head: () => ({
    meta: [
      { title: "Trust, Security & Privacy" },
      {
        name: "description",
        content:
          "How this app handles authentication, data, and your privacy. Maintained by the app owner.",
      },
    ],
  }),
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-b border-border/40 pb-8 last:border-0">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="space-y-2 text-sm text-muted-foreground leading-relaxed">{children}</div>
    </section>
  );
}

function TrustPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 space-y-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">Trust, Security & Privacy</h1>
        <p className="text-sm text-muted-foreground">
          This page is maintained by the app owner to answer common security and privacy questions
          about this service. It describes currently enabled controls; it is editable content and
          is not an independent certification or audit.
        </p>
      </header>

      <Section title="Authentication & access">
        <p>
          Accounts are protected by email/password sign-in. Sessions are scoped per user, and
          privileged actions require an admin or moderator role enforced server-side.
        </p>
        <p>
          User data such as profiles, download history, and verification state is protected by
          row-level access rules so each signed-in user can only read their own records.
        </p>
      </Section>

      <Section title="Platform & hosting">
        <p>
          The application runs on Lovable's managed runtime, with the database, authentication, and
          file storage provided by the Lovable Cloud backend. This describes platform capabilities
          we rely on and is not a Lovable-issued certification.
        </p>
      </Section>

      <Section title="Data we collect">
        <p>
          We store account email, display name, premium status, download/verification activity, and
          (when you link the bot) your Telegram identifier. Optional analytics events help diagnose
          performance issues.
        </p>
        <p>
          Payment proofs and premium assets live in private storage buckets; URLs are short-lived
          and signed on demand.
        </p>
      </Section>

      <Section title="Cookies & analytics">
        <p>
          We use first-party cookies/localStorage only for keeping you signed in and remembering
          UI preferences. We do not sell personal data.
        </p>
      </Section>

      <Section title="Retention & deletion">
        <p>
          You can request account deletion at any time via the support page. Logs tied to abuse
          prevention may be retained briefly after deletion for safety and audit purposes.
        </p>
      </Section>

      <Section title="Vulnerability reporting & contact">
        <p>
          Found a security issue? Please report it through the in-app{" "}
          <Link to="/support" className="underline">
            support page
          </Link>{" "}
          with the subject "Security". We aim to acknowledge reports promptly.
        </p>
      </Section>

      <Section title="Shared responsibility">
        <p>
          Security is shared: the Lovable platform secures the runtime, network, and managed
          services; the app owner configures access rules, content, and integrations described
          above; and account holders are responsible for safeguarding their credentials.
        </p>
      </Section>
    </main>
  );
}
