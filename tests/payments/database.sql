-- Executed against an isolated PGlite/PostgreSQL database by scripts/test-database.mjs.
begin;
insert into auth.users (id, email, raw_user_meta_data) values
  ('aa000000-0000-4000-8000-000000000001', 'payment-seeker@example.test', '{}'::jsonb),
  ('aa000000-0000-4000-8000-000000000002', 'payment-provider@example.test', '{"role":"provider"}'::jsonb),
  ('aa000000-0000-4000-8000-000000000003', 'payment-stranger@example.test', '{}'::jsonb);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
insert into public.providers (id, user_id, tap_destination_id, tap_account_status, tap_onboarding_completed) values
  ('bb000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000002', 'dest_verified', 'active', true);
insert into public.services (id, provider_id, name_ar, name_en, category, price, is_active) values
  ('cc000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', 'خدمة', 'Service', 'design', 100, true);

do $$
declare
  v_order uuid;
  v_second uuid;
  v_request uuid;
  v_rejected boolean;
begin
  v_order := public.create_direct_order('cc000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001');
  if v_order <> public.create_direct_order('cc000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001') then
    raise exception 'Repeated checkout must reuse pending order';
  end if;
  v_rejected := false;
  begin
    perform public.cancel_pending_order(v_order, 'aa000000-0000-4000-8000-000000000003');
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'Order not found' then raise; end if;
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'Outsider cancelled another customer order'; end if;
  perform public.cancel_pending_order(v_order, 'aa000000-0000-4000-8000-000000000001');
  perform public.cancel_pending_order(v_order, 'aa000000-0000-4000-8000-000000000001');
  if (select status from public.orders where id = v_order) <> 'cancelled' then raise exception 'Unstarted order was not cancelled'; end if;
  v_rejected := false;
  begin
    perform public.begin_order_checkout(v_order, 'aa000000-0000-4000-8000-000000000001');
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'Order cannot start checkout' then raise; end if;
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'Cancelled order could start checkout'; end if;
  v_order := public.create_direct_order('cc000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001');
  perform public.cancel_pending_order(v_order, 'aa000000-0000-4000-8000-000000000002');
  if (select status from public.orders where id = v_order) <> 'cancelled' then raise exception 'Provider could not cancel unstarted quote'; end if;

  v_order := public.create_direct_order('cc000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001');
  perform public.begin_order_checkout(v_order, 'aa000000-0000-4000-8000-000000000001');
  if (select checkout_started_at from public.orders where id = v_order) is null then raise exception 'Checkout reservation was not saved'; end if;
  v_rejected := false;
  begin
    perform public.cancel_pending_order(v_order, 'aa000000-0000-4000-8000-000000000001');
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'Checkout has started or order is no longer pending' then raise; end if;
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'Checkout could be cancelled during an unresolved Tap request'; end if;
  if not exists (select 1 from public.orders where id = v_order and amount = 100 and platform_fee = 15 and provider_amount = 85) then
    raise exception 'Direct order must use persisted service price and fees';
  end if;
  v_rejected := false;
  begin
    perform public.settle_tap_charge(v_order, 'chg_database1', 'txn_1', 1, 'SAR');
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'Payment does not match order' then raise; end if;
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'Underpaid order was accepted'; end if;
  if (select status from public.orders where id = v_order) <> 'pending' then raise exception 'Failed settlement changed order'; end if;

  if public.settle_tap_charge(v_order, 'chg_database1', 'txn_1', 100, 'SAR') <> 'paid' then raise exception 'Settlement failed'; end if;
  if public.settle_tap_charge(v_order, 'chg_database1', 'txn_1', 100, 'SAR') <> 'paid' then raise exception 'Repeated settlement failed'; end if;
  v_rejected := false;
  begin
    perform public.settle_tap_charge(v_order, 'chg_database_other', 'txn_2', 100, 'SAR');
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'Payment does not match order' then raise; end if;
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'Another charge replaced the captured charge'; end if;

  update public.orders set status = 'awaiting_confirmation' where id = v_order;
  v_rejected := false;
  begin
    perform public.confirm_order(v_order, 'aa000000-0000-4000-8000-000000000003');
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'Order not found' then raise; end if;
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'Another customer confirmed the order'; end if;
  perform public.confirm_order(v_order, 'aa000000-0000-4000-8000-000000000001');
  perform public.confirm_order(v_order, 'aa000000-0000-4000-8000-000000000001');
  if (select count(*) from public.service_history where order_id = v_order) <> 1 then raise exception 'Duplicate history'; end if;
  if (select completed_projects from public.providers where id = 'bb000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'Confirmation incremented the project count more than once';
  end if;
  if public.settle_tap_charge(v_order, 'chg_database1', 'txn_1', 100, 'SAR') <> 'completed' then
    raise exception 'Late webhook regressed completed order';
  end if;

  v_request := public.request_provider_withdrawal('bb000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000002', 85);
  if (select status from public.withdrawal_requests where id = v_request) <> 'pending' then raise exception 'Withdrawal must await review'; end if;
  v_rejected := false;
  begin
    perform public.request_provider_withdrawal('bb000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000002', 1);
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'Insufficient available balance' then raise; end if;
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'Pending withdrawals did not reserve balance'; end if;
  update public.withdrawal_requests set status = 'rejected' where id = v_request;
  perform public.request_provider_withdrawal('bb000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000002', 85);

  v_second := public.create_direct_order('cc000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001');
  if v_second = v_order then raise exception 'Completed purchase prevented a new order'; end if;
  v_rejected := false;
  begin
    perform public.settle_tap_charge(v_second, 'chg_database1', 'txn_1', 100, 'SAR');
  exception when unique_violation then v_rejected := true;
  end;
  if not v_rejected then raise exception 'A charge paid multiple orders'; end if;
  perform public.settle_tap_charge(v_second, 'chg_database2', 'txn_2', 100, 'SAR');
  update public.orders set status = 'awaiting_confirmation' where id = v_second;
  -- Force the last statement in confirm_order to fail, proving earlier writes roll back.
  update public.providers set completed_projects = 2147483647 where id = 'bb000000-0000-4000-8000-000000000001';
  v_rejected := false;
  begin
    perform public.confirm_order(v_second, 'aa000000-0000-4000-8000-000000000001');
  exception when numeric_value_out_of_range then v_rejected := true;
  end;
  if not v_rejected then raise exception 'Expected provider counter overflow'; end if;
  if (select status from public.orders where id = v_second) <> 'awaiting_confirmation'
    or exists (select 1 from public.service_history where order_id = v_second) then
    raise exception 'Confirmation left partial ledger writes';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'aa000000-0000-4000-8000-000000000001', true);
do $$
declare v_rejected boolean := false;
begin
  begin
    perform public.create_direct_order('cc000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001');
  exception when insufficient_privilege then v_rejected := true;
  end;
  if not v_rejected then raise exception 'Browser can call privileged payment functions'; end if;
end;
$$;
rollback;
