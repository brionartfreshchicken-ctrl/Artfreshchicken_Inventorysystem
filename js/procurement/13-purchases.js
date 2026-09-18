/* ===== js/procurement/13-purchases.js =====
   Purchases: PO documents, line items, receiving stock and updating item cost.
   (Lines 2061-2225 of the original single-file build.) */

/* ============================= PURCHASES ============================= */
/* Spec item 9. A Purchase is a real document — supplier, one or more
   lines, a PO number — not just a "purchase" reason tag on a stock
   movement. Completing one still writes the same activity/movement rows
   Stock In always has (so Reports and the Movement Log need no special
   case for it), it just also updates each item's cost to the price just
   paid, and keeps a proper header+lines record for Purchase History. */

let purchaseDraft = [];   // [{itemId, name, unit, qty, unitCost}]

function renderPurchaseItemOptions(){
  const sel = document.getElementById('pu-item');
  if(!sel) return;
  sel.innerHTML = state.items
    .slice()
    .sort((a,b)=>displayName(a).localeCompare(displayName(b)))
    .map(i=>`<option value="${i.id}">${escapeHtml(pickerLabel(i))} — ${i.stock} ${escapeHtml(i.unit)} on hand</option>`)
    .join('');
}

function renderPurchaseDraftTable(){
  const body = document.getElementById('tbl-purchase-draft');
  if(!body) return;
  if(!purchaseDraft.length){
    body.innerHTML = `<tr class="empty-row"><td colspan="5">No lines added yet.</td></tr>`;
  }else{
    body.innerHTML = purchaseDraft.map((l,idx)=>`<tr>
      <td>${escapeHtml(l.name)}</td>
      <td>${l.qty} <span class="muted">${escapeHtml(l.unit)}</span></td>
      <td class="num">${peso(l.unitCost)}</td>
      <td class="num strong">${peso(l.qty*l.unitCost)}</td>
      <td class="num"><button class="btn small danger" data-rm-line="${idx}">×</button></td>
    </tr>`).join('');
  }
  const total = purchaseDraft.reduce((t,l)=>t+l.qty*l.unitCost,0);
  document.getElementById('pu-draft-total').textContent =
    purchaseDraft.length ? `${purchaseDraft.length} line${purchaseDraft.length===1?'':'s'} · Total ${peso(total)}` : '';
}

function renderPurchases(){
  const supSel = document.getElementById('pu-supplier');
  if(!supSel) return;   // guard for any build without this page
  const keepSupplier = supSel.value;
  supSel.innerHTML = `<option value="">— Select a supplier —</option>` +
    (state.suppliers||[]).filter(s=>s.status!=='inactive')
      .map(s=>`<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  if(keepSupplier) supSel.value = keepSupplier;

  renderPurchaseItemOptions();
  renderPurchaseDraftTable();

  const list = (state.purchases||[]).slice().sort((a,b)=>b.createdAt-a.createdAt);
  document.getElementById('pu-histcount').textContent =
    list.length ? `${list.length} purchase${list.length===1?'':'s'}` : '';
  document.getElementById('tbl-purchases').innerHTML = list.length
    ? list.map(p=>{
        const sup = (state.suppliers||[]).find(s=>s.id===p.supplierId);
        return `<tr>
          <td>${escapeHtml(p.poNumber)}</td>
          <td class="muted">${new Date(p.createdAt).toLocaleDateString()}</td>
          <td>${escapeHtml(sup ? sup.name : '—')}</td>
          <td>${p.lines.length}</td>
          <td class="num strong">${peso(p.totalCost)}</td>
          <td class="muted">${escapeHtml(p.receivedBy||'—')}</td>
          <td><button class="btn small" data-view-po="${p.id}">View</button></td>
        </tr>`;
      }).join('')
    : `<tr class="empty-row"><td colspan="7">No purchases recorded yet.</td></tr>`;
}

document.getElementById('btnAddPurchaseLine').addEventListener('click', ()=>{
  const itemId = Number(document.getElementById('pu-item').value);
  const item = byId(itemId);
  const qty = parseFloat(document.getElementById('pu-qty').value);
  const unitCostRaw = document.getElementById('pu-unitcost').value;
  const unitCost = unitCostRaw==='' ? (item?item.cost:0) : parseFloat(unitCostRaw);

  if(!item){ toast('Please select a product', true); return; }
  if(isNaN(qty) || qty<=0){ toast('Enter a quantity greater than 0', true); return; }
  if(isNaN(unitCost) || unitCost<0){ toast('Enter a valid unit cost', true); return; }

  purchaseDraft.push({ itemId: item.id, name: displayName(item), unit: item.unit, qty, unitCost });
  document.getElementById('pu-qty').value = 1;
  document.getElementById('pu-unitcost').value = '';
  renderPurchaseDraftTable();
});

document.getElementById('tbl-purchase-draft').addEventListener('click', e=>{
  const btn = e.target.closest('[data-rm-line]');
  if(!btn) return;
  purchaseDraft.splice(Number(btn.dataset.rmLine), 1);
  renderPurchaseDraftTable();
});

document.getElementById('btnClearPurchase').addEventListener('click', ()=>{
  purchaseDraft = [];
  renderPurchaseDraftTable();
});

document.getElementById('btnCompletePurchase').addEventListener('click', async ()=>{
  const supplierId = document.getElementById('pu-supplier').value;
  const receivedBy = document.getElementById('pu-receivedby').value.trim() || (currentUser?currentUser.name:'—');
  const notes = document.getElementById('pu-notes').value.trim();

  if(!supplierId){ toast('Please select a supplier', true); return; }
  if(!purchaseDraft.length){ toast('Add at least one line first', true); return; }

  const draft = purchaseDraft.map(l=>({...l}));

  // complete_purchase() (0015_storage_and_purchases.sql) does the PO
  // number, the purchase + lines, and every item's stock/cost + activity
  // row atomically — see there for why this isn't several client calls.
  let purchase;
  try{
    purchase = await dbCompletePurchase({ supplierId: Number(supplierId), receivedBy, notes, draft });
  }catch(err){
    toast(err.message || 'Could not record that purchase', true);
    return;
  }

  // Mirror what the server just did, for instant UI feedback without a re-fetch.
  draft.forEach(l=>{
    const item = byId(l.itemId);
    if(!item) return;
    item.stock += l.qty;
    item.cost = l.unitCost;
  });
  state.purchases.unshift(purchase);
  await hydrateActivityTail();   // pick up the activity rows the RPC just wrote

  purchaseDraft = [];
  document.getElementById('pu-notes').value = '';
  saveState();
  renderAll();
  toast(`${purchase.poNumber} recorded — ${peso(purchase.totalCost)}, stock updated`);
});

document.getElementById('tbl-purchases').addEventListener('click', e=>{
  const btn = e.target.closest('[data-view-po]');
  if(!btn) return;
  const p = state.purchases.find(x=>x.id===Number(btn.dataset.viewPo));
  if(!p) return;
  const sup = (state.suppliers||[]).find(s=>s.id===p.supplierId);
  const body = `
    <div class="hint">Supplier: <strong style="color:var(--text)">${escapeHtml(sup?sup.name:'—')}</strong></div>
    <div class="hint">Date: ${new Date(p.createdAt).toLocaleString()}</div>
    <div class="hint">Received By: ${escapeHtml(p.receivedBy||'—')}</div>
    ${p.notes ? `<div class="hint">Notes: ${escapeHtml(p.notes)}</div>` : ''}
    <table style="margin-top:12px;"><thead><tr>
      <th>Product</th><th>Qty</th><th class="num">Unit Cost</th><th class="num">Total</th>
    </tr></thead><tbody>
      ${p.lines.map(l=>`<tr>
        <td>${escapeHtml(l.name)}</td>
        <td>${l.qty} ${escapeHtml(l.unit)}</td>
        <td class="num">${peso(l.unitCost)}</td>
        <td class="num">${peso(l.qty*l.unitCost)}</td>
      </tr>`).join('')}
    </tbody><tfoot><tr class="total-row">
      <td colspan="3">TOTAL</td><td class="num strong">${peso(p.totalCost)}</td>
    </tr></tfoot></table>
  `;
  openModal(p.poNumber, body, `<button class="btn ghost" id="f-cancel">Close</button>`);
  document.getElementById('f-cancel').addEventListener('click', closeModal);
});
