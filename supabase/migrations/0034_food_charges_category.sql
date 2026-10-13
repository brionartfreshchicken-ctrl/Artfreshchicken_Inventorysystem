-- ============================================================
-- 0034: add "food_charges" as a valid items.category — sellable,
-- treated exactly like "food" everywhere (shows on Point of Sale,
-- drops off Products once stock hits zero, has Size/Selling Price).
-- Purely a separate label for organizing the menu; no special
-- behavior tied to the name beyond that.
-- ============================================================

alter table public.items drop constraint items_category_check;
alter table public.items add constraint items_category_check
  check (category in ('snack', 'drink', 'food', 'food_charges', 'ingredient', 'tools'));
