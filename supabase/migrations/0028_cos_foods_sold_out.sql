-- ============================================================
-- 0028: replace "guess a Target Servings number in advance" with an
-- explicit, cashier-controlled "Sold Out" flag on cos_foods.
--
-- The old design tied a Menu Plan food's POS stock to
-- (servings − served), so an inaccurate upfront guess caused two
-- opposite problems: guess too low and the food shows "Sold Out" on
-- POS while real food is still left in the pot; guess too high and
-- POS never reflects that it actually ran out. A real kitchen rarely
-- knows the exact yield in advance.
--
-- New model: a food defaults to an effectively unlimited POS stock
-- (see COS_UNLIMITED_STOCK in js/menu-plan/21-cos.js) and stays
-- sellable until the cashier explicitly taps "Sold Out" on its POS
-- tile — no number to predict, no need to come back and correct one.
-- ============================================================

alter table public.cos_foods add column sold_out boolean not null default false;
