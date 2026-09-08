-- Trusted server entry points. Never grant these functions to browser roles: actor
-- IDs are supplied only after auth.getUser() succeeds in a server action.
begin;

alter table public.orders add column checkout_started_at timestamptz;

create unique index if not exists orders_tap_charge_id_unique
  on public.orders (tap_charge_id) where tap_charge_id is not null;

create or replace function public.begin_order_checkout(p_order_id uuid, p_actor_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or p_actor_id is null or v_order.seeker_id is distinct from p_actor_id
     or not public.is_account_active(p_actor_id) then
    raise exception 'Order not found';
  end if;
  if v_order.status <> 'pending' then raise exception 'Order cannot start checkout'; end if;
  -- Commit the reservation before talking to Tap. Never clear this on a timeout:
  -- the remote charge may have been created even when no response was received.
  update public.orders set checkout_started_at = coalesce(checkout_started_at, now()) where id = p_order_id;
end;
$$;

create or replace function public.cancel_pending_order(p_order_id uuid, p_actor_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or p_actor_id is null or not public.is_account_active(p_actor_id) or (
    v_order.seeker_id is distinct from p_actor_id and not exists (
      select 1 from public.providers where id = v_order.provider_id and user_id = p_actor_id
    )
  ) then raise exception 'Order not found'; end if;
  if v_order.status = 'cancelled' then return; end if;
  if v_order.status <> 'pending' or v_order.tap_charge_id is not null or v_order.checkout_started_at is not null then
    raise exception 'Checkout has started or order is no longer pending';
  end if;
  update public.orders set status = 'cancelled', cancelled_at = now() where id = p_order_id;
end;
$$;

create or replace function public.settle_tap_charge(
  p_order_id uuid, p_charge_id text, p_transaction_id text, p_amount numeric, p_currency text
) returns text language plpgsql security invoker set search_path = '' as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if p_charge_id is null or p_charge_id !~ '^chg_[A-Za-z0-9_-]+$'
     or p_amount is distinct from v_order.amount or p_currency is distinct from v_order.currency
     or p_currency <> 'SAR' or p_amount < 1
     or (v_order.tap_charge_id is not null and v_order.tap_charge_id <> p_charge_id) then
    raise exception 'Payment does not match order';
  end if;
  if v_order.status in ('paid', 'awaiting_confirmation', 'completed') and v_order.tap_charge_id = p_charge_id then
    return v_order.status;
  end if;
  if v_order.status <> 'pending' then raise exception 'Order cannot accept payment'; end if;
  update public.orders set status = 'paid', tap_charge_id = p_charge_id,
    tap_transaction_id = coalesce(nullif(p_transaction_id, ''), p_charge_id), paid_at = now()
    where id = p_order_id;
  return 'paid';
end;
$$;

create or replace function public.confirm_order(p_order_id uuid, p_actor_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or p_actor_id is null or v_order.seeker_id is distinct from p_actor_id then
    raise exception 'Order not found';
  end if;
  if not public.is_account_active(p_actor_id) then raise exception 'Account unavailable'; end if;
  -- A retried confirmation does not add a second history row or project count.
  if v_order.status = 'completed' then return; end if;
  if v_order.status <> 'awaiting_confirmation' then raise exception 'Order is not ready for confirmation'; end if;
  insert into public.service_history (
    order_id, seeker_id, provider_id, service_id, service_name_ar, service_name_en,
    service_description_ar, service_description_en, amount, status
  ) values (
    v_order.id, v_order.seeker_id, v_order.provider_id, v_order.service_id,
    v_order.service_name_ar, v_order.service_name_en,
    v_order.service_description_ar, v_order.service_description_en, v_order.amount, 'completed'
  );
  update public.orders set status = 'completed', completed_at = coalesce(completed_at, now()) where id = p_order_id;
  update public.providers set completed_projects = coalesce(completed_projects, 0) + 1 where id = v_order.provider_id;
end;
$$;

create or replace function public.request_provider_withdrawal(p_provider_id uuid, p_actor_id uuid, p_amount numeric)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_provider public.providers%rowtype;
  v_earned numeric;
  v_reserved numeric;
  v_request_id uuid;
begin
  if p_amount is null or p_amount::text in ('NaN', 'Infinity', '-Infinity')
     or p_amount < 1 or p_amount > 1000000 or p_amount <> round(p_amount, 2) then
    raise exception 'Invalid withdrawal amount';
  end if;
  -- All withdrawal requests for a provider serialize against the same row.
  select * into v_provider from public.providers where id = p_provider_id for update;
  if not found or p_actor_id is null or v_provider.user_id is distinct from p_actor_id then
    raise exception 'Provider not found';
  end if;
  if not public.is_account_active(p_actor_id) then raise exception 'Account unavailable'; end if;
  if v_provider.tap_destination_id is null or v_provider.tap_destination_id like 'tap_placeholder_%'
     or v_provider.tap_onboarding_completed is distinct from true
     or v_provider.tap_account_status is distinct from 'active' then
    raise exception 'Payment account verification required';
  end if;
  select coalesce(sum(provider_amount), 0) into v_earned from public.orders
    where provider_id = p_provider_id and status = 'completed';
  select coalesce(sum(amount), 0) into v_reserved from public.withdrawal_requests
    where provider_id = p_provider_id and status in ('pending', 'approved', 'completed');
  if p_amount > v_earned - v_reserved then raise exception 'Insufficient available balance'; end if;
  insert into public.withdrawal_requests (provider_id, amount, status)
    values (p_provider_id, p_amount, 'pending') returning id into v_request_id;
  return v_request_id;
end;
$$;

create or replace function public.create_direct_order(p_service_id uuid, p_actor_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_service public.services%rowtype;
  v_provider_user_id uuid;
  v_order_id uuid;
  v_conversation_id uuid;
  v_fee numeric;
begin
  -- Serialize a seeker's repeated checkout requests; a lost HTTP response is safe to retry.
  perform id from public.profiles where id = p_actor_id and deletion_requested_at is null for update;
  if not found then raise exception 'Customer not found'; end if;
  select * into v_service from public.services where id = p_service_id for share;
  if not found or v_service.is_active is distinct from true then raise exception 'Service unavailable'; end if;
  select user_id into v_provider_user_id from public.providers where id = v_service.provider_id;
  if not found or v_provider_user_id = p_actor_id then raise exception 'Invalid service provider'; end if;
  if not public.is_account_active(v_provider_user_id) then raise exception 'Provider unavailable'; end if;
  if v_service.price is null or v_service.price::text in ('NaN', 'Infinity', '-Infinity')
     or v_service.price < 1 or v_service.price > 1000000 or v_service.price <> round(v_service.price, 2) then
    raise exception 'Invalid service price';
  end if;
  select id into v_order_id from public.orders
    where seeker_id = p_actor_id and service_id = p_service_id and status = 'pending'
    order by created_at, id limit 1;
  if found then return v_order_id; end if;
  insert into public.conversations (seeker_id, provider_id) values (p_actor_id, v_service.provider_id)
    on conflict (seeker_id, provider_id) do nothing;
  select id into v_conversation_id from public.conversations
    where seeker_id = p_actor_id and provider_id = v_service.provider_id;
  v_fee := round(v_service.price * 0.15, 2);
  insert into public.orders (
    conversation_id, seeker_id, provider_id, service_id, service_name_ar, service_name_en,
    service_description_ar, service_description_en, amount, platform_fee, provider_amount, currency, status
  ) values (
    v_conversation_id, p_actor_id, v_service.provider_id, v_service.id, v_service.name_ar, v_service.name_en,
    coalesce(v_service.description_ar, ''), coalesce(v_service.description_en, ''),
    v_service.price, v_fee, v_service.price - v_fee, 'SAR', 'pending'
  ) returning id into v_order_id;
  return v_order_id;
end;
$$;

revoke all on function public.settle_tap_charge(uuid, text, text, numeric, text) from public, anon, authenticated;
revoke all on function public.begin_order_checkout(uuid, uuid) from public, anon, authenticated;
revoke all on function public.cancel_pending_order(uuid, uuid) from public, anon, authenticated;
revoke all on function public.confirm_order(uuid, uuid) from public, anon, authenticated;
revoke all on function public.request_provider_withdrawal(uuid, uuid, numeric) from public, anon, authenticated;
revoke all on function public.create_direct_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.settle_tap_charge(uuid, text, text, numeric, text) to service_role;
grant execute on function public.begin_order_checkout(uuid, uuid) to service_role;
grant execute on function public.cancel_pending_order(uuid, uuid) to service_role;
grant execute on function public.confirm_order(uuid, uuid) to service_role;
grant execute on function public.request_provider_withdrawal(uuid, uuid, numeric) to service_role;
grant execute on function public.create_direct_order(uuid, uuid) to service_role;

commit;
