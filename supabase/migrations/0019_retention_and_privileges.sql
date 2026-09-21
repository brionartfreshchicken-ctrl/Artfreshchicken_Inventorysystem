-- ============================================================
-- 0019: purge_old_activity() gets its own auth check (it had none —
-- everything else in 0011 self-gates via is_admin(), but a scheduled/
-- automatic purge has no "role" of its own, just "someone is signed
-- in"), and every RPC added since Phase 1 gets its PUBLIC execute
-- privilege tightened to authenticated-only. CREATE FUNCTION grants
-- EXECUTE to PUBLIC (which includes the anonymous role) by default
-- unless revoked — most of these already self-gate via is_admin() so
-- an anonymous caller couldn't do anything through them anyway, but
-- next_doc_number() and purge_old_activity() didn't have that
-- backstop, so this closes the gap explicitly instead of relying on
-- "nothing anonymous would want to call it".
-- ============================================================

create or replace function public.purge_old_activity()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff timestamptz;
  days integer;
  removed integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in required';
  end if;

  select retention_days into days from public.settings where id = true;
  if days is null or days <= 0 then
    return 0;
  end if;

  cutoff := now() - (days || ' days')::interval;
  delete from public.activity where ts < cutoff;
  get diagnostics removed = row_count;

  update public.settings set last_purge = now() where id = true;
  return removed;
end;
$$;

revoke execute on function public.next_doc_number(text) from public;
grant execute on function public.next_doc_number(text) to authenticated;

revoke execute on function public.reverse_movement_stock(bigint) from public;
grant execute on function public.reverse_movement_stock(bigint) to authenticated;

revoke execute on function public.void_activity(bigint, text, text) from public;
grant execute on function public.void_activity(bigint, text, text) to authenticated;

revoke execute on function public.delete_activity_permanently(bigint) from public;
grant execute on function public.delete_activity_permanently(bigint) to authenticated;

revoke execute on function public.void_sale(bigint, text, text) from public;
grant execute on function public.void_sale(bigint, text, text) to authenticated;

revoke execute on function public.delete_sale_permanently(bigint) from public;
grant execute on function public.delete_sale_permanently(bigint) to authenticated;

revoke execute on function public.complete_purchase(bigint, text, text, jsonb) from public;
grant execute on function public.complete_purchase(bigint, text, text, jsonb) to authenticated;

revoke execute on function public.complete_production(bigint, numeric, text, jsonb, bigint, numeric) from public;
grant execute on function public.complete_production(bigint, numeric, text, jsonb, bigint, numeric) to authenticated;

revoke execute on function public.complete_sale(jsonb, numeric, text, numeric, numeric) from public;
grant execute on function public.complete_sale(jsonb, numeric, text, numeric, numeric) to authenticated;

revoke execute on function public.purge_old_activity() from public;
grant execute on function public.purge_old_activity() to authenticated;
