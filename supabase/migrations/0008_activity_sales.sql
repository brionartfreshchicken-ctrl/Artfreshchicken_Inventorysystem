-- ============================================================
-- 0008: the stock-movement log (activity) and POS sales
-- ============================================================

create table public.activity (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  item_id bigint references public.items(id) on delete set null,
  name text not null,      -- item name snapshot
  category text,
  type text not null check (type in ('in', 'out')),
  reason text not null check (reason in (
    'purchase', 'produced', 'correct_in', 'sold', 'waste', 'used', 'correct_out', 'adjust'
  )),
  qty numeric not null,
  unit text,
  cost numeric,             -- cost/unit at the time
  selling numeric,          -- selling price at the time
  by_user_id uuid references public.profiles(id) on delete set null,
  by_name text,              -- snapshot, survives account deletion
  ref text,                  -- PO/SALE/PROD document number this came from
  voided boolean not null default false,
  void_reason text,
  voided_by text,
  voided_at timestamptz
);

create table public.sales (
  id bigint generated always as identity primary key,
  txn_number text not null unique,
  ts timestamptz not null default now(),
  cashier_id uuid references public.profiles(id) on delete set null,
  cashier_name text,
  subtotal numeric not null,
  discount numeric not null default 0,
  total numeric not null,
  payment_method text not null check (payment_method in ('cash', 'gcash', 'card', 'other')),
  cash_received numeric,
  change numeric,
  status text not null default 'completed' check (status in ('completed', 'voided', 'refunded')),
  void_reason text,
  voided_by text,
  voided_at timestamptz
);

create table public.sale_items (
  id bigint generated always as identity primary key,
  sale_id bigint not null references public.sales(id) on delete cascade,
  item_id bigint references public.items(id) on delete set null,
  name text not null,
  qty numeric not null,
  unit_price numeric not null,
  line_total numeric not null
);
