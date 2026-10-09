-- ============================================================
-- 0033: a fourth Staff Access toggle, covering the "Other" nav
-- section — Staff Time Clock and LPG Usage together, since they're
-- grouped as one section in the sidebar (see index.html). Same
-- pattern as 0032: defaults to true, workflow control only, not a
-- security boundary.
-- ============================================================

alter table public.settings add column staff_other_enabled boolean not null default true;
