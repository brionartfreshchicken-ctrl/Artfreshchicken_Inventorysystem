-- ============================================================
-- 0005: close the circular reference — a Menu Plan food, once saved,
-- mirrors itself as a sellable POS item (items.source_food_id), and
-- that same food remembers which item it produced (cos_foods.linked_item_id).
-- ============================================================

alter table public.cos_foods
  add constraint cos_foods_linked_item_id_fkey
  foreign key (linked_item_id) references public.items(id) on delete set null;
