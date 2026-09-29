-- ============================================================
-- 0025: same class of gap as 0024, in the other two money-and-stock
-- RPCs — neither complete_purchase() nor complete_production() ever
-- rejected a zero/negative quantity, unit cost, or produced amount.
-- A negative qty in a purchase line REDUCES stock while logging it as
-- an 'in'/'purchase' movement; a negative unit_cost drags the item's
-- cost negative, corrupting every profit figure that reads it
-- afterward. complete_production() trusted p_qty_produced and
-- p_total_cost outright, so a negative or zero produced amount could
-- manufacture stock from nothing or erase it, and a negative total
-- cost does the same to the linked item's cost as above.
--
-- Same signatures as before (no new parameters) — plain
-- create-or-replace, existing grants carry over unchanged.
-- ============================================================

create or replace function public.complete_purchase(
  p_supplier_id bigint,
  p_received_by text,
  p_notes text,
  p_lines jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po_number text;
  v_purchase_id bigint;
  v_total numeric := 0;
  v_line record;
  v_item public.items%rowtype;
  v_by_name text;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can record a purchase';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'A purchase needs at least one line';
  end if;

  select name into v_by_name from public.profiles where id = (select auth.uid());
  v_po_number := public.next_doc_number('PO');

  for v_line in select * from jsonb_to_recordset(p_lines) as x(item_id bigint, qty numeric, unit_cost numeric)
  loop
    if v_line.qty is null or v_line.qty <= 0 then
      raise exception 'Quantity must be greater than zero';
    end if;
    if v_line.unit_cost is null or v_line.unit_cost < 0 then
      raise exception 'Unit cost cannot be negative';
    end if;
    v_total := v_total + v_line.qty * v_line.unit_cost;
  end loop;

  insert into public.purchases (po_number, supplier_id, received_by, notes, total_cost)
  values (v_po_number, p_supplier_id, p_received_by, p_notes, v_total)
  returning id into v_purchase_id;

  for v_line in select * from jsonb_to_recordset(p_lines) as x(item_id bigint, qty numeric, unit_cost numeric)
  loop
    select * into v_item from public.items where id = v_line.item_id;
    if not found then
      raise exception 'Item % no longer exists', v_line.item_id;
    end if;

    insert into public.purchase_lines (purchase_id, item_id, name, unit, qty, unit_cost)
    values (v_purchase_id, v_item.id, v_item.name, v_item.unit, v_line.qty, v_line.unit_cost);

    update public.items
      set stock = stock + v_line.qty, cost = v_line.unit_cost
      where id = v_item.id;

    insert into public.activity
      (item_id, name, category, type, reason, qty, unit, cost, selling, by_user_id, by_name, ref)
    values
      (v_item.id, v_item.name, v_item.category, 'in', 'purchase', v_line.qty, v_item.unit,
       v_line.unit_cost, v_item.selling, (select auth.uid()), v_by_name, v_po_number);
  end loop;

  return v_purchase_id;
end;
$$;

create or replace function public.complete_production(
  p_recipe_id bigint,
  p_qty_produced numeric,
  p_produced_by text,
  p_ingredient_lines jsonb,
  p_linked_item_id bigint,
  p_total_cost numeric
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prod_number text;
  v_production_id bigint;
  v_line record;
  v_item public.items%rowtype;
  v_by_name text;
  v_by_id uuid := (select auth.uid());
  v_recipe public.recipes%rowtype;
  v_linked_cost numeric;
begin
  if v_by_id is null then
    raise exception 'Sign in required';
  end if;
  if p_qty_produced is null or p_qty_produced <= 0 then
    raise exception 'Quantity produced must be greater than zero';
  end if;
  if coalesce(p_total_cost, 0) < 0 then
    raise exception 'Total cost cannot be negative';
  end if;

  select name into v_by_name from public.profiles where id = v_by_id;
  select * into v_recipe from public.recipes where id = p_recipe_id;
  if not found then
    raise exception 'Recipe no longer exists';
  end if;

  v_prod_number := public.next_doc_number('PROD');

  for v_line in select * from jsonb_to_recordset(p_ingredient_lines)
    as x(item_id bigint, name text, need numeric, unit text)
  loop
    if v_line.need is null or v_line.need <= 0 then
      raise exception 'Ingredient quantity must be greater than zero';
    end if;

    select * into v_item from public.items where id = v_line.item_id;
    if not found then
      raise exception 'Ingredient item % no longer exists', v_line.item_id;
    end if;
    if v_line.need > v_item.stock then
      raise exception 'Not enough % on hand', v_item.name;
    end if;

    update public.items set stock = round((stock - v_line.need)::numeric, 3) where id = v_item.id;

    insert into public.activity
      (item_id, name, category, type, reason, qty, unit, cost, selling, by_user_id, by_name, ref)
    values
      (v_item.id, v_item.name, v_item.category, 'out', 'used', v_line.need, v_item.unit,
       v_item.cost, v_item.selling, v_by_id, v_by_name, v_prod_number);
  end loop;

  if p_linked_item_id is not null then
    select * into v_item from public.items where id = p_linked_item_id;
    if found then
      v_linked_cost := case when p_qty_produced > 0 then p_total_cost / p_qty_produced else v_item.cost end;
      update public.items set stock = stock + p_qty_produced, cost = v_linked_cost where id = v_item.id;

      insert into public.activity
        (item_id, name, category, type, reason, qty, unit, cost, selling, by_user_id, by_name, ref)
      values
        (v_item.id, v_item.name, v_item.category, 'in', 'produced', p_qty_produced, v_item.unit,
         v_linked_cost, v_item.selling, v_by_id, v_by_name, v_prod_number);
    end if;
  end if;

  insert into public.productions (prod_number, date, recipe_id, recipe_name, qty_produced, total_cost, produced_by)
  values (v_prod_number, now(), p_recipe_id, v_recipe.name, p_qty_produced, p_total_cost, p_produced_by)
  returning id into v_production_id;

  insert into public.production_ingredients (production_id, name, qty, unit)
  select v_production_id, x.name, x.need, x.unit
  from jsonb_to_recordset(p_ingredient_lines) as x(item_id bigint, name text, need numeric, unit text);

  return v_production_id;
end;
$$;

-- Table-level backstop for `items`, on top of the RPC-level checks above.
-- Sale/Purchase/Production go through the SECURITY DEFINER functions
-- above, but Add/Edit Product and Stock In/Out write items.stock/cost
-- directly from the client (no RPC in between) — RLS only checks WHO is
-- writing, never WHAT value. This catches an invalid value regardless of
-- which path it comes from, present or future. If this fails to apply,
-- it means a row already violates it (e.g. a leftover negative from
-- testing) — the error will name which constraint, fix that row's value
-- and re-run this ALTER.
alter table public.items add constraint items_stock_nonnegative check (stock >= 0);
alter table public.items add constraint items_cost_nonnegative check (cost >= 0);
alter table public.items add constraint items_selling_nonnegative check (selling is null or selling >= 0);
alter table public.items add constraint items_threshold_nonnegative check (threshold >= 0);
