-- ============================================================
-- 0020: bulk void/delete for a date range of activity records —
-- used by both "Void Records in Range" (Sales History page) and
-- "Void/Delete All in Range" (Stock Movements page). Void-in-range is
-- deliberately NOT the same as the single-record void_activity(): the
-- app's own existing behavior for a bulk void is to mark records
-- voided WITHOUT reversing stock ("Your current stock levels stay
-- exactly as they are... correct individual items on the Products
-- page if stock needs fixing too") — only a bulk DELETE reverses stock
-- for any record that wasn't already voided, same as single-record
-- delete does.
-- ============================================================

create or replace function public.void_activity_range(p_ids bigint[], p_reason text, p_by text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated integer;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can void records';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to void these records';
  end if;

  update public.activity
    set voided = true, void_reason = p_reason, voided_by = p_by, voided_at = now()
    where id = any(p_ids) and voided = false;
  get diagnostics updated = row_count;
  return updated;
end;
$$;

create or replace function public.delete_activity_range(p_ids bigint[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_voided boolean;
  removed integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can delete records';
  end if;

  foreach v_id in array p_ids loop
    select voided into v_voided from public.activity where id = v_id;
    if v_voided is null then continue; end if;
    if not v_voided then
      perform public.reverse_movement_stock(v_id);
    end if;
    delete from public.activity where id = v_id;
    removed := removed + 1;
  end loop;

  return removed;
end;
$$;

grant execute on function public.void_activity_range(bigint[], text, text) to authenticated;
grant execute on function public.delete_activity_range(bigint[]) to authenticated;
