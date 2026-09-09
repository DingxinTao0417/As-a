BEGIN;

CREATE FUNCTION public.tap_payment_attempt_status(p_external_status text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE upper(coalesce(p_external_status,''))
    WHEN 'CAPTURED' THEN 'captured'
    WHEN 'INITIATED' THEN 'pending'
    WHEN 'AUTHORIZED' THEN 'pending'
    WHEN 'IN_PROGRESS' THEN 'pending'
    WHEN 'FAILED' THEN 'failed'
    WHEN 'DECLINED' THEN 'failed'
    WHEN 'RESTRICTED' THEN 'failed'
    WHEN 'VOID' THEN 'cancelled'
    WHEN 'CANCELLED' THEN 'cancelled'
    WHEN 'ABANDONED' THEN 'expired'
    WHEN 'TIMEDOUT' THEN 'expired'
    WHEN 'TIMED_OUT' THEN 'expired'
    ELSE 'unknown'
  END;
$$;
REVOKE ALL ON FUNCTION public.tap_payment_attempt_status(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tap_payment_attempt_status(text) TO service_role;

CREATE FUNCTION public.normalize_tap_payment_attempt_status()
RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.external_status IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status='captured' THEN
    NEW.status:='captured';
  ELSE
    NEW.status:=public.tap_payment_attempt_status(NEW.external_status);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.normalize_tap_payment_attempt_status() FROM PUBLIC,anon,authenticated;

CREATE TRIGGER normalize_tap_payment_attempt_insert
BEFORE INSERT ON public.payment_attempts
FOR EACH ROW EXECUTE FUNCTION public.normalize_tap_payment_attempt_status();
CREATE TRIGGER normalize_tap_payment_attempt_update
BEFORE UPDATE OF external_status ON public.payment_attempts
FOR EACH ROW EXECUTE FUNCTION public.normalize_tap_payment_attempt_status();

-- A captured attempt is terminal. Excluding it from the open-attempt unique
-- boundary lets a late capture be recorded after a timed-out attempt was retried.
DROP INDEX public.payment_attempts_active_order_unique;
CREATE UNIQUE INDEX payment_attempts_active_order_unique
ON public.payment_attempts(order_id)
WHERE status IN ('creating','pending','unknown');

COMMIT;
