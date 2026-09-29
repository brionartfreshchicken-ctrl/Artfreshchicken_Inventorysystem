-- ============================================================
-- 0026: table-level backstop for the four ledger/line-item tables
-- Reports trusts as ground truth — activity, sale_items,
-- purchase_lines, production_ingredients. All four allow direct
-- client inserts (activity_insert / sale_items_insert / etc. only
-- check "is this person signed in", same as items in 0025), and none
-- of them had a check keeping qty positive or cost/price
-- non-negative. A signed-in Staff account could otherwise insert a
-- fabricated row directly — e.g. a fake 'sold' activity line with
-- inflated qty to pad their own sales numbers, or a negative-cost
-- purchase_lines row — without it ever going through complete_sale()/
-- complete_purchase() or touching real stock, since Best Sellers,
-- Waste & Losses, and the Movement Log all read this data as-is.
--
-- This doesn't close that insert path entirely (this app's Stock
-- In/Out has always written activity rows directly from the client,
-- by design — see 11-inventory.js), but it does stop the specific
-- qty<=0 / negative-money version of it, the same way 0025 did for
-- items.
-- ============================================================

alter table public.activity add constraint activity_qty_positive check (qty > 0);
alter table public.activity add constraint activity_cost_nonnegative check (cost is null or cost >= 0);
alter table public.activity add constraint activity_selling_nonnegative check (selling is null or selling >= 0);

alter table public.sale_items add constraint sale_items_qty_positive check (qty > 0);
alter table public.sale_items add constraint sale_items_unit_price_nonnegative check (unit_price >= 0);
alter table public.sale_items add constraint sale_items_line_total_nonnegative check (line_total >= 0);

alter table public.purchase_lines add constraint purchase_lines_qty_positive check (qty > 0);
alter table public.purchase_lines add constraint purchase_lines_unit_cost_nonnegative check (unit_cost >= 0);

alter table public.production_ingredients add constraint production_ingredients_qty_positive check (qty > 0);
