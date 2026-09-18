-- ============================================================
-- 0004: items (Products — snacks, drinks, food, ingredients)
-- ============================================================

create table public.items (
  id bigint generated always as identity primary key,
  category text not null check (category in ('snack', 'drink', 'food', 'ingredient')),
  name text not null,
  size text not null default '',
  stock numeric not null default 0,
  unit text not null,
  cost numeric not null default 0,
  selling numeric,            -- null for ingredients (never sold directly)
  threshold numeric not null default 0,   -- minimum stock, for the low-stock alert
  max_stock numeric,          -- optional reorder ceiling
  sku text not null default '',
  supplier_id bigint references public.suppliers(id) on delete set null,
  conv_unit text,             -- estimated conversion, e.g. "1 kg ~ 8 pcs"
  conv_qty numeric,
  image_path text,            -- Supabase Storage object path (product-images bucket)
  source_plan_id bigint references public.cos_plans(id) on delete set null,
  source_food_id bigint references public.cos_foods(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint items_max_stock_check check (max_stock is null or max_stock >= threshold)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger items_set_updated_at
  before update on public.items
  for each row execute function public.set_updated_at();
