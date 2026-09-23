-- ============================================================
-- 0021: add "tools" as a valid items.category (non-food supplies —
-- paper rolls, cutters, gloves, etc. Not sellable, not an ingredient.)
-- ============================================================

alter table public.items drop constraint items_category_check;
alter table public.items add constraint items_category_check
  check (category in ('snack', 'drink', 'food', 'ingredient', 'tools'));
