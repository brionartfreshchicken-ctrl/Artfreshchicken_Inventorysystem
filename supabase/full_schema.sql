-- FoodTrack: full Supabase schema (all migrations 0001-0018 concatenated)
-- Paste this whole file into the Supabase SQL Editor and click Run.

-- ============================================================
-- 0001: profiles (accounts), tied to Supabase Auth
-- ============================================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  name text not null,
  role text not null default 'staff' check (role in ('admin','staff')),
  created_at timestamptz not null default now()
);

-- True if the currently authenticated user is an admin. Used throughout RLS.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

-- Creates a profile row automatically whenever someone signs up via
-- Supabase Auth. The very first account ever created becomes admin
-- (same as the app's original "first account is the owner" Setup flow);
-- every account after that defaults to staff.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  first_account boolean;
begin
  select not exists (select 1 from public.profiles) into first_account;
  insert into public.profiles (id, username, name, role)
  values (
    new.id,
    lower(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))),
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    case when first_account then 'admin' else 'staff' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Blocks demoting or deleting the sole remaining admin (today this was
-- only a client-side check before the delete/role-change buttons).
create or replace function public.prevent_last_admin_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'DELETE' and old.role = 'admin')
     or (tg_op = 'UPDATE' and old.role = 'admin' and new.role <> 'admin') then
    if (select count(*) from public.profiles where role = 'admin') <= 1 then
      raise exception 'Cannot remove or demote the last remaining admin';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger profiles_protect_last_admin
  before update or delete on public.profiles
  for each row execute function public.prevent_last_admin_change();

-- Only an admin may change someone's role (prevents a staff account from
-- promoting itself by editing its own profile row).
create or replace function public.prevent_self_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role <> old.role and not public.is_admin() then
    raise exception 'Only an admin can change roles';
  end if;
  return new;
end;
$$;

create trigger profiles_prevent_role_escalation
  before update on public.profiles
  for each row execute function public.prevent_self_role_escalation();


-- ============================================================
-- 0002: suppliers
-- ============================================================

create table public.suppliers (
  id bigint generated always as identity primary key,
  name text not null,
  contact text,
  phone text,
  email text,
  address text,
  notes text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now()
);


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


-- ============================================================
-- 0005: close the circular reference — a Menu Plan food, once saved,
-- mirrors itself as a sellable POS item (items.source_food_id), and
-- that same food remembers which item it produced (cos_foods.linked_item_id).
-- ============================================================

alter table public.cos_foods
  add constraint cos_foods_linked_item_id_fkey
  foreign key (linked_item_id) references public.items(id) on delete set null;


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


-- ============================================================
-- 0009: Operating Expenses, Staff Directory, LPG Usage
-- ============================================================

create table public.expenses (
  id bigint generated always as identity primary key,
  expense_number text not null unique,
  date date not null,
  category text not null,
  description text,
  amount numeric not null,
  payment_method text not null default 'cash' check (payment_method in ('cash', 'gcash', 'card', 'other')),
  recorded_by text,
  notes text,
  created_at timestamptz not null default now()
);

create table public.staff (
  id bigint generated always as identity primary key,
  name text not null,
  position text,
  wage numeric,
  wage_period text check (wage_period in ('day', 'month')),
  created_at timestamptz not null default now()
);

-- Replaces the old workDates text-array with real rows.
create table public.staff_work_dates (
  staff_id bigint not null references public.staff(id) on delete cascade,
  work_date date not null,
  primary key (staff_id, work_date)
);

create table public.lpg_logs (
  id bigint generated always as identity primary key,
  date_start date,
  date_end date,     -- null = still in use
  price numeric
);


-- ============================================================
-- 0010: Settings (singleton row) and document-number sequences
-- ============================================================

-- Singleton-row trick: id is boolean and must be true, so at most one row
-- can ever exist.
create table public.settings (
  id boolean primary key default true,
  gcash_qr_path text,          -- Supabase Storage object path
  retention_days integer not null default 0 check (retention_days >= 0),
  last_purge timestamptz,
  constraint settings_singleton check (id)
);

insert into public.settings (id) values (true);

create table public.doc_sequences (
  key text primary key,   -- e.g. 'PO-20260918'
  seq integer not null default 0
);

-- Atomic replacement for the old client-side per-day counter (which would
-- race across two devices) — e.g. next_doc_number('PO') -> 'PO-20260918-0001'.
create or replace function public.next_doc_number(prefix text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  day_key text := prefix || '-' || to_char(now(), 'YYYYMMDD');
  next_seq integer;
begin
  insert into public.doc_sequences (key, seq) values (day_key, 1)
  on conflict (key) do update set seq = doc_sequences.seq + 1
  returning seq into next_seq;
  return day_key || '-' || lpad(next_seq::text, 4, '0');
end;
$$;


-- ============================================================
-- 0011: server-side movement logic — mirrors reverseMovementStock(),
-- voidMovement() and deleteMovementPermanently() from
-- js/inventory/11-inventory.js, plus the retention purge from
-- js/reports/19-history-retention-staff-reports.js. Running these as
-- SECURITY DEFINER functions makes "reverse stock + touch the log row"
-- atomic instead of two separate client calls that could partially fail.
-- ============================================================

-- Undoes exactly what one activity record did to stock — used by both
-- void and permanent-delete below. If the record came from a Menu-Plan
-- food (items.source_food_id), the linked food's servings/served are
-- adjusted too, the same way the client-side version did.
create or replace function public.reverse_movement_stock(p_activity_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.activity%rowtype;
  it public.items%rowtype;
  fd public.cos_foods%rowtype;
  has_food boolean := false;
begin
  select * into a from public.activity where id = p_activity_id;
  if not found or a.item_id is null then
    return;
  end if;

  select * into it from public.items where id = a.item_id;
  if not found then
    return;
  end if;

  if it.source_food_id is not null then
    select * into fd from public.cos_foods where id = it.source_food_id;
    has_food := found;
  end if;

  if a.type = 'in' then
    update public.items set stock = greatest(0, stock - a.qty) where id = it.id;
    if has_food then
      update public.cos_foods set servings = greatest(0, servings - a.qty) where id = fd.id;
    end if;
  else
    update public.items set stock = stock + a.qty where id = it.id;
    if has_food then
      if a.reason = 'sold' then
        update public.cos_foods set served = greatest(0, served - a.qty) where id = fd.id;
      else
        update public.cos_foods set servings = greatest(0, servings + a.qty) where id = fd.id;
      end if;
    end if;
  end if;
end;
$$;

-- Marks a movement voided (financial records are corrected, never erased),
-- and reverses its stock effect. Admin only.
create or replace function public.void_activity(p_activity_id bigint, p_reason text, p_by text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can void records';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to void a record';
  end if;

  perform public.reverse_movement_stock(p_activity_id);

  update public.activity
    set voided = true, void_reason = p_reason, voided_by = p_by, voided_at = now()
    where id = p_activity_id and voided = false;
end;
$$;

-- Hard-deletes a movement row. If it hadn't been voided yet, reverses its
-- stock effect first (same math as void). Admin only.
create or replace function public.delete_activity_permanently(p_activity_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  was_voided boolean;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can delete records';
  end if;

  select voided into was_voided from public.activity where id = p_activity_id;
  if was_voided is null then
    return;
  end if;

  if not was_voided then
    perform public.reverse_movement_stock(p_activity_id);
  end if;

  delete from public.activity where id = p_activity_id;
end;
$$;

-- Voids every 'sold' activity line linked to a sale (matched by ref =
-- txn_number) and marks the sale itself voided. Admin only.
create or replace function public.void_sale(p_sale_id bigint, p_reason text, p_by text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.sales%rowtype;
  r record;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can void a sale';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to void a sale';
  end if;

  select * into s from public.sales where id = p_sale_id;
  if not found or s.status <> 'completed' then
    raise exception 'That sale is not available to void';
  end if;

  for r in
    select id from public.activity
    where ref = s.txn_number and reason = 'sold' and voided = false
  loop
    perform public.reverse_movement_stock(r.id);
    update public.activity
      set voided = true, void_reason = p_reason, voided_by = p_by, voided_at = now()
      where id = r.id;
  end loop;

  update public.sales
    set status = 'voided', void_reason = p_reason, voided_by = p_by, voided_at = now()
    where id = p_sale_id;
end;
$$;

-- Hard-deletes a sale and every activity line linked to it, reversing
-- stock for any line not already voided. Admin only.
create or replace function public.delete_sale_permanently(p_sale_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s_txn text;
  r record;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can delete a sale';
  end if;

  select txn_number into s_txn from public.sales where id = p_sale_id;
  if s_txn is null then
    return;
  end if;

  for r in
    select id, voided from public.activity where ref = s_txn and reason = 'sold'
  loop
    if not r.voided then
      perform public.reverse_movement_stock(r.id);
    end if;
    delete from public.activity where id = r.id;
  end loop;

  delete from public.sales where id = p_sale_id;
end;
$$;

-- Deletes activity rows older than settings.retention_days. Called once
-- at app startup (client-triggered), same timing as today.
create or replace function public.purge_old_activity()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff timestamptz;
  days integer;
  removed integer;
begin
  select retention_days into days from public.settings where id = true;
  if days is null or days <= 0 then
    return 0;
  end if;

  cutoff := now() - (days || ' days')::interval;
  delete from public.activity where ts < cutoff;
  get diagnostics removed = row_count;

  update public.settings set last_purge = now() where id = true;
  return removed;
end;
$$;


-- ============================================================
-- 0012: Row Level Security
--
-- SELECT is open to any signed-in user on every table — this matches the
-- app's existing trust model (staff already see the same data today, the
-- dashboard just hides money tiles as a UI convenience, not a real
-- security boundary). WRITE access mirrors the ADMIN_ONLY/STAFF_ONLY
-- page split and the ad hoc isAdmin() checks found throughout the app:
--
--   admin-only tables   (suppliers/purchases/expenses/staff/lpg/settings):
--     select: any signed-in user · insert/update/delete: admin only
--
--   staff-managed tables (items, recipes, production, menu plan):
--     select/insert/update: any signed-in user · delete: admin only
--     (recipes/cos_* allow full CRUD to any signed-in user — no delete
--     restriction exists in the app for those pages today)
--
--   activity & sales:
--     select/insert: any signed-in user · update/delete: NOT allowed
--     directly at all — voiding and permanent delete only happen through
--     the SECURITY DEFINER functions in 0011, which enforce admin-only
--     and bypass RLS themselves.
-- ============================================================

alter table public.profiles enable row level security;
alter table public.suppliers enable row level security;
alter table public.items enable row level security;
alter table public.cos_plans enable row level security;
alter table public.cos_foods enable row level security;
alter table public.cos_food_lines enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_lines enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_lines enable row level security;
alter table public.productions enable row level security;
alter table public.production_ingredients enable row level security;
alter table public.activity enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.expenses enable row level security;
alter table public.staff enable row level security;
alter table public.staff_work_dates enable row level security;
alter table public.lpg_logs enable row level security;
alter table public.settings enable row level security;
alter table public.doc_sequences enable row level security;

-- ---------- profiles ----------
-- Row creation happens only via the handle_new_user trigger (SECURITY
-- DEFINER, bypasses RLS) — no client-side insert policy on purpose.
create policy profiles_select on public.profiles
  for select using ((select auth.uid()) is not null);

create policy profiles_update on public.profiles
  for update
  using (id = (select auth.uid()) or public.is_admin())
  with check (id = (select auth.uid()) or public.is_admin());

create policy profiles_delete on public.profiles
  for delete using (public.is_admin());

-- ---------- admin-managed tables ----------
create policy suppliers_select on public.suppliers for select using ((select auth.uid()) is not null);
create policy suppliers_insert on public.suppliers for insert with check (public.is_admin());
create policy suppliers_update on public.suppliers for update using (public.is_admin()) with check (public.is_admin());
create policy suppliers_delete on public.suppliers for delete using (public.is_admin());

create policy purchases_select on public.purchases for select using ((select auth.uid()) is not null);
create policy purchases_insert on public.purchases for insert with check (public.is_admin());
create policy purchases_update on public.purchases for update using (public.is_admin()) with check (public.is_admin());
create policy purchases_delete on public.purchases for delete using (public.is_admin());

create policy purchase_lines_select on public.purchase_lines for select using ((select auth.uid()) is not null);
create policy purchase_lines_insert on public.purchase_lines for insert with check (public.is_admin());
create policy purchase_lines_update on public.purchase_lines for update using (public.is_admin()) with check (public.is_admin());
create policy purchase_lines_delete on public.purchase_lines for delete using (public.is_admin());

create policy expenses_select on public.expenses for select using ((select auth.uid()) is not null);
create policy expenses_insert on public.expenses for insert with check (public.is_admin());
create policy expenses_update on public.expenses for update using (public.is_admin()) with check (public.is_admin());
create policy expenses_delete on public.expenses for delete using (public.is_admin());

create policy staff_select on public.staff for select using ((select auth.uid()) is not null);
create policy staff_insert on public.staff for insert with check (public.is_admin());
create policy staff_update on public.staff for update using (public.is_admin()) with check (public.is_admin());
create policy staff_delete on public.staff for delete using (public.is_admin());

create policy staff_work_dates_select on public.staff_work_dates for select using ((select auth.uid()) is not null);
create policy staff_work_dates_insert on public.staff_work_dates for insert with check (public.is_admin());
create policy staff_work_dates_update on public.staff_work_dates for update using (public.is_admin()) with check (public.is_admin());
create policy staff_work_dates_delete on public.staff_work_dates for delete using (public.is_admin());

create policy lpg_logs_select on public.lpg_logs for select using ((select auth.uid()) is not null);
create policy lpg_logs_insert on public.lpg_logs for insert with check (public.is_admin());
create policy lpg_logs_update on public.lpg_logs for update using (public.is_admin()) with check (public.is_admin());
create policy lpg_logs_delete on public.lpg_logs for delete using (public.is_admin());

create policy settings_select on public.settings for select using ((select auth.uid()) is not null);
create policy settings_update on public.settings for update using (public.is_admin()) with check (public.is_admin());

create policy doc_sequences_select on public.doc_sequences for select using ((select auth.uid()) is not null);
-- writes to doc_sequences only ever happen inside next_doc_number() (SECURITY
-- DEFINER, bypasses RLS) — no client-side write policy on purpose.

-- ---------- staff-managed tables ----------
create policy items_select on public.items for select using ((select auth.uid()) is not null);
create policy items_insert on public.items for insert with check ((select auth.uid()) is not null);
create policy items_update on public.items for update using ((select auth.uid()) is not null) with check ((select auth.uid()) is not null);
create policy items_delete on public.items for delete using (public.is_admin());

create policy recipes_select on public.recipes for select using ((select auth.uid()) is not null);
create policy recipes_insert on public.recipes for insert with check ((select auth.uid()) is not null);
create policy recipes_update on public.recipes for update using ((select auth.uid()) is not null) with check ((select auth.uid()) is not null);
create policy recipes_delete on public.recipes for delete using ((select auth.uid()) is not null);

create policy recipe_lines_select on public.recipe_lines for select using ((select auth.uid()) is not null);
create policy recipe_lines_insert on public.recipe_lines for insert with check ((select auth.uid()) is not null);
create policy recipe_lines_update on public.recipe_lines for update using ((select auth.uid()) is not null) with check ((select auth.uid()) is not null);
create policy recipe_lines_delete on public.recipe_lines for delete using ((select auth.uid()) is not null);

create policy productions_select on public.productions for select using ((select auth.uid()) is not null);
create policy productions_insert on public.productions for insert with check ((select auth.uid()) is not null);
create policy productions_update on public.productions for update using (public.is_admin()) with check (public.is_admin());
create policy productions_delete on public.productions for delete using (public.is_admin());

create policy production_ingredients_select on public.production_ingredients for select using ((select auth.uid()) is not null);
create policy production_ingredients_insert on public.production_ingredients for insert with check ((select auth.uid()) is not null);
create policy production_ingredients_update on public.production_ingredients for update using (public.is_admin()) with check (public.is_admin());
create policy production_ingredients_delete on public.production_ingredients for delete using (public.is_admin());

create policy cos_plans_select on public.cos_plans for select using ((select auth.uid()) is not null);
create policy cos_plans_insert on public.cos_plans for insert with check ((select auth.uid()) is not null);
create policy cos_plans_update on public.cos_plans for update using ((select auth.uid()) is not null) with check ((select auth.uid()) is not null);
create policy cos_plans_delete on public.cos_plans for delete using ((select auth.uid()) is not null);

create policy cos_foods_select on public.cos_foods for select using ((select auth.uid()) is not null);
create policy cos_foods_insert on public.cos_foods for insert with check ((select auth.uid()) is not null);
create policy cos_foods_update on public.cos_foods for update using ((select auth.uid()) is not null) with check ((select auth.uid()) is not null);
create policy cos_foods_delete on public.cos_foods for delete using ((select auth.uid()) is not null);

create policy cos_food_lines_select on public.cos_food_lines for select using ((select auth.uid()) is not null);
create policy cos_food_lines_insert on public.cos_food_lines for insert with check ((select auth.uid()) is not null);
create policy cos_food_lines_update on public.cos_food_lines for update using ((select auth.uid()) is not null) with check ((select auth.uid()) is not null);
create policy cos_food_lines_delete on public.cos_food_lines for delete using ((select auth.uid()) is not null);

-- ---------- activity & sales: select/insert only, no direct update/delete ----------
create policy activity_select on public.activity for select using ((select auth.uid()) is not null);
create policy activity_insert on public.activity for insert with check ((select auth.uid()) is not null);

create policy sales_select on public.sales for select using ((select auth.uid()) is not null);
create policy sales_insert on public.sales for insert with check ((select auth.uid()) is not null);

create policy sale_items_select on public.sale_items for select using ((select auth.uid()) is not null);
create policy sale_items_insert on public.sale_items for insert with check ((select auth.uid()) is not null);


-- ============================================================
-- 0013: indexes for the queries the app actually runs
-- (date-range filters on activity/sales, and every one-to-many join)
-- ============================================================

create index idx_activity_ts on public.activity (ts desc);
create index idx_activity_item_id on public.activity (item_id);
create index idx_activity_reason on public.activity (reason);
create index idx_activity_ref on public.activity (ref);

create index idx_sales_ts on public.sales (ts desc);
create index idx_sale_items_sale_id on public.sale_items (sale_id);

create index idx_items_category on public.items (category);
create index idx_items_supplier_id on public.items (supplier_id);
create index idx_items_source_plan_id on public.items (source_plan_id);

create index idx_purchase_lines_purchase_id on public.purchase_lines (purchase_id);
create index idx_purchases_supplier_id on public.purchases (supplier_id);

create index idx_recipe_lines_recipe_id on public.recipe_lines (recipe_id);
create index idx_production_ingredients_production_id on public.production_ingredients (production_id);

create index idx_cos_foods_plan_id on public.cos_foods (plan_id);
create index idx_cos_food_lines_food_id on public.cos_food_lines (food_id);

create index idx_staff_work_dates_staff_id on public.staff_work_dates (staff_id);


-- ============================================================
-- 0014: username -> email lookup for sign-in (the app signs in by
-- username, but Supabase Auth identifies accounts by email), plus a
-- pre-signup username-availability check. Both are SECURITY DEFINER
-- functions callable by anonymous (not-yet-signed-in) clients, so they
-- don't require opening up the profiles table itself to anon access.
-- ============================================================

alter table public.profiles add column email text;

-- Re-created to also populate the new email column.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  first_account boolean;
begin
  select not exists (select 1 from public.profiles) into first_account;
  insert into public.profiles (id, username, name, role, email)
  values (
    new.id,
    lower(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))),
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    -- Role is NEVER taken from client-supplied signup metadata (that would
    -- let anyone self-promote to admin) — only ever first-account-is-admin.
    case when first_account then 'admin' else 'staff' end,
    new.email
  );
  return new;
end;
$$;

-- Keeps profiles.email in sync if someone changes their auth email later.
create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row execute function public.sync_profile_email();

create or replace function public.email_for_username(p_username text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select email from public.profiles where username = lower(trim(p_username));
$$;

create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.profiles where username = lower(trim(p_username))
  );
$$;

-- Lets the (anonymous, not-yet-signed-in) login screen tell whether to show
-- first-run Setup or the normal Sign in/Sign up tabs.
create or replace function public.accounts_exist()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles);
$$;

grant execute on function public.email_for_username(text) to anon, authenticated;
grant execute on function public.username_available(text) to anon, authenticated;
grant execute on function public.accounts_exist() to anon, authenticated;


-- ============================================================
-- 0015: Supabase Storage bucket for product photos / the GCash QR
-- image, and complete_purchase() — completing a purchase touches
-- purchases + purchase_lines + items (stock, cost) + activity all at
-- once, so it runs as one atomic function instead of several
-- sequential client calls that could partially fail.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

create policy "product_images_public_read"
  on storage.objects for select
  using (bucket_id = 'product-images');

create policy "product_images_authenticated_write"
  on storage.objects for insert
  with check (bucket_id = 'product-images' and (select auth.uid()) is not null);

create policy "product_images_authenticated_update"
  on storage.objects for update
  using (bucket_id = 'product-images' and (select auth.uid()) is not null)
  with check (bucket_id = 'product-images' and (select auth.uid()) is not null);

create policy "product_images_authenticated_delete"
  on storage.objects for delete
  using (bucket_id = 'product-images' and (select auth.uid()) is not null);

-- p_lines: jsonb array of {item_id, qty, unit_cost}. Returns the new
-- purchase's id. Mirrors what btnCompletePurchase used to do client-side
-- in js/procurement/13-purchases.js: stock += qty, cost = unit_cost per
-- line, one 'purchase'/'in' activity row per line, one purchases header
-- row with the sum as total_cost.
create or replace function public.complete_purchase(
  p_supplier_id bigint,
  p_received_by text,
  p_notes text,
  p_lines jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po_number text;
  v_purchase_id bigint;
  v_total numeric := 0;
  v_line record;
  v_item public.items%rowtype;
  v_by_name text;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can record a purchase';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'A purchase needs at least one line';
  end if;

  select name into v_by_name from public.profiles where id = (select auth.uid());
  v_po_number := public.next_doc_number('PO');

  for v_line in select * from jsonb_to_recordset(p_lines) as x(item_id bigint, qty numeric, unit_cost numeric)
  loop
    v_total := v_total + v_line.qty * v_line.unit_cost;
  end loop;

  insert into public.purchases (po_number, supplier_id, received_by, notes, total_cost)
  values (v_po_number, p_supplier_id, p_received_by, p_notes, v_total)
  returning id into v_purchase_id;

  for v_line in select * from jsonb_to_recordset(p_lines) as x(item_id bigint, qty numeric, unit_cost numeric)
  loop
    select * into v_item from public.items where id = v_line.item_id;
    if not found then
      raise exception 'Item % no longer exists', v_line.item_id;
    end if;

    insert into public.purchase_lines (purchase_id, item_id, name, unit, qty, unit_cost)
    values (v_purchase_id, v_item.id, v_item.name, v_item.unit, v_line.qty, v_line.unit_cost);

    update public.items
      set stock = stock + v_line.qty, cost = v_line.unit_cost
      where id = v_item.id;

    insert into public.activity
      (item_id, name, category, type, reason, qty, unit, cost, selling, by_user_id, by_name, ref)
    values
      (v_item.id, v_item.name, v_item.category, 'in', 'purchase', v_line.qty, v_item.unit,
       v_line.unit_cost, v_item.selling, (select auth.uid()), v_by_name, v_po_number);
  end loop;

  return v_purchase_id;
end;
$$;

grant execute on function public.complete_purchase(bigint, text, text, jsonb) to authenticated;


-- ============================================================
-- 0016: a Menu Plan ingredient line's cost can be auto-calculated
-- (qty x unit price) or typed directly ("manual"), so — like the app's
-- own `total` field — it has to be stored, not just derived on read.
-- ============================================================

alter table public.cos_food_lines add column total_cost numeric;


-- ============================================================
-- 0017: complete_production() — cooking a recipe touches every
-- ingredient's stock, the linked sellable item's stock/cost, the
-- activity rows for all of that, and the productions + production_
-- ingredients record, all at once. Same reasoning as complete_purchase.
--
-- p_ingredient_lines: jsonb array of {item_id, name, need, unit}.
-- Not admin-gated — Production is a Staff-accessible page, same as the
-- rest of Menu Plan.
-- ============================================================

create or replace function public.complete_production(
  p_recipe_id bigint,
  p_qty_produced numeric,
  p_produced_by text,
  p_ingredient_lines jsonb,
  p_linked_item_id bigint,
  p_total_cost numeric
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prod_number text;
  v_production_id bigint;
  v_line record;
  v_item public.items%rowtype;
  v_by_name text;
  v_by_id uuid := (select auth.uid());
  v_recipe public.recipes%rowtype;
  v_linked_cost numeric;
begin
  select name into v_by_name from public.profiles where id = v_by_id;
  select * into v_recipe from public.recipes where id = p_recipe_id;
  if not found then
    raise exception 'Recipe no longer exists';
  end if;

  v_prod_number := public.next_doc_number('PROD');

  for v_line in select * from jsonb_to_recordset(p_ingredient_lines)
    as x(item_id bigint, name text, need numeric, unit text)
  loop
    select * into v_item from public.items where id = v_line.item_id;
    if not found then
      raise exception 'Ingredient item % no longer exists', v_line.item_id;
    end if;
    if v_line.need > v_item.stock then
      raise exception 'Not enough % on hand', v_item.name;
    end if;

    update public.items set stock = round((stock - v_line.need)::numeric, 3) where id = v_item.id;

    insert into public.activity
      (item_id, name, category, type, reason, qty, unit, cost, selling, by_user_id, by_name, ref)
    values
      (v_item.id, v_item.name, v_item.category, 'out', 'used', v_line.need, v_item.unit,
       v_item.cost, v_item.selling, v_by_id, v_by_name, v_prod_number);
  end loop;

  if p_linked_item_id is not null then
    select * into v_item from public.items where id = p_linked_item_id;
    if found then
      v_linked_cost := case when p_qty_produced > 0 then p_total_cost / p_qty_produced else v_item.cost end;
      update public.items set stock = stock + p_qty_produced, cost = v_linked_cost where id = v_item.id;

      insert into public.activity
        (item_id, name, category, type, reason, qty, unit, cost, selling, by_user_id, by_name, ref)
      values
        (v_item.id, v_item.name, v_item.category, 'in', 'produced', p_qty_produced, v_item.unit,
         v_linked_cost, v_item.selling, v_by_id, v_by_name, v_prod_number);
    end if;
  end if;

  insert into public.productions (prod_number, date, recipe_id, recipe_name, qty_produced, total_cost, produced_by)
  values (v_prod_number, now(), p_recipe_id, v_recipe.name, p_qty_produced, p_total_cost, p_produced_by)
  returning id into v_production_id;

  insert into public.production_ingredients (production_id, name, qty, unit)
  select v_production_id, x.name, x.need, x.unit
  from jsonb_to_recordset(p_ingredient_lines) as x(item_id bigint, name text, need numeric, unit text);

  return v_production_id;
end;
$$;

grant execute on function public.complete_production(bigint, numeric, text, jsonb, bigint, numeric) to authenticated;


-- ============================================================
-- 0018: complete_sale() — checkout touches every cart line's item
-- stock, the activity rows, and the sales + sale_items record all at
-- once. Also re-validates stock server-side (not just trusting the
-- client's last read), so two terminals selling the last of something
-- at the same moment can't both succeed.
--
-- p_items: jsonb array of {item_id, name, qty, unit_price, line_total}.
-- ============================================================

create or replace function public.complete_sale(
  p_items jsonb,
  p_discount numeric,
  p_payment_method text,
  p_cash_received numeric,
  p_change numeric
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_txn_number text;
  v_sale_id bigint;
  v_line record;
  v_item public.items%rowtype;
  v_subtotal numeric := 0;
  v_total numeric;
  v_by_id uuid := (select auth.uid());
  v_by_name text;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'A sale needs at least one item';
  end if;

  select name into v_by_name from public.profiles where id = v_by_id;

  -- Check every line before changing anything, so a sale is all-or-nothing.
  for v_line in select * from jsonb_to_recordset(p_items)
    as x(item_id bigint, name text, qty numeric, unit_price numeric, line_total numeric)
  loop
    select * into v_item from public.items where id = v_line.item_id;
    if not found then
      raise exception 'An item in the cart no longer exists';
    end if;
    if v_line.qty > v_item.stock then
      raise exception 'Not enough % — only % left', v_item.name, v_item.stock;
    end if;
    v_subtotal := v_subtotal + v_line.line_total;
  end loop;

  v_total := greatest(0, v_subtotal - coalesce(p_discount, 0));
  v_txn_number := public.next_doc_number('SALE');

  insert into public.sales
    (txn_number, cashier_id, cashier_name, subtotal, discount, total,
     payment_method, cash_received, change, status)
  values
    (v_txn_number, v_by_id, v_by_name, v_subtotal, coalesce(p_discount, 0), v_total,
     p_payment_method, p_cash_received, p_change, 'completed')
  returning id into v_sale_id;

  for v_line in select * from jsonb_to_recordset(p_items)
    as x(item_id bigint, name text, qty numeric, unit_price numeric, line_total numeric)
  loop
    select * into v_item from public.items where id = v_line.item_id;

    insert into public.sale_items (sale_id, item_id, name, qty, unit_price, line_total)
    values (v_sale_id, v_item.id, v_line.name, v_line.qty, v_line.unit_price, v_line.line_total);

    update public.items set stock = stock - v_line.qty where id = v_item.id;

    insert into public.activity
      (item_id, name, category, type, reason, qty, unit, cost, selling, by_user_id, by_name, ref)
    values
      (v_item.id, v_item.name, v_item.category, 'out', 'sold', v_line.qty, v_item.unit,
       v_item.cost, v_item.selling, v_by_id, v_by_name, v_txn_number);
  end loop;

  return v_sale_id;
end;
$$;

grant execute on function public.complete_sale(jsonb, numeric, text, numeric, numeric) to authenticated;


