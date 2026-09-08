-- Atomic administrator changes and an append-only audit trail on real PostgreSQL.
BEGIN;
INSERT INTO auth.users(id,email) VALUES
  ('ab000000-0000-4000-8000-000000000001','admin@example.test'),
  ('ab000000-0000-4000-8000-000000000002','member@example.test');
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
UPDATE public.profiles SET is_admin=true WHERE id='ab000000-0000-4000-8000-000000000001';
INSERT INTO public.providers(id,user_id) VALUES ('bc000000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000002');
INSERT INTO public.services(id,provider_id,name_ar,name_en,category,price,image_urls) VALUES
  ('cd000000-0000-4000-8000-000000000001','bc000000-0000-4000-8000-000000000001','خدمة','Service','design',100,ARRAY['https://example.test/image.jpg']);
INSERT INTO public.withdrawal_requests(id,provider_id,amount) VALUES
  ('de000000-0000-4000-8000-000000000001','bc000000-0000-4000-8000-000000000001',10);
DO $$
DECLARE rejected boolean;
BEGIN
  rejected := false;
  BEGIN
    PERFORM public.apply_admin_action('ab000000-0000-4000-8000-000000000002','set_admin','ab000000-0000-4000-8000-000000000002','true');
  EXCEPTION WHEN insufficient_privilege THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Non-administrator actor was accepted'; END IF;
  rejected := false;
  BEGIN
    PERFORM public.apply_admin_action('ab000000-0000-4000-8000-000000000001','set_admin','ab000000-0000-4000-8000-000000000001','false');
  EXCEPTION WHEN sqlstate 'P0001' THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Self-demotion was accepted'; END IF;
  PERFORM public.apply_admin_action('ab000000-0000-4000-8000-000000000001','verify_provider','bc000000-0000-4000-8000-000000000001','true');
  PERFORM public.apply_admin_action('ab000000-0000-4000-8000-000000000001','set_service_active','cd000000-0000-4000-8000-000000000001','true');
  IF NOT (SELECT is_verified FROM public.providers WHERE id='bc000000-0000-4000-8000-000000000001') OR
     NOT (SELECT is_active FROM public.services WHERE id='cd000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'Administrator changes did not persist';
  END IF;
  PERFORM public.apply_admin_action('ab000000-0000-4000-8000-000000000001','review_withdrawal','de000000-0000-4000-8000-000000000001','completed','bank-reference-123');
  rejected := false;
  BEGIN
    PERFORM public.apply_admin_action('ab000000-0000-4000-8000-000000000001','review_withdrawal','de000000-0000-4000-8000-000000000001','rejected','invalid-repeat');
  EXCEPTION WHEN sqlstate 'P0001' THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Terminal withdrawal was reprocessed'; END IF;
  IF (SELECT count(*) FROM public.admin_audit_log WHERE actor_id='ab000000-0000-4000-8000-000000000001') <> 3 THEN
    RAISE EXCEPTION 'Expected one audit entry per successful mutation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.admin_audit_log WHERE action='review_withdrawal' AND
    before_data->>'status'='pending' AND after_data->>'status'='completed' AND after_data->>'notes'='bank-reference-123') THEN
    RAISE EXCEPTION 'Audit is missing previous state or transfer reference';
  END IF;
  rejected := false;
  BEGIN
    DELETE FROM public.admin_audit_log;
  EXCEPTION WHEN insufficient_privilege THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Service client can erase audit entries'; END IF;
  rejected := false;
  BEGIN
    UPDATE public.admin_audit_log SET after_data = '{}'::jsonb;
  EXCEPTION WHEN insufficient_privilege THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Service client can rewrite audit entries'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','ab000000-0000-4000-8000-000000000002',true);
DO $$
DECLARE rejected boolean := false;
BEGIN
  IF EXISTS (SELECT 1 FROM public.admin_audit_log) THEN RAISE EXCEPTION 'Non-admin can read administrator audit'; END IF;
  BEGIN
    PERFORM public.apply_admin_action('ab000000-0000-4000-8000-000000000001','set_admin','ab000000-0000-4000-8000-000000000002','true');
  EXCEPTION WHEN insufficient_privilege THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Browser can forge administrator actor'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','ab000000-0000-4000-8000-000000000001',true);
DO $$
DECLARE rejected boolean := false;
BEGIN
  IF (SELECT count(*) FROM public.admin_audit_log WHERE actor_id='ab000000-0000-4000-8000-000000000001') <> 3 THEN
    RAISE EXCEPTION 'Administrator cannot inspect audit entries';
  END IF;
  BEGIN
    DELETE FROM public.admin_audit_log;
  EXCEPTION WHEN insufficient_privilege THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Browser administrator can erase audit entries'; END IF;
END $$;
ROLLBACK;
