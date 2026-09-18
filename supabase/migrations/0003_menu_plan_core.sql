-- ============================================================
-- 0003: Menu Plan (Cost-of-Sales planning) — plans and foods,
-- created before `items` since a mirrored POS item points back at
-- the food it came from. cos_foods.linked_item_id -> items is added
-- in 0005 once the items table exists (the reference is circular).
-- ============================================================

create table public.cos_plans (
  id bigint generated always as identity primary key,
  name text not null,
  date date not null,
  created_at timestamptz not null default now()
);

create table public.cos_foods (
  id bigint generated always as identity primary key,
  plan_id bigint not null references public.cos_plans(id) on delete cascade,
  name text,
  servings numeric not null default 0,
  served numeric not null default 0,
  price numeric,
  prices_hidden boolean not null default false,
  collapsed boolean not null default false,
  saved_at timestamptz,
  linked_item_id bigint,   -- FK added in 0005
  deducted jsonb,          -- snapshot: [{name, qty, unit}, ...] or null
  deducted_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.cos_food_lines (
  id bigint generated always as identity primary key,
  food_id bigint not null references public.cos_foods(id) on delete cascade,
  name text not null,
  qty_num numeric,
  qty_unit text,
  price_num numeric,
  price_mode text check (price_mode in ('unit', 'total')),
  manual boolean not null default false
);
