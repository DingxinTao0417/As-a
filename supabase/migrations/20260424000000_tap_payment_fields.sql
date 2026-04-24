-- Tap Payment + Phase 4 money model migration.
-- Standardizes order and withdrawal money fields to numeric SAR amounts instead of integer cents.
-- Safe for three common states:
-- 1) only *_cents exists: rename it to SAR column and divide by 100;
-- 2) both columns exist: backfill empty SAR column from *_cents, then drop *_cents;
-- 3) only SAR column exists: leave it in place and ensure numeric(12,2).

alter table if exists public.providers
  add column if not exists tap_destination_id text,
  add column if not exists tap_account_status text not null default 'not_connected',
  add column if not exists tap_onboarding_completed boolean not null default false;

alter table if exists public.orders
  add column if not exists currency text not null default 'SAR',
  add column if not exists tap_charge_id text,
  add column if not exists tap_transaction_id text,
  add column if not exists paid_at timestamp with time zone;

do $$
begin
  -- orders.amount
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'amount_cents')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'amount') then
    alter table public.orders rename column amount_cents to amount;
    alter table public.orders alter column amount type numeric(12,2) using round((amount::numeric / 100), 2);
  else
    alter table public.orders add column if not exists amount numeric(12,2) not null default 0;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'amount_cents') then
      update public.orders set amount = round((amount_cents::numeric / 100), 2) where amount_cents is not null and (amount is null or amount = 0);
      alter table public.orders drop column amount_cents;
    end if;
    alter table public.orders alter column amount type numeric(12,2) using round(amount::numeric, 2);
  end if;

  -- orders.platform_fee
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'platform_fee_cents')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'platform_fee') then
    alter table public.orders rename column platform_fee_cents to platform_fee;
    alter table public.orders alter column platform_fee type numeric(12,2) using round((platform_fee::numeric / 100), 2);
  else
    alter table public.orders add column if not exists platform_fee numeric(12,2) not null default 0;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'platform_fee_cents') then
      update public.orders set platform_fee = round((platform_fee_cents::numeric / 100), 2) where platform_fee_cents is not null and (platform_fee is null or platform_fee = 0);
      alter table public.orders drop column platform_fee_cents;
    end if;
    alter table public.orders alter column platform_fee type numeric(12,2) using round(platform_fee::numeric, 2);
  end if;

  -- orders.provider_amount
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'provider_amount_cents')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'provider_amount') then
    alter table public.orders rename column provider_amount_cents to provider_amount;
    alter table public.orders alter column provider_amount type numeric(12,2) using round((provider_amount::numeric / 100), 2);
  else
    alter table public.orders add column if not exists provider_amount numeric(12,2) not null default 0;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'provider_amount_cents') then
      update public.orders set provider_amount = round((provider_amount_cents::numeric / 100), 2) where provider_amount_cents is not null and (provider_amount is null or provider_amount = 0);
      alter table public.orders drop column provider_amount_cents;
    end if;
    alter table public.orders alter column provider_amount type numeric(12,2) using round(provider_amount::numeric, 2);
  end if;
end $$;

alter table if exists public.withdrawal_requests
  add column if not exists tap_transfer_id text,
  add column if not exists processed_at timestamp with time zone;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'withdrawal_requests' and column_name = 'amount_cents')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'withdrawal_requests' and column_name = 'amount') then
    alter table public.withdrawal_requests rename column amount_cents to amount;
    alter table public.withdrawal_requests alter column amount type numeric(12,2) using round((amount::numeric / 100), 2);
  else
    alter table public.withdrawal_requests add column if not exists amount numeric(12,2) not null default 0;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'withdrawal_requests' and column_name = 'amount_cents') then
      update public.withdrawal_requests set amount = round((amount_cents::numeric / 100), 2) where amount_cents is not null and (amount is null or amount = 0);
      alter table public.withdrawal_requests drop column amount_cents;
    end if;
    alter table public.withdrawal_requests alter column amount type numeric(12,2) using round(amount::numeric, 2);
  end if;
end $$;

alter table if exists public.profiles
  add column if not exists deletion_requested_at timestamp with time zone;

create index if not exists idx_providers_tap_destination_id
  on public.providers(tap_destination_id)
  where tap_destination_id is not null;

create index if not exists idx_orders_tap_charge_id
  on public.orders(tap_charge_id)
  where tap_charge_id is not null;

create index if not exists idx_orders_status_provider
  on public.orders(status, provider_id);

create index if not exists idx_orders_status_seeker
  on public.orders(status, seeker_id);
