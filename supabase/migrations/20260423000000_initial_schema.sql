-- Fresh-install baseline, reconstructed from the application's actual queries.
-- Never silently adopt an unknown existing database. For an existing installation,
-- run supabase/checks/preflight.sql, reconcile a schema-only dump in staging, and
-- record this baseline as applied ONLY after the contract has been reviewed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN
      ('profiles','providers','services','conversations','messages','orders',
       'reviews','favorites','service_history','withdrawal_requests')
  ) THEN
    RAISE EXCEPTION 'Existing application schema detected. Review supabase/checks/preflight.sql and the baseline before adopting migrations; automatic adoption is intentionally disabled.';
  END IF;
END $$;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  email text,
  full_name text NOT NULL DEFAULT '',
  phone text,
  avatar_url text,
  role text NOT NULL DEFAULT 'seeker' CHECK (role IN ('seeker','provider')),
  is_admin boolean NOT NULL DEFAULT false,
  deletion_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE RESTRICT,
  name_ar text NOT NULL DEFAULT '', name_en text NOT NULL DEFAULT '',
  title_ar text NOT NULL DEFAULT '', title_en text NOT NULL DEFAULT '',
  bio_ar text, bio_en text, avatar_url text,
  display_name text, title text, bio text, category text,
  hourly_rate numeric(12,2) NOT NULL DEFAULT 0 CHECK (hourly_rate >= 0),
  starting_price numeric(12,2) CHECK (starting_price >= 0),
  skills text[] NOT NULL DEFAULT '{}', categories text[] NOT NULL DEFAULT '{}',
  rating numeric(3,2) NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
  reviews_count integer NOT NULL DEFAULT 0 CHECK (reviews_count >= 0),
  completed_projects integer NOT NULL DEFAULT 0 CHECK (completed_projects >= 0),
  is_verified boolean NOT NULL DEFAULT false,
  tap_destination_id text,
  tap_account_status text NOT NULL DEFAULT 'not_connected',
  tap_onboarding_completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE RESTRICT,
  name_ar text NOT NULL, name_en text NOT NULL,
  description_ar text, description_en text,
  category text NOT NULL,
  price numeric(12,2) NOT NULL CHECK (price >= 1 AND price <= 1000000),
  price_type text NOT NULL DEFAULT 'fixed',
  delivery_time text,
  features text[] NOT NULL DEFAULT '{}', image_urls text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seeker_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE RESTRICT,
  is_pinned_by_seeker boolean NOT NULL DEFAULT false,
  is_pinned_by_provider boolean NOT NULL DEFAULT false,
  is_archived_by_seeker boolean NOT NULL DEFAULT false,
  is_archived_by_provider boolean NOT NULL DEFAULT false,
  seeker_cleared_at timestamptz, provider_cleared_at timestamptz,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (seeker_id, provider_id)
);

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE RESTRICT,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 10000),
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE RESTRICT,
  seeker_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE RESTRICT,
  service_id uuid REFERENCES public.services(id) ON DELETE RESTRICT,
  service_name_ar text NOT NULL, service_name_en text NOT NULL,
  service_description_ar text, service_description_en text,
  amount numeric(12,2) NOT NULL CHECK (amount >= 1 AND amount <= 1000000),
  platform_fee numeric(12,2) NOT NULL CHECK (platform_fee >= 0),
  provider_amount numeric(12,2) NOT NULL CHECK (provider_amount >= 0),
  currency text NOT NULL DEFAULT 'SAR' CHECK (currency = 'SAR'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','awaiting_confirmation','completed','cancelled')),
  tap_charge_id text, tap_transaction_id text,
  paid_at timestamptz, completed_at timestamptz, cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (amount = platform_fee + provider_amount)
);

CREATE TABLE public.service_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE RESTRICT,
  seeker_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE RESTRICT,
  service_id uuid REFERENCES public.services(id) ON DELETE RESTRICT,
  service_name_ar text NOT NULL, service_name_en text NOT NULL,
  service_description_ar text, service_description_en text,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'completed' CHECK (status = 'completed'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE RESTRICT,
  service_id uuid REFERENCES public.services(id) ON DELETE RESTRICT,
  reviewer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text CHECK (char_length(comment) <= 5000), service_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider_id)
);

CREATE TABLE public.withdrawal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE RESTRICT,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','completed','rejected')),
  requested_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz,
  notes text, tap_transfer_id text
);

CREATE INDEX services_provider_idx ON public.services(provider_id);
CREATE INDEX services_active_category_idx ON public.services(category,created_at DESC) WHERE is_active;
CREATE INDEX conversations_provider_idx ON public.conversations(provider_id,last_message_at DESC);
CREATE INDEX messages_conversation_idx ON public.messages(conversation_id,created_at);
CREATE INDEX reviews_service_idx ON public.reviews(service_id,created_at DESC);
CREATE INDEX reviews_reviewer_idx ON public.reviews(reviewer_id);
CREATE INDEX favorites_user_idx ON public.favorites(user_id);
CREATE INDEX service_history_seeker_idx ON public.service_history(seeker_id);
CREATE INDEX withdrawal_provider_status_idx ON public.withdrawal_requests(provider_id,status);

-- Never trust raw_user_meta_data for administrator privileges.
CREATE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.profiles (id,email,full_name,role,is_admin)
  VALUES (NEW.id,NEW.email,left(coalesce(NEW.raw_user_meta_data->>'full_name',''),200),
    CASE WHEN NEW.raw_user_meta_data->>'role' = 'provider' THEN 'provider' ELSE 'seeker' END,false);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
