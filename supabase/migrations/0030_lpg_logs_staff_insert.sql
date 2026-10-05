-- ============================================================
-- 0030: let Staff add an LPG Usage record, not just Admin.
--
-- LPG Usage got its own nav page (previously tucked inside the
-- Admin-only Operating Expenses page) specifically so Staff — who are
-- actually in the cafeteria and the first to notice a tank running
-- low — can log a new one themselves. They can add; they still can't
-- edit or delete an existing record (that stays Admin-only, unchanged
-- below) — matches what the UI already does (no Edit/Delete buttons
-- shown to Staff), but enforced here too so it holds even for a
-- request that bypasses the UI entirely.
-- ============================================================

drop policy if exists lpg_logs_insert on public.lpg_logs;
create policy lpg_logs_insert on public.lpg_logs
  for insert with check ((select auth.uid()) is not null);

-- update/delete unchanged — still Admin-only:
--   lpg_logs_update: using (is_admin()) with check (is_admin())
--   lpg_logs_delete: using (is_admin())
