-- ============================================================
-- 0032: let Admin switch Staff access to specific feature areas
-- on/off from Settings, without touching code — Products, Point of
-- Sale, and Food Costing (Menu Plan) each get their own flag.
--
-- All three default to true, matching exactly what Staff could
-- already reach before this migration — nothing changes for an
-- existing shop until an Admin deliberately flips one off.
--
-- This is a workflow/UX control, not a security boundary: existing
-- RLS policies on items/sales/cos_* already allow a signed-in Staff
-- account to read and write these tables, and that does not change
-- here. Turning a toggle off only hides the page and blocks the
-- client-side route — the same "hide the link, also block the
-- route" pattern already used for every other role-gated page in
-- this app (see navigate() in 10-nav-dashboard.js).
-- ============================================================

alter table public.settings add column staff_products_enabled boolean not null default true;
alter table public.settings add column staff_pos_enabled boolean not null default true;
alter table public.settings add column staff_foodcosting_enabled boolean not null default true;
