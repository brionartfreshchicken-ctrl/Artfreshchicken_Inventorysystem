-- ============================================================
-- 0022: track who saved each Menu Plan food (the cook), so
-- Food Costing reports can show it. Set once, at Save time —
-- never overwritten by a later edit/autosave, same as `served`.
-- ============================================================

alter table public.cos_foods add column saved_by text;
