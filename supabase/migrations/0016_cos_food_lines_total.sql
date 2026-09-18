-- ============================================================
-- 0016: a Menu Plan ingredient line's cost can be auto-calculated
-- (qty x unit price) or typed directly ("manual"), so — like the app's
-- own `total` field — it has to be stored, not just derived on read.
-- ============================================================

alter table public.cos_food_lines add column total_cost numeric;
