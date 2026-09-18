-- ============================================================
-- 0006: Purchases (procurement)
-- ============================================================

create table public.purchases (
  id bigint generated always as identity primary key,
  po_number text not null unique,
  supplier_id bigint references public.suppliers(id) on delete set null,
  received_by text,
  notes text,
  total_cost numeric not null default 0,
  created_at timestamptz not null default now()
);

create table public.purchase_lines (
  id bigint generated always as identity primary key,
  purchase_id bigint not null references public.purchases(id) on delete cascade,
  item_id bigint references public.items(id) on delete set null,
  name text not null,     -- snapshot of the item's name at purchase time
  unit text,
  qty numeric not null,
  unit_cost numeric not null
);
