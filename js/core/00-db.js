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

/* ---------- recipes ---------- */

function mapRecipeRow(r){
  return {
    id: r.id, name: r.name, category: r.category, servings: Number(r.servings),
    price: r.price == null ? null : Number(r.price), linkedItemId: r.linked_item_id,
    createdAt: new Date(r.created_at).getTime(),
    lines: (r.recipe_lines || []).map(l => ({ name: l.name, qtyNum: Number(l.qty_num), qtyUnit: l.qty_unit }))
  };
}

function recipeToRow(o){
  return {
    name: o.name, category: o.category, servings: o.servings,
    price: o.price, linked_item_id: o.linkedItemId ?? null
  };
}

async function dbInsertRecipe(o){
  const { data, error } = await sb.from('recipes').insert(recipeToRow(o)).select().single();
  if(error) throw error;
  if(o.lines && o.lines.length){
    const rows = o.lines.map(l => ({ recipe_id: data.id, name: l.name, qty_num: l.qtyNum, qty_unit: l.qtyUnit }));
    const { error: lineErr } = await sb.from('recipe_lines').insert(rows);
    if(lineErr) throw lineErr;
  }
  const full = await sb.from('recipes').select('*, recipe_lines(*)').eq('id', data.id).single();
  if(full.error) throw full.error;
  return mapRecipeRow(full.data);
}

async function dbUpdateRecipe(id, o){
  const { error } = await sb.from('recipes').update(recipeToRow(o)).eq('id', id);
  if(error) throw error;
  const { error: delErr } = await sb.from('recipe_lines').delete().eq('recipe_id', id);
  if(delErr) throw delErr;
  if(o.lines && o.lines.length){
    const rows = o.lines.map(l => ({ recipe_id: id, name: l.name, qty_num: l.qtyNum, qty_unit: l.qtyUnit }));
    const { error: lineErr } = await sb.from('recipe_lines').insert(rows);
    if(lineErr) throw lineErr;
  }
  const full = await sb.from('recipes').select('*, recipe_lines(*)').eq('id', id).single();
  if(full.error) throw full.error;
  return mapRecipeRow(full.data);
}

async function dbDeleteRecipe(id){
  const { error } = await sb.from('recipes').delete().eq('id', id);
  if(error) throw error;
}

/* ---------- production ---------- */

function mapProductionRow(r){
  return {
    id: r.id, prodNumber: r.prod_number, date: new Date(r.date).getTime(),
    recipeId: r.recipe_id, recipeName: r.recipe_name, qtyProduced: Number(r.qty_produced),
    totalCost: Number(r.total_cost), producedBy: r.produced_by || '',
    ingredientsConsumed: (r.production_ingredients || []).map(i => ({
      name: i.name, qty: Number(i.qty), unit: i.unit || ''
    }))
  };
}

/* Runs complete_production() (0017_complete_production.sql) — every
   ingredient's stock, the linked item's stock/cost, all the activity
   rows, and the productions record happen atomically server-side. */
async function dbCompleteProduction({ recipeId, qtyProduced, producedBy, lines, linkedItemId, totalCost }){
  const { data: productionId, error } = await sb.rpc('complete_production', {
    p_recipe_id: recipeId,
    p_qty_produced: qtyProduced,
    p_produced_by: producedBy,
    p_ingredient_lines: lines.map(l => ({ item_id: l.item.id, name: l.name, need: l.need, unit: l.unit })),
    p_linked_item_id: linkedItemId,
    p_total_cost: totalCost
  });
  if(error) throw error;

  const { data, error: fetchErr } = await sb.from('productions')
    .select('*, production_ingredients(*)').eq('id', productionId).single();
  if(fetchErr) throw fetchErr;
  return mapProductionRow(data);
}

/* ---------- sales (POS) ---------- */

function mapSaleRow(r){
  return {
    id: r.id, txnNumber: r.txn_number, ts: new Date(r.ts).getTime(),
    cashier: r.cashier_name || '—',
    items: (r.sale_items || []).map(i => ({
      itemId: i.item_id, name: i.name, qty: Number(i.qty),
      unitPrice: Number(i.unit_price), lineTotal: Number(i.line_total)
    })),
    subtotal: Number(r.subtotal), discount: Number(r.discount), total: Number(r.total),
    paymentMethod: r.payment_method,
    cashReceived: r.cash_received == null ? null : Number(r.cash_received),
    change: r.change == null ? null : Number(r.change),
    status: r.status, voidReason: r.void_reason, voidedBy: r.voided_by,
    voidedAt: r.voided_at ? new Date(r.voided_at).getTime() : null
  };
}

/* Runs complete_sale() (0018_complete_sale.sql) — item stock, the
   activity rows, and the sale + sale_items record all happen atomically,
   with stock re-checked server-side so two terminals can't both sell the
   last unit of something at once. */
async function dbCompleteSale({ items, discount, paymentMethod, cashReceived, change }){
  const { data: saleId, error } = await sb.rpc('complete_sale', {
    p_items: items.map(i => ({
      item_id: i.itemId, name: i.name, qty: i.qty, unit_price: i.unitPrice, line_total: i.lineTotal
    })),
    p_discount: discount, p_payment_method: paymentMethod,
    p_cash_received: cashReceived, p_change: change
  });
  if(error) throw error;

  const { data, error: fetchErr } = await sb.from('sales')
    .select('*, sale_items(*)').eq('id', saleId).single();
  if(fetchErr) throw fetchErr;
  return mapSaleRow(data);
}

async function dbVoidSale(id, reason){
  const { error } = await sb.rpc('void_sale', {
    p_sale_id: id, p_reason: reason, p_by: currentUser ? currentUser.name : '—'
  });
  if(error) throw error;
}

async function dbDeleteSalePermanently(id){
  const { error } = await sb.rpc('delete_sale_permanently', { p_sale_id: id });
  if(error) throw error;
}

/* ---------- Menu Plan: plans, foods, ingredient lines ----------
   Unlike everything above, this page has no modal/Save-draft pattern —
   every keystroke mutates state directly, live. Persisting on every
   keystroke would be excessive network chatter, so field edits are
   debounced per food (scheduleCosFoodSync); explicit actions (the food's
   own Save button, add/remove a food, create/delete a plan) flush or
   write immediately instead. */

function mapCosFoodLineRow(r){
  return {
    id: r.id, name: r.name || '',
    qtyNum: r.qty_num == null ? '' : Number(r.qty_num), qtyUnit: r.qty_unit || 'pcs',
    qty: `${r.qty_num ?? ''} ${r.qty_unit || ''}`.trim(),
    priceNum: r.price_num == null ? '' : Number(r.price_num),
    priceMode: r.price_mode || 'unit', unit: '',
    total: r.total_cost == null ? 0 : Number(r.total_cost),
    manual: !!r.manual
  };
}

function mapCosFoodRow(r){
  const f = {
    id: r.id, name: r.name || '', servings: Number(r.servings) || 0, served: Number(r.served) || 0,
    price: r.price == null ? null : Number(r.price),
    pricesHidden: !!r.prices_hidden, collapsed: !!r.collapsed,
    saved: r.saved_at ? new Date(r.saved_at).getTime() : null,
    linkedItemId: r.linked_item_id,
    deducted: r.deducted || null,
    deductedAt: r.deducted_at ? new Date(r.deducted_at).getTime() : null,
    created: new Date(r.created_at).getTime(),
    lines: (r.cos_food_lines || []).map(mapCosFoodLineRow)
  };
  f.lines.forEach(l => { syncQtyText(l); syncUnitText(l); });
  return f;
}

function mapCosPlanRow(r){
  return {
    id: r.id, name: r.name, date: r.date, created: new Date(r.created_at).getTime(),
    foods: (r.cos_foods || []).map(mapCosFoodRow)
  };
}

/* planId is only meaningful (and only needed) on insert — a food never
   moves to a different plan afterward, so updates omit it entirely. */
function cosFoodToRow(f, planId){
  const row = {
    name: f.name || '', servings: f.servings || 0, served: f.served || 0,
    price: f.price, prices_hidden: !!f.pricesHidden, collapsed: !!f.collapsed,
    saved_at: f.saved ? new Date(f.saved).toISOString() : null,
    linked_item_id: f.linkedItemId ?? null,
    deducted: f.deducted ?? null,
    deducted_at: f.deductedAt ? new Date(f.deductedAt).toISOString() : null
  };
  if(planId != null) row.plan_id = planId;
  return row;
}

function cosLineToRow(l, foodId){
  return {
    food_id: foodId, name: l.name || '',
    qty_num: (l.qtyNum === '' || l.qtyNum == null) ? null : Number(l.qtyNum),
    qty_unit: l.qtyUnit || null,
    price_num: (l.priceNum === '' || l.priceNum == null) ? null : Number(l.priceNum),
    price_mode: l.priceMode || 'unit', total_cost: l.total ?? 0, manual: !!l.manual
  };
}

async function dbInsertCosPlan(name, date){
  const { data, error } = await sb.from('cos_plans').insert({ name, date }).select().single();
  if(error) throw error;
  return mapCosPlanRow({ ...data, cos_foods: [] });
}

async function dbUpdateCosPlanName(id, name){
  const { error } = await sb.from('cos_plans').update({ name }).eq('id', id);
  if(error) throw error;
}

async function dbDeleteCosPlan(id){
  const { error } = await sb.from('cos_plans').delete().eq('id', id);
  if(error) throw error;
}

async function dbInsertCosFood(planId, f){
  const { data, error } = await sb.from('cos_foods').insert(cosFoodToRow(f, planId)).select().single();
  if(error) throw error;
  return mapCosFoodRow({ ...data, cos_food_lines: [] });
}

async function dbDeleteCosFood(id){
  const { error } = await sb.from('cos_foods').delete().eq('id', id);
  if(error) throw error;
}

/* Full upsert of one food's own columns + a delete-all/insert-all of its
   lines — simplest way to keep them consistent given lines are freely
   added/reordered/removed client-side. */
async function dbSyncCosFood(food){
  const { error } = await sb.from('cos_foods').update(cosFoodToRow(food)).eq('id', food.id);
  if(error) throw error;
  const { error: delErr } = await sb.from('cos_food_lines').delete().eq('food_id', food.id);
  if(delErr) throw delErr;
  if(food.lines && food.lines.length){
    const rows = food.lines.map(l => cosLineToRow(l, food.id));
    const { error: insErr } = await sb.from('cos_food_lines').insert(rows);
    if(insErr) throw insErr;
  }
}

async function dbUpdateCosFoodServed(id, served){
  const { error } = await sb.from('cos_foods').update({ served }).eq('id', id);
  if(error) throw error;
}

const COS_SYNC_DEBOUNCE_MS = 800;
const cosSyncTimers = new Map();   // food.id -> timeout handle

/* Debounced autosave for live Menu Plan edits — cancels and restarts on
   every call for the same food, so it only actually writes once typing
   pauses. Explicit actions (Save button, delete) should flush/act
   immediately instead of going through this. */
function scheduleCosFoodSync(food){
  const key = food.id;
  if(cosSyncTimers.has(key)) clearTimeout(cosSyncTimers.get(key));
  const handle = setTimeout(async ()=>{
    cosSyncTimers.delete(key);
    try{
      await dbSyncCosFood(food);
    }catch(err){
      toast('Could not save Menu Plan changes: ' + err.message, true);
    }
  }, COS_SYNC_DEBOUNCE_MS);
  cosSyncTimers.set(key, handle);
}

function flushCosFoodSync(food){
  if(cosSyncTimers.has(food.id)){
    clearTimeout(cosSyncTimers.get(food.id));
    cosSyncTimers.delete(food.id);
  }
}

/* ---------- hydrate: pulls items/suppliers/purchases/activity from
   Supabase into `state`, replacing whatever loadState() put there.
   Called once at boot, after `state` already has its other fields
   (recipes, cosPlans, sales, expenses... not yet migrated) from the
   local save. ---------- */
async function hydrateRecipes(){
  const { data, error } = await sb.from('recipes').select('*, recipe_lines(*)').order('name');
  if(error){ toast('Could not load Recipes: ' + error.message, true); return; }
  state.recipes = (data || []).map(mapRecipeRow);
}

async function hydrateProductions(){
  const { data, error } = await sb.from('productions')
    .select('*, production_ingredients(*)').order('date', { ascending: false });
  if(error){ toast('Could not load Production history: ' + error.message, true); return; }
  state.productions = (data || []).map(mapProductionRow);
}

async function hydrateCosPlans(){
  const { data, error } = await sb.from('cos_plans')
    .select('*, cos_foods(*, cos_food_lines(*))').order('date', { ascending: false });
  if(error){ toast('Could not load Menu Plan data: ' + error.message, true); return; }
  state.cosPlans = (data || []).map(mapCosPlanRow);
  if(!state.cosActiveId || !state.cosPlans.some(p => p.id === state.cosActiveId)){
    state.cosActiveId = state.cosPlans[0] ? state.cosPlans[0].id : null;
  }
}

async function hydrateSales(){
  const { data, error } = await sb.from('sales')
    .select('*, sale_items(*)').order('ts', { ascending: false });
  if(error){ toast('Could not load Sales History: ' + error.message, true); return; }
  state.sales = (data || []).map(mapSaleRow);
}

async function hydrateFromSupabase(){
  const [itemsRes, suppliersRes, purchasesRes] = await Promise.all([
    sb.from('items').select('*').order('id'),
    sb.from('suppliers').select('*').order('name'),
    sb.from('purchases').select('*, purchase_lines(*)').order('created_at', { ascending: false }),
    hydrateActivityTail(),
    hydrateRecipes(),
    hydrateProductions(),
    hydrateCosPlans(),
    hydrateSales()
  ]);

  for(const res of [itemsRes, suppliersRes, purchasesRes]){
    if(res.error) toast('Could not load some data from Supabase: ' + res.error.message, true);
  }

  state.items = (itemsRes.data || []).map(mapItemRow);
  state.suppliers = (suppliersRes.data || []).map(mapSupplierRow);
  state.purchases = (purchasesRes.data || []).map(mapPurchaseRow);
}
