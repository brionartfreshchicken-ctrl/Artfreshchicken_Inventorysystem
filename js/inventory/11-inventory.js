/* ===== js/inventory/11-inventory.js =====
   Inventory CRUD, stock in/out movements, and the activity log they write to.
   (Lines 1693-1928 of the original single-file build.) */

/* 11-inventory.js — Inventory CRUD, stock in/out movements, and the activity log they write to. */

/* Writes one row to the `activity` table (see js/core/00-db.js) and
   mirrors it into local state for instant rendering. Async now — every
   caller needs `await`. */
async function logActivity(item, type, qty, reason, ref){
  const rec = await dbLogActivity(item, type, qty, reason, ref);
  state.activity.unshift(rec);
  if(state.activity.length > ACTIVITY_CAP) state.activity = state.activity.slice(0, ACTIVITY_CAP);
  return rec;
}

/* Sequential, human-readable document numbers — PO-20260915-0001, and
   SALE-/PROD-/EXP- reuse the same pattern. Handed out atomically by the
   next_doc_number() Postgres function (0010_settings_sequences.sql) so
   two devices can never be given the same number. */
async function nextDocNumber(prefix){
  return dbNextDocNumber(prefix);
}

/* Reverses exactly what one activity record did to stock — used by every
   void/delete path (single or bulk) so they all agree. An 'in' movement
   added stock, so reversing removes that amount; an 'out' movement
   (every sale included) removed stock, so reversing gives it back.

   A Menu-Plan-linked food's stock is recomputed on every sync from
   (servings − served) — see syncActivePlanFoodsToPOS — so reversing a
   movement has to undo whatever THAT movement did to servings/served too,
   or the very next sync overwrites the stock reversal right back to
   whatever servings − served already says:
     - a sale reversal gives served back (openQtyModal never touches
       served for a sale — that only ever happens via POS checkout)
     - a manual Stock In/Out reversal gives servings back the other way
       (openQtyModal bumps servings by ±qty for a linked item — see
       there for why) */
function reverseMovementStock(a){
  const item = byId(a.itemId);
  if(!item) return;
  const linkedPlan = item.sourcePlanId != null
    ? cosPlans().find(p => p.id === item.sourcePlanId) : null;
  const linkedFood = linkedPlan && item.sourceFoodId != null
    ? (linkedPlan.foods||[]).find(f => f.id === item.sourceFoodId) : null;

  if(a.type === 'in'){
    item.stock = Math.max(0, item.stock - a.qty);
    if(linkedFood) linkedFood.servings = Math.max(0, (Number(linkedFood.servings)||0) - a.qty);
  }else{
    item.stock += a.qty;
    if(linkedFood){
      if(a.reason === 'sold') linkedFood.served = Math.max(0, (Number(linkedFood.served)||0) - a.qty);
      else linkedFood.servings = Math.max(0, (Number(linkedFood.servings)||0) + a.qty);
    }
  }
}

function voidMovement(id){
  if(!isAdmin()) return toast('Only an Admin can void records', true);

  const idx = state.activity.findIndex(a => a.id === id);
  if(idx < 0) return toast('That record no longer exists', true);

  const a = state.activity[idx];
  if(a.voided) return toast('That record is already voided', true);
  const item = byId(a.itemId);

  // Undoing a delivery removes stock — refuse if that would go below zero
  if(item && a.type === 'in' && item.stock - a.qty < 0){
    return toast(`Can't void this: ${item.name} would drop below zero. Correct the stock first.`, true);
  }

  const qtyText2 = `${Math.round(a.qty*100)/100} ${a.unit||''}`.trim();
  const effect = !item ? 'That item no longer exists, so no stock changes.'
    : a.type === 'in'
      ? `${qtyText2} will be taken back off ${item.name} (${item.stock} → ${Math.round((item.stock-a.qty)*100)/100}).`
      : `${qtyText2} will be returned to ${item.name} (${item.stock} → ${Math.round((item.stock+a.qty)*100)/100}).`;

  const what = (a.reason==='sold' && !a.voided)
    ? `sale of ${qtyText2} ${a.name} (revenue ${peso(lineBenta(a))})`
    : `${reasonLabel(a.reason).toLowerCase()} of ${qtyText2} ${a.name}`;

  /* Bespoke modal (not confirmAction) so we can require and validate a
     reason before the dialog closes — financial records need a reason,
     not just a click, and the record is corrected, never erased. */
  openModal('Void record',
    `<div class="hint">Void this ${escapeHtml(what)}?</div>
     <div class="hint" style="margin-top:10px;color:var(--yellow);">${escapeHtml(effect)}</div>
     <div class="field" style="margin-top:14px;"><label>Reason for voiding (required)</label>
       <input id="void-reason" type="text" placeholder="e.g. entered by mistake, customer refund"/></div>
     <div class="hint" id="void-err" style="margin-top:6px;color:var(--red);display:none;">A reason is required to void a record.</div>
     <div class="hint" style="margin-top:10px;">The record stays in the log — marked Voided, with your name, the reason and the time. It is never deleted.</div>`,
    `<button class="btn ghost" id="void-cancel">Cancel</button>
     <button class="btn danger" id="void-ok">Void Record</button>`);

  document.getElementById('void-cancel').addEventListener('click', closeModal);
  document.getElementById('void-ok').addEventListener('click', async ()=>{
    const reasonEl = document.getElementById('void-reason');
    const reason = reasonEl.value.trim();
    if(!reason){
      document.getElementById('void-err').style.display = 'block';
      reasonEl.focus();
      return;
    }
    // Re-find it: the list may have changed while the dialog was open
    const i2 = state.activity.findIndex(x => x.id === id);
    if(i2 < 0){ closeModal(); return toast('That record no longer exists', true); }
    const rec = state.activity[i2];
    try{
      await dbVoidActivity(id, reason);
    }catch(err){
      return toast(err.message || 'Could not void that record', true);
    }
    reverseMovementStock(rec);   // mirrors what void_activity() just did server-side
    rec.voided = true;
    rec.voidReason = reason;
    rec.voidedBy = currentUser ? currentUser.name : '—';
    rec.voidedAt = Date.now();
    closeModal();
    saveState();
    renderAll();
    toast('Record voided — stock adjusted, kept in the log');
  });
}

/* Permanent delete — unlike voidMovement, this actually removes the row.
   No trace survives: not the Movement Log, not Reports, not any Excel
   export. If the record hasn't been voided yet, deleting it also has to
   reverse its stock effect (same math as voiding) since nothing else
   ever will. If it's already voided, stock was reversed when it was
   voided, so deleting now just clears the log entry. */
function deleteMovementPermanently(id){
  if(!isAdmin()) return toast('Only an Admin can delete records', true);

  const idx = state.activity.findIndex(a => a.id === id);
  if(idx < 0) return toast('That record no longer exists', true);

  const a = state.activity[idx];
  const item = byId(a.itemId);
  const needsStockReversal = !a.voided;

  if(needsStockReversal && item && a.type === 'in' && item.stock - a.qty < 0){
    return toast(`Can't delete this: ${item.name} would drop below zero. Void it first, or correct the stock.`, true);
  }

  const qtyText2 = `${Math.round(a.qty*100)/100} ${a.unit||''}`.trim();
  const what = (a.reason==='sold' && !a.voided)
    ? `sale of ${qtyText2} ${a.name} (revenue ${peso(lineBenta(a))})`
    : `${reasonLabel(a.reason).toLowerCase()} of ${qtyText2} ${a.name}`;

  openModal('Delete Record Permanently',
    `<div class="hint">Permanently delete this ${escapeHtml(what)}?</div>
     ${a.voided
       ? `<div class="hint" style="margin-top:10px;">This record is already voided — its stock effect was already reversed, so deleting it now only removes the log entry.</div>`
       : `<div class="hint" style="margin-top:10px;color:var(--yellow);">This record has NOT been voided yet — deleting it will also reverse its stock effect, the same as voiding would.</div>`}
     <div class="hint" style="margin-top:10px;color:var(--red);"><strong>This cannot be undone.</strong> Unlike Void, no trace of this record is kept anywhere — not in the Movement Log, Reports, or any Excel export.</div>`,
    `<button class="btn ghost" id="delp-cancel">Cancel</button>
     <button class="btn danger" id="delp-ok">Delete Permanently</button>`);

  document.getElementById('delp-cancel').addEventListener('click', closeModal);
  document.getElementById('delp-ok').addEventListener('click', async ()=>{
    const i2 = state.activity.findIndex(x => x.id === id);
    if(i2 < 0){ closeModal(); return toast('That record no longer exists', true); }
    const rec = state.activity[i2];
    try{
      await dbDeleteActivityPermanently(id);
    }catch(err){
      return toast(err.message || 'Could not delete that record', true);
    }
    if(!rec.voided) reverseMovementStock(rec);   // mirrors what the server just did
    state.activity.splice(i2, 1);
    closeModal();
    saveState();
    renderAll();
    toast('Record permanently deleted');
  });
}

/* One listener covers both tables that show void buttons */

function renderInventory(){
  const cat = filters['inventory-cat'];
  const term = filters['inventory-search'];
  const st = filters['inventory-status'];
  const items = state.items.filter(i =>
    (cat==='all' || i.category===cat) && matchesSearch(i,term) && matchesStatus(i,st) &&
    !(i.category==='food' && i.stock<=0)   // out-of-stock food comes off Products entirely — see the hint below
  );

  /* Ingredients are never sold on their own, so Selling, Profit and Total Profit
     would only ever show a dash. Drop those columns when the filter is on
     ingredients, or when everything showing happens to be an ingredient. */
  const sellCols = !(items.length && items.every(i => i.category === 'ingredient'));

  document.getElementById('head-inventory').innerHTML =
    `<th>Product</th><th>Size</th><th>Category</th><th>Stock</th><th>Cost</th>` +
    (sellCols ? `<th>Selling</th><th>Profit</th>` : ``) +
    `<th>Total Cost</th>` +
    (sellCols ? `<th>Total Profit</th>` : ``) +
    `<th>Status</th><th>Actions</th>`;

  const cols = sellCols ? 11 : 8;
  const tbody = document.getElementById('tbl-inventory');
  const tfoot = document.getElementById('foot-inventory');

  if(items.length===0){
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${cols}">No products match your filters.</td></tr>`;
    tfoot.innerHTML = '';
    return;
  }

  tbody.innerHTML = items.map(i=>{
    const s = getStatus(i);
    const meta = [];
    if(i.sku) meta.push(`SKU ${escapeHtml(i.sku)}`);
    if(i.supplierId){
      const sup = (state.suppliers||[]).find(x=>x.id===i.supplierId);
      if(sup) meta.push(escapeHtml(sup.name));
    }
    if(i.conv && i.conv.qty>0) meta.push(`≈ ${round2(i.stock*i.conv.qty)} ${escapeHtml(i.conv.unit)} (est.)`);
    const metaLine = meta.length ? `<div class="muted" style="font-size:11px;margin-top:2px;">${meta.join(' · ')}</div>` : '';
    const thumb = i.image
      ? `<img src="${i.image}" style="width:28px;height:28px;border-radius:6px;object-fit:cover;vertical-align:middle;margin-right:8px;"/>`
      : '';
    return `<tr>
      <td>${thumb}${escapeHtml(i.name)}${metaLine}</td>
      <td>${sizeCell(i)}</td>
      <td><span class="cat-tag">${catLabel(i.category)}</span></td>
      <td>${i.stock} <span class="muted">${escapeHtml(i.unit)}</span></td>
      <td>${peso(i.cost)}</td>
      ${sellCols ? `<td>${peso(i.selling)}</td><td>${peso(tubo(i))}</td>` : ``}
      <td class="strong">${peso(totalPuhunan(i))}</td>
      ${sellCols ? `<td class="strong green-text">${peso(totalTubo(i))}</td>` : ``}
      <td><span class="status-pill"><span class="dot ${s}"></span>${statusLabel(s)}</span></td>
      <td>${rowActions(i)}</td>
    </tr>`;
  }).join('');

  tfoot.innerHTML = `<tr class="total-row">
    <td colspan="${sellCols ? 7 : 5}">TOTAL — ${items.length} product${items.length===1?'':'s'} shown</td>
    <td class="strong">${peso(sumBy(items, totalPuhunan))}</td>
    ${sellCols ? `<td class="strong green-text">${peso(sumBy(items, totalTubo))}</td>` : ``}
    <td colspan="2"></td>
  </tr>`;
}
