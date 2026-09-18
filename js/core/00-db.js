/* ===== js/core/00-db.js =====
   Supabase persistence helpers shared across feature files, plus the
   row <-> app-object mappers that let every existing render function
   keep reading the exact same camelCase shape it always has, even
   though the database itself uses snake_case columns.

   The pattern used throughout the app from here on: a mutation site
   keeps its local `state.x` array update (for instant UI feedback,
   unchanged from before) and additionally awaits one of the db*()
   functions below to persist it. */

/* ---------- images (Supabase Storage) ---------- */

const PRODUCT_IMAGES_BUCKET = 'product-images';

function publicImageUrl(path){
  if(!path) return null;
  return sb.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl;
}

/* dataUrl: a "data:image/...;base64,..." string, e.g. from resizeImageFile().
   pathHint: a short, filesystem-safe label for the object path. */
async function dbUploadImage(dataUrl, pathHint){
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const ext = (blob.type.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '');
  const path = `${pathHint}-${Date.now()}.${ext}`;
  const { error } = await sb.storage.from(PRODUCT_IMAGES_BUCKET)
    .upload(path, blob, { upsert: true, contentType: blob.type });
  if(error) throw error;
  return path;
}

async function dbDeleteImage(path){
  if(!path) return;
  await sb.storage.from(PRODUCT_IMAGES_BUCKET).remove([path]);
}

/* ---------- items ---------- */

function mapItemRow(r){
  return {
    id: r.id, category: r.category, name: r.name, size: r.size || '',
    stock: Number(r.stock), unit: r.unit, cost: Number(r.cost),
    selling: r.selling == null ? null : Number(r.selling),
    threshold: Number(r.threshold),
    maxStock: r.max_stock == null ? null : Number(r.max_stock),
    sku: r.sku || '',
    supplierId: r.supplier_id,
    conv: (r.conv_unit && r.conv_qty != null) ? { unit: r.conv_unit, qty: Number(r.conv_qty) } : null,
    imagePath: r.image_path,
    image: publicImageUrl(r.image_path),
    sourcePlanId: r.source_plan_id,
    sourceFoodId: r.source_food_id
  };
}

/* Maps the full camelCase item shape (as built by openItemModal) to DB columns. */
function itemToRow(o){
  return {
    category: o.category, name: o.name, size: o.size || '',
    stock: o.stock, unit: o.unit, cost: o.cost, selling: o.selling,
    threshold: o.threshold, max_stock: o.maxStock, sku: o.sku || '',
    supplier_id: o.supplierId ?? null,
    conv_unit: o.conv ? o.conv.unit : null,
    conv_qty: o.conv ? o.conv.qty : null,
    image_path: o.imagePath ?? null,
    source_plan_id: o.sourcePlanId ?? null,
    source_food_id: o.sourceFoodId ?? null
  };
}

async function dbInsertItem(o){
  const { data, error } = await sb.from('items').insert(itemToRow(o)).select().single();
  if(error) throw error;
  return mapItemRow(data);
}

async function dbUpdateItem(id, o){
  const { data, error } = await sb.from('items').update(itemToRow(o)).eq('id', id).select().single();
  if(error) throw error;
  return mapItemRow(data);
}

async function dbUpdateItemStock(id, newStock){
  const { error } = await sb.from('items').update({ stock: newStock }).eq('id', id);
  if(error) throw error;
}

async function dbUpdateItemStockCost(id, newStock, newCost){
  const { error } = await sb.from('items').update({ stock: newStock, cost: newCost }).eq('id', id);
  if(error) throw error;
}

async function dbDeleteItem(id){
  const { error } = await sb.from('items').delete().eq('id', id);
  if(error) throw error;
}

/* ---------- suppliers ---------- */

function mapSupplierRow(r){
  return {
    id: r.id, name: r.name, contact: r.contact || '', phone: r.phone || '',
    email: r.email || '', address: r.address || '', notes: r.notes || '',
    status: r.status, createdAt: new Date(r.created_at).getTime()
  };
}

function supplierToRow(o){
  return {
    name: o.name, contact: o.contact || '', phone: o.phone || '',
    email: o.email || '', address: o.address || '', notes: o.notes || '',
    status: o.status
  };
}

async function dbInsertSupplier(o){
  const { data, error } = await sb.from('suppliers').insert(supplierToRow(o)).select().single();
  if(error) throw error;
  return mapSupplierRow(data);
}

async function dbUpdateSupplier(id, o){
  const { data, error } = await sb.from('suppliers').update(supplierToRow(o)).eq('id', id).select().single();
  if(error) throw error;
  return mapSupplierRow(data);
}

async function dbDeleteSupplier(id){
  const { error } = await sb.from('suppliers').delete().eq('id', id);
  if(error) throw error;
}

/* ---------- purchases ---------- */

function mapPurchaseRow(r){
  return {
    id: r.id, poNumber: r.po_number, supplierId: r.supplier_id,
    receivedBy: r.received_by || '', notes: r.notes || '',
    totalCost: Number(r.total_cost), createdAt: new Date(r.created_at).getTime(),
    lines: (r.purchase_lines || []).map(l => ({
      itemId: l.item_id, name: l.name, unit: l.unit || '',
      qty: Number(l.qty), unitCost: Number(l.unit_cost)
    }))
  };
}

/* draft: [{itemId, name, unit, qty, unitCost}]. Runs as one atomic
   Postgres function (0015_storage_and_purchases.sql) — stock/cost
   updates, the activity rows, and the purchase record all happen
   together or not at all. */
async function dbCompletePurchase({ supplierId, receivedBy, notes, draft }){
  const { data: purchaseId, error } = await sb.rpc('complete_purchase', {
    p_supplier_id: supplierId,
    p_received_by: receivedBy,
    p_notes: notes,
    p_lines: draft.map(l => ({ item_id: l.itemId, qty: l.qty, unit_cost: l.unitCost }))
  });
  if(error) throw error;

  const { data, error: fetchErr } = await sb.from('purchases')
    .select('*, purchase_lines(*)').eq('id', purchaseId).single();
  if(fetchErr) throw fetchErr;
  return mapPurchaseRow(data);
}

/* ---------- activity (the stock-movement log) ---------- */

function mapActivityRow(r){
  return {
    id: r.id, ts: new Date(r.ts).getTime(), itemId: r.item_id, name: r.name,
    category: r.category, type: r.type, reason: r.reason, qty: Number(r.qty),
    unit: r.unit, cost: r.cost == null ? null : Number(r.cost),
    selling: r.selling == null ? null : Number(r.selling),
    by: r.by_name || '—', ref: r.ref,
    voided: !!r.voided, voidReason: r.void_reason, voidedBy: r.voided_by,
    voidedAt: r.voided_at ? new Date(r.voided_at).getTime() : null
  };
}

async function dbLogActivity(item, type, qty, reason, ref){
  const row = {
    item_id: item.id, name: displayName(item), category: item.category,
    type, reason, qty, unit: item.unit, cost: item.cost, selling: item.selling,
    by_user_id: currentUser ? currentUser.id : null,
    by_name: currentUser ? currentUser.name : '—',
    ref: ref || null
  };
  const { data, error } = await sb.from('activity').insert(row).select().single();
  if(error) throw error;
  return mapActivityRow(data);
}

async function dbVoidActivity(id, reason){
  const { error } = await sb.rpc('void_activity', {
    p_activity_id: id, p_reason: reason, p_by: currentUser ? currentUser.name : '—'
  });
  if(error) throw error;
}

async function dbDeleteActivityPermanently(id){
  const { error } = await sb.rpc('delete_activity_permanently', { p_activity_id: id });
  if(error) throw error;
}

/* ---------- document numbers ---------- */

async function dbNextDocNumber(prefix){
  const { data, error } = await sb.rpc('next_doc_number', { prefix });
  if(error) throw error;
  return data;
}

/* Re-fetches the most recent activity rows and replaces state.activity
   with them. Used after any operation (a purchase, production, a sale...)
   where the server wrote activity rows the client doesn't already have
   locally — simpler and always-correct vs. trying to merge partial results. */
async function hydrateActivityTail(){
  const { data, error } = await sb.from('activity').select('*')
    .order('ts', { ascending: false }).limit(ACTIVITY_CAP);
  if(error){ toast('Could not refresh the movement log: ' + error.message, true); return; }
  state.activity = (data || []).map(mapActivityRow);
}

/* ---------- hydrate: pulls items/suppliers/purchases/activity from
   Supabase into `state`, replacing whatever loadState() put there.
   Called once at boot, after `state` already has its other fields
   (recipes, cosPlans, sales, expenses... not yet migrated) from the
   local save. ---------- */
async function hydrateFromSupabase(){
  const [itemsRes, suppliersRes, purchasesRes] = await Promise.all([
    sb.from('items').select('*').order('id'),
    sb.from('suppliers').select('*').order('name'),
    sb.from('purchases').select('*, purchase_lines(*)').order('created_at', { ascending: false }),
    hydrateActivityTail()
  ]);

  for(const res of [itemsRes, suppliersRes, purchasesRes]){
    if(res.error) toast('Could not load some data from Supabase: ' + res.error.message, true);
  }

  state.items = (itemsRes.data || []).map(mapItemRow);
  state.suppliers = (suppliersRes.data || []).map(mapSupplierRow);
  state.purchases = (purchasesRes.data || []).map(mapPurchaseRow);
}
