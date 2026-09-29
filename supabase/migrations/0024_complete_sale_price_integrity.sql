-- ============================================================
-- 0024: complete_sale() trusted the client-supplied unit_price/
-- line_total for each cart line, only checking that qty didn't
-- exceed stock. The real POS UI always sends the item's own
-- `selling` price, but nothing server-side enforced that — a
-- signed-in Staff/Cashier account with the technical means to call
-- this RPC directly (bypassing the POS screen) could submit a real
-- quantity (so stock deducts correctly) with a fabricated low price,
-- recording a sale worth far less than what was actually collected
-- in cash. This makes the item's own `selling` the sole source of
-- truth for price — the client can only choose WHAT and HOW MUCH,
-- never at what price.
--
-- Same signature as the 0023 version (no new parameters), so this is
-- a plain create-or-replace — no privilege/grant dance needed, the
-- existing authenticated-only grant carries over unchanged.
-- ============================================================

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
  v_line_total numeric;
  v_subtotal numeric := 0;
  v_total numeric;
  v_by_id uuid := (select auth.uid());
  v_by_name text;
begin
  if v_by_id is null then
    raise exception 'Sign in required';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'A sale needs at least one item';
  end if;
  if coalesce(p_discount, 0) < 0 or coalesce(p_extra_charge, 0) < 0 then
    raise exception 'Discount and extra charge cannot be negative';
  end if;

  select name into v_by_name from public.profiles where id = v_by_id;

  -- Check every line before changing anything, so a sale is all-or-nothing.
  -- Price comes ONLY from the item's own `selling` — the client's
  -- unit_price/line_total fields are read for logging context elsewhere
  -- in the app but are never trusted for the actual money math here.
  for v_line in select * from jsonb_to_recordset(p_items)
    as x(item_id bigint, name text, qty numeric, unit_price numeric, line_total numeric)
  loop
    select * into v_item from public.items where id = v_line.item_id;
    if not found then
      raise exception 'An item in the cart no longer exists';
    end if;
    if v_item.selling is null then
      raise exception '% has no selling price and cannot be sold', v_item.name;
    end if;
    -- A zero/negative qty was never rejected: it slips past "qty > stock"
    -- (a negative is never greater than a positive stock figure), then
    -- ADDS to stock instead of removing it (subtracting a negative) while
    -- recording negative revenue — free stock and a self-correcting books
    -- entry, from an ordinary signed-in account.
    if v_line.qty is null or v_line.qty <= 0 then
      raise exception 'Quantity must be greater than zero';
    end if;
    if v_line.qty > v_item.stock then
      raise exception 'Not enough % — only % left', v_item.name, v_item.stock;
    end if;
    v_subtotal := v_subtotal + (v_item.selling * v_line.qty);
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
    v_line_total := v_item.selling * v_line.qty;

    -- name stays client-supplied (it's the display label — e.g. "Coke
    -- (Small)" via the app's own size-suffixed name — not a money field,
    -- so there's nothing to gain by overriding it with the item's bare
    -- name and a real reason not to: it would silently drop the size).
    insert into public.sale_items (sale_id, item_id, name, qty, unit_price, line_total)
    values (v_sale_id, v_item.id, v_line.name, v_line.qty, v_item.selling, v_line_total);

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
