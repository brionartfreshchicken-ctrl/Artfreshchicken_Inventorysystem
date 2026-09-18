-- ============================================================
-- 0017: complete_production() — cooking a recipe touches every
-- ingredient's stock, the linked sellable item's stock/cost, the
-- activity rows for all of that, and the productions + production_
-- ingredients record, all at once. Same reasoning as complete_purchase.
--
-- p_ingredient_lines: jsonb array of {item_id, name, need, unit}.
-- Not admin-gated — Production is a Staff-accessible page, same as the
-- rest of Menu Plan.
-- ============================================================

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
  select name into v_by_name from public.profiles where id = v_by_id;
  select * into v_recipe from public.recipes where id = p_recipe_id;
  if not found then
    raise exception 'Recipe no longer exists';
  end if;

  v_prod_number := public.next_doc_number('PROD');

  for v_line in select * from jsonb_to_recordset(p_ingredient_lines)
    as x(item_id bigint, name text, need numeric, unit text)
  loop
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

grant execute on function public.complete_production(bigint, numeric, text, jsonb, bigint, numeric) to authenticated;
