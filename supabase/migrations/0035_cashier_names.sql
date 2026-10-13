-- ============================================================
-- 0035: "Served By" — an optional roster of plain names (not full
-- accounts) that Admin maintains in Settings, so a sale can record
-- WHO actually handled it even on a shared terminal logged in under
-- one Staff account. Off by default (unlike the Staff Access
-- toggles, this is brand-new behavior, not an existing one being
-- made optional) — Admin turns it on deliberately, then the POS
-- dropdown becomes required before a sale can complete.
-- ============================================================

create table public.cashier_names (
  id bigint generated always as identity primary key,
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.cashier_names enable row level security;

create policy "cashier_names_select" on public.cashier_names
  for select using ((select auth.uid()) is not null);
create policy "cashier_names_insert" on public.cashier_names
  for insert with check (public.is_admin());
create policy "cashier_names_delete" on public.cashier_names
  for delete using (public.is_admin());
-- No update policy — a name is added or removed, never edited in place.

alter table public.settings add column served_by_enabled boolean not null default false;

alter table public.sales add column served_by_name text;

-- Adding a parameter makes create-or-replace define a new overload
-- instead of replacing the 7-arg version from 0024 — drop that
-- signature explicitly first, same as 0023 did.
drop function if exists public.complete_sale(jsonb, numeric, text, numeric, numeric, numeric, text);

create or replace function public.complete_sale(
  p_items jsonb,
  p_discount numeric,
  p_payment_method text,
  p_cash_received numeric,
  p_change numeric,
  p_extra_charge numeric default 0,
  p_extra_charge_label text default null,
  p_served_by_name text default null
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
     served_by_name, total, payment_method, cash_received, change, status)
  values
    (v_txn_number, v_by_id, v_by_name, v_subtotal, coalesce(p_discount, 0),
     coalesce(p_extra_charge, 0), nullif(trim(p_extra_charge_label), ''),
     nullif(trim(p_served_by_name), ''),
     v_total, p_payment_method, p_cash_received, p_change, 'completed')
  returning id into v_sale_id;

  for v_line in select * from jsonb_to_recordset(p_items)
    as x(item_id bigint, name text, qty numeric, unit_price numeric, line_total numeric)
  loop
    select * into v_item from public.items where id = v_line.item_id;
    v_line_total := v_item.selling * v_line.qty;

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

revoke execute on function public.complete_sale(jsonb, numeric, text, numeric, numeric, numeric, text, text) from public;
revoke execute on function public.complete_sale(jsonb, numeric, text, numeric, numeric, numeric, text, text) from anon;
grant execute on function public.complete_sale(jsonb, numeric, text, numeric, numeric, numeric, text, text) to authenticated;
