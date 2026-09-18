-- ============================================================
-- 0015: Supabase Storage bucket for product photos / the GCash QR
-- image, and complete_purchase() — completing a purchase touches
-- purchases + purchase_lines + items (stock, cost) + activity all at
-- once, so it runs as one atomic function instead of several
-- sequential client calls that could partially fail.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

create policy "product_images_public_read"
  on storage.objects for select
  using (bucket_id = 'product-images');

create policy "product_images_authenticated_write"
  on storage.objects for insert
  with check (bucket_id = 'product-images' and (select auth.uid()) is not null);

create policy "product_images_authenticated_update"
  on storage.objects for update
  using (bucket_id = 'product-images' and (select auth.uid()) is not null)
  with check (bucket_id = 'product-images' and (select auth.uid()) is not null);

create policy "product_images_authenticated_delete"
  on storage.objects for delete
  using (bucket_id = 'product-images' and (select auth.uid()) is not null);

-- p_lines: jsonb array of {item_id, qty, unit_cost}. Returns the new
-- purchase's id. Mirrors what btnCompletePurchase used to do client-side
-- in js/procurement/13-purchases.js: stock += qty, cost = unit_cost per
-- line, one 'purchase'/'in' activity row per line, one purchases header
-- row with the sum as total_cost.
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

grant execute on function public.complete_purchase(bigint, text, text, jsonb) to authenticated;
