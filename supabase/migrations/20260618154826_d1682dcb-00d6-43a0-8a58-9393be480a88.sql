
-- =====================================================================
-- Premium plans + manual payment review
-- =====================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_premium boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS premium_until timestamptz,
  ADD COLUMN IF NOT EXISTS premium_plan text,
  ADD COLUMN IF NOT EXISTS premium_note text;

CREATE TABLE IF NOT EXISTS public.premium_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  price_inr integer NOT NULL,
  duration_days integer NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.premium_plans TO anon, authenticated;
GRANT ALL ON public.premium_plans TO service_role;
ALTER TABLE public.premium_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone reads active plans" ON public.premium_plans FOR SELECT
  USING (is_active OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins manage plans" ON public.premium_plans FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER premium_plans_updated_at BEFORE UPDATE ON public.premium_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.premium_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES public.premium_plans(id) ON DELETE SET NULL,
  plan_name text,
  amount_inr integer,
  duration_days integer,
  screenshot_url text NOT NULL,
  user_note text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.premium_payments TO authenticated;
GRANT ALL ON public.premium_payments TO service_role;
ALTER TABLE public.premium_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own payments" ON public.premium_payments FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Users submit payments" ON public.premium_payments FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins update payments" ON public.premium_payments FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER premium_payments_updated_at BEFORE UPDATE ON public.premium_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX IF NOT EXISTS idx_premium_payments_status ON public.premium_payments(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_premium_payments_user ON public.premium_payments(user_id, created_at DESC);

-- =====================================================================
-- Support tickets / messages
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending_user','resolved','closed')),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_message_by text,
  unread_for_admin boolean NOT NULL DEFAULT true,
  unread_for_user boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.support_tickets TO authenticated;
GRANT ALL ON public.support_tickets TO service_role;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own tickets" ON public.support_tickets FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Users create tickets" ON public.support_tickets FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users/admins update tickets" ON public.support_tickets FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE TRIGGER support_tickets_updated_at BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON public.support_tickets(user_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON public.support_tickets(status, last_message_at DESC);

CREATE TABLE IF NOT EXISTS public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_role text NOT NULL CHECK (sender_role IN ('user','admin')),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.support_messages TO authenticated;
GRANT ALL ON public.support_messages TO service_role;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Participants read messages" ON public.support_messages FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id AND t.user_id = auth.uid())
  );
CREATE POLICY "Participants write messages" ON public.support_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid() AND (
      public.has_role(auth.uid(),'admin')
      OR EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id AND t.user_id = auth.uid())
    )
  );
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON public.support_messages(ticket_id, created_at ASC);

-- =====================================================================
-- Site-wide announcements (shown in header)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  body text NOT NULL,
  link_url text,
  variant text NOT NULL DEFAULT 'info' CHECK (variant IN ('info','success','warning','promo')),
  is_active boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.announcements TO anon, authenticated;
GRANT ALL ON public.announcements TO service_role;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone reads active announcements" ON public.announcements FOR SELECT
  USING (
    is_active AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at >= now())
    OR public.has_role(auth.uid(),'admin')
  );
CREATE POLICY "Admins manage announcements" ON public.announcements FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER announcements_updated_at BEFORE UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================================
-- Admin notifications (in-app alerts)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.admin_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warn','error')),
  title text NOT NULL,
  body text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text,
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.admin_notifications TO authenticated;
GRANT ALL ON public.admin_notifications TO service_role;
ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read notifications" ON public.admin_notifications FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins ack notifications" ON public.admin_notifications FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX IF NOT EXISTS idx_admin_notifications_recent ON public.admin_notifications(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_notifications_dedupe
  ON public.admin_notifications(dedupe_key) WHERE dedupe_key IS NOT NULL;

-- Seed default plans (idempotent)
INSERT INTO public.premium_plans (name, description, price_inr, duration_days, sort_order)
SELECT * FROM (VALUES
  ('Monthly','30 days · skip token verification, faster downloads', 49, 30, 1),
  ('Quarterly','90 days · best for regular users', 129, 90, 2),
  ('Yearly','365 days · biggest savings', 399, 365, 3)
) AS v(name,description,price_inr,duration_days,sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.premium_plans);
