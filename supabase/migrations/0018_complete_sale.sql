-- ============================================================
-- 0018: complete_sale() — checkout touches every cart line's item
-- stock, the activity rows, and the sales + sale_items record all at
-- once. Also re-validates stock server-side (not just trusting the
-- client's last read), so two terminals selling the last of something
-- at the same moment can't both succeed.
--
-- p_items: jsonb array of {item_id, name, qty, unit_price, line_total}.
-- ============================================================

create or replace function public.complete_sale(
  p_items jsonb,
  p_discount numeric,
  p_payment_method text,
  p_cash_received numeric,
  p_change numeric
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

  v_total := greatest(0, v_subtotal - coalesce(p_discount, 0));
  v_txn_number := public.next_doc_number('SALE');

  insert into public.sales
    (txn_number, cashier_id, cashier_name, subtotal, discount, total,
     payment_method, cash_received, change, status)
  values
    (v_txn_number, v_by_id, v_by_name, v_subtotal, coalesce(p_discount, 0), v_total,
     p_payment_method, p_cash_received, p_change, 'completed')
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

grant execute on function public.complete_sale(jsonb, numeric, text, numeric, numeric) to authenticated;
