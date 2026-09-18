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
