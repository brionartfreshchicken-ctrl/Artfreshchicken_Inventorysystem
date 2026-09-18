-- ============================================================
-- 0011: server-side movement logic — mirrors reverseMovementStock(),
-- voidMovement() and deleteMovementPermanently() from
-- js/inventory/11-inventory.js, plus the retention purge from
-- js/reports/19-history-retention-staff-reports.js. Running these as
-- SECURITY DEFINER functions makes "reverse stock + touch the log row"
-- atomic instead of two separate client calls that could partially fail.
-- ============================================================

-- Undoes exactly what one activity record did to stock — used by both
-- void and permanent-delete below. If the record came from a Menu-Plan
-- food (items.source_food_id), the linked food's servings/served are
-- adjusted too, the same way the client-side version did.
create or replace function public.reverse_movement_stock(p_activity_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.activity%rowtype;
  it public.items%rowtype;
  fd public.cos_foods%rowtype;
  has_food boolean := false;
begin
  select * into a from public.activity where id = p_activity_id;
  if not found or a.item_id is null then
    return;
  end if;

  select * into it from public.items where id = a.item_id;
  if not found then
    return;
  end if;

  if it.source_food_id is not null then
    select * into fd from public.cos_foods where id = it.source_food_id;
    has_food := found;
  end if;

  if a.type = 'in' then
    update public.items set stock = greatest(0, stock - a.qty) where id = it.id;
    if has_food then
      update public.cos_foods set servings = greatest(0, servings - a.qty) where id = fd.id;
    end if;
  else
    update public.items set stock = stock + a.qty where id = it.id;
    if has_food then
      if a.reason = 'sold' then
        update public.cos_foods set served = greatest(0, served - a.qty) where id = fd.id;
      else
        update public.cos_foods set servings = greatest(0, servings + a.qty) where id = fd.id;
      end if;
    end if;
  end if;
end;
$$;

-- Marks a movement voided (financial records are corrected, never erased),
-- and reverses its stock effect. Admin only.
create or replace function public.void_activity(p_activity_id bigint, p_reason text, p_by text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can void records';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to void a record';
  end if;

  perform public.reverse_movement_stock(p_activity_id);

  update public.activity
    set voided = true, void_reason = p_reason, voided_by = p_by, voided_at = now()
    where id = p_activity_id and voided = false;
end;
$$;

-- Hard-deletes a movement row. If it hadn't been voided yet, reverses its
-- stock effect first (same math as void). Admin only.
create or replace function public.delete_activity_permanently(p_activity_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  was_voided boolean;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can delete records';
  end if;

  select voided into was_voided from public.activity where id = p_activity_id;
  if was_voided is null then
    return;
  end if;

  if not was_voided then
    perform public.reverse_movement_stock(p_activity_id);
  end if;

  delete from public.activity where id = p_activity_id;
end;
$$;

-- Voids every 'sold' activity line linked to a sale (matched by ref =
-- txn_number) and marks the sale itself voided. Admin only.
create or replace function public.void_sale(p_sale_id bigint, p_reason text, p_by text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.sales%rowtype;
  r record;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can void a sale';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to void a sale';
  end if;

  select * into s from public.sales where id = p_sale_id;
  if not found or s.status <> 'completed' then
    raise exception 'That sale is not available to void';
  end if;

  for r in
    select id from public.activity
    where ref = s.txn_number and reason = 'sold' and voided = false
  loop
    perform public.reverse_movement_stock(r.id);
    update public.activity
      set voided = true, void_reason = p_reason, voided_by = p_by, voided_at = now()
      where id = r.id;
  end loop;

  update public.sales
    set status = 'voided', void_reason = p_reason, voided_by = p_by, voided_at = now()
    where id = p_sale_id;
end;
$$;

-- Hard-deletes a sale and every activity line linked to it, reversing
-- stock for any line not already voided. Admin only.
create or replace function public.delete_sale_permanently(p_sale_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s_txn text;
  r record;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can delete a sale';
  end if;

  select txn_number into s_txn from public.sales where id = p_sale_id;
  if s_txn is null then
    return;
  end if;

  for r in
    select id, voided from public.activity where ref = s_txn and reason = 'sold'
  loop
    if not r.voided then
      perform public.reverse_movement_stock(r.id);
    end if;
    delete from public.activity where id = r.id;
  end loop;

  delete from public.sales where id = p_sale_id;
end;
$$;

-- Deletes activity rows older than settings.retention_days. Called once
-- at app startup (client-triggered), same timing as today.
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
