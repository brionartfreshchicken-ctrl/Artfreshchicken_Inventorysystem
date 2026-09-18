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
