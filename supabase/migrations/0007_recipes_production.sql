-- ============================================================
-- 0007: Recipes and Production
-- ============================================================

create table public.recipes (
  id bigint generated always as identity primary key,
  name text not null,
  category text not null check (category in ('food', 'snack', 'drink')),
  servings numeric not null,
  price numeric,
  linked_item_id bigint references public.items(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Ingredient lines are matched by name (+ unit), same as the app does today —
-- not a hard FK to items, so renaming an ingredient is a known soft edge
-- carried over intentionally rather than silently changed.
create table public.recipe_lines (
  id bigint generated always as identity primary key,
  recipe_id bigint not null references public.recipes(id) on delete cascade,
  name text not null,
  qty_num numeric not null,
  qty_unit text not null
);

create table public.productions (
  id bigint generated always as identity primary key,
  prod_number text not null unique,
  date timestamptz not null default now(),
  recipe_id bigint references public.recipes(id) on delete set null,
  recipe_name text not null,   -- snapshot, survives recipe edits/deletes
  qty_produced numeric not null,
  total_cost numeric not null,
  produced_by text
);

create table public.production_ingredients (
  id bigint generated always as identity primary key,
  production_id bigint not null references public.productions(id) on delete cascade,
  name text not null,
  qty numeric not null,
  unit text
);
