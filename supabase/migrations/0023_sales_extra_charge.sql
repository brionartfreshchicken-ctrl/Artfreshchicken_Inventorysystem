-- ============================================================
-- 0023: an optional extra charge on a sale (e.g. a cooking fee for
-- eggs the customer wants fried) — the mirror of `discount`, added
-- to the total instead of subtracted. Not tied to any item/stock,
-- so it doesn't appear in Best Sellers/By Category (same treatment
-- discount already gets — see complete_sale()'s header comment).
-- ============================================================

alter table public.sales add column extra_charge numeric not null default 0;
alter table public.sales add column extra_charge_label text;

-- Adding parameters (even with defaults) makes create-or-replace define a
-- SECOND overload instead of replacing this one — an unnamed 5-arg call
-- would then match both and Postgres would refuse it as ambiguous. Drop
-- the old signature explicitly first.
drop function if exists public.complete_sale(jsonb, numeric, text, numeric, numeric);

create or replace function public.complete_sale(
  p_items jsonb,
  p_discount numeric,
  p_payment_method text,
  p_cash_received numeric,
  p_change numeric,
  p_extra_charge numeric default 0,
  p_extra_charge_label text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_txn_number text;
  v_sale_id bigint;
  v_line record;
  v_item public.items%rowtype;
  v_subtotal numeric := 0;
  v_total numeric;
  v_by_id uuid := (select auth.uid());
  v_by_name text;
begin
  -- create-or-replace with a changed parameter list defines this as a new
  -- function object, and Postgres grants EXECUTE to PUBLIC by default on
  -- creation — the explicit revoke below closes that, but this check is
  -- the real backstop: complete_sale() has no is_admin() gate (any signed-
  -- in Staff can check out a sale), so an auth check is the only thing
  -- standing between this and an anonymous caller minting fake sales and
  -- decrementing real stock using nothing but the public anon key.
  if v_by_id is null then
    raise exception 'Sign in required';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'A sale needs at least one item';
  end if;

  select name into v_by_name from public.profiles where id = v_by_id;

  -- Check every line before changing anything, so a sale is all-or-nothing.
  for v_line in select * from jsonb_to_recordset(p_items)
    as x(item_id bigint, name text, qty numeric, unit_price numeric, line_total numeric)
  loop
    select * into v_item from public.items where id = v_line.item_id;
    if not found then
      raise exception 'An item in the cart no longer exists';
    end if;
    if v_line.qty > v_item.stock then
      raise exception 'Not enough % — only % left', v_item.name, v_item.stock;
    end if;
    v_subtotal := v_subtotal + v_line.line_total;
  end loop;

  v_total := greatest(0, v_subtotal - coalesce(p_discount, 0) + coalesce(p_extra_charge, 0));
  v_txn_number := public.next_doc_number('SALE');

  insert into public.sales
    (txn_number, cashier_id, cashier_name, subtotal, discount, extra_charge, extra_charge_label,
     total, payment_method, cash_received, change, status)
  values
    (v_txn_number, v_by_id, v_by_name, v_subtotal, coalesce(p_discount, 0),
     coalesce(p_extra_charge, 0), nullif(trim(p_extra_charge_label), ''),
     v_total, p_payment_method, p_cash_received, p_change, 'completed')
  returning id into v_sale_id;

  for v_line in select * from jsonb_to_recordset(p_items)
    as x(item_id bigint, name text, qty numeric, unit_price numeric, line_total numeric)
  loop
    select * into v_item from public.items where id = v_line.item_id;

    insert into public.sale_items (sale_id, item_id, name, qty, unit_price, line_total)
    values (v_sale_id, v_item.id, v_line.name, v_line.qty, v_line.unit_price, v_line.line_total);

    update public.items set stock = stock - v_line.qty where id = v_item.id;

    insert into public.activity
      (item_id, name, category, type, reason, qty, unit, cost, selling, by_user_id, by_name, ref)
    values
      (v_item.id, v_item.name, v_item.category, 'out', 'sold', v_line.qty, v_item.unit,
       v_item.cost, v_item.selling, v_by_id, v_by_name, v_txn_number);
  end loop;

  return v_sale_id;
end;
$$;

-- New function object (different signature) => Postgres defaults its
-- EXECUTE privilege to PUBLIC on creation. Must be revoked explicitly,
-- same as 0019 did for the 5-arg version this replaces — otherwise an
-- unauthenticated request (the anon key alone) could call this.
revoke execute on function public.complete_sale(jsonb, numeric, text, numeric, numeric, numeric, text) from public;
grant execute on function public.complete_sale(jsonb, numeric, text, numeric, numeric, numeric, text) to authenticated;
