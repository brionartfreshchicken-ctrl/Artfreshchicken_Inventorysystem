/* ===== js/procurement/12-suppliers.js =====
   Suppliers directory: add/edit/delete, products-supplied and total-purchases (computed live).
   (Lines 1929-2060 of the original single-file build.) */

/* ============================= SUPPLIERS ============================= */
/* Spec item 10. Just a directory — "Products Supplied" and "Total
   Purchases" are computed live from items/purchases, never stored, so
   they can never drift out of sync with the records that back them. */

function renderSuppliers(){
  const body = document.getElementById('tbl-suppliers');
  if(!body) return;
  const term = (filters['suppliers-search']||'').toLowerCase();
  const list = (state.suppliers||[])
    .filter(s => !term || s.name.toLowerCase().includes(term))
    .sort((a,b)=>a.name.localeCompare(b.name));

  if(!list.length){
    body.innerHTML = `<tr class="empty-row"><td colspan="7">No suppliers yet.</td></tr>`;
    return;
  }

  body.innerHTML = list.map(s=>{
    const productsSupplied = state.items.filter(i=>i.supplierId===s.id).length;
    const totalPurchases = (state.purchases||[])
      .filter(p=>p.supplierId===s.id)
      .reduce((t,p)=>t+p.totalCost,0);
    return `<tr>
      <td>${escapeHtml(s.name)}</td>
      <td>${escapeHtml(s.contact||'—')}</td>
      <td>${escapeHtml(s.phone||'—')}</td>
      <td class="num">${productsSupplied}</td>
      <td class="num">${peso(totalPurchases)}</td>
      <td><span class="status-pill"><span class="dot ${s.status==='inactive'?'out':'in'}"></span>${s.status==='inactive'?'Inactive':'Active'}</span></td>
      <td>
        <button class="btn small" data-edit-supplier="${s.id}">Edit</button>
        <button class="btn small danger" data-del-supplier="${s.id}">Delete</button>
      </td>
    </tr>`;
  }).join('');
}

function openSupplierModal(mode, supplier){
  const isEdit = mode==='edit';
  const body = `
    <div class="field"><label>Supplier Name</label>
      <input id="sp-name" placeholder="e.g. Mega Meats Trading" value="${supplier?escapeHtml(supplier.name):''}"/></div>
    <div class="field-row">
      <div class="field"><label>Contact Person <span class="muted">(optional)</span></label>
        <input id="sp-contact" value="${supplier?escapeHtml(supplier.contact||''):''}"/></div>
      <div class="field"><label>Phone <span class="muted">(optional)</span></label>
        <input id="sp-phone" value="${supplier?escapeHtml(supplier.phone||''):''}"/></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Email <span class="muted">(optional)</span></label>
        <input id="sp-email" type="email" value="${supplier?escapeHtml(supplier.email||''):''}"/></div>
      <div class="field"><label>Status</label>
        <select id="sp-status">
          <option value="active" ${!supplier||supplier.status!=='inactive'?'selected':''}>Active</option>
          <option value="inactive" ${supplier&&supplier.status==='inactive'?'selected':''}>Inactive</option>
        </select></div>
    </div>
    <div class="field"><label>Address <span class="muted">(optional)</span></label>
      <input id="sp-address" value="${supplier?escapeHtml(supplier.address||''):''}"/></div>
    <div class="field"><label>Notes <span class="muted">(optional)</span></label>
      <input id="sp-notes" value="${supplier?escapeHtml(supplier.notes||''):''}"/></div>
  `;
  const foot = `<button class="btn ghost" id="f-cancel">Cancel</button>
    <button class="btn primary" id="f-save">${isEdit?'Save Changes':'Add Supplier'}</button>`;
  openModal(isEdit?'Edit Supplier':'Add Supplier', body, foot);
  document.getElementById('f-cancel').addEventListener('click', closeModal);
  document.getElementById('f-save').addEventListener('click', async ()=>{
    const name = document.getElementById('sp-name').value.trim();
    if(!name){ toast('Please enter a supplier name', true); return; }
    const data = {
      name,
      contact: document.getElementById('sp-contact').value.trim(),
      phone: document.getElementById('sp-phone').value.trim(),
      email: document.getElementById('sp-email').value.trim(),
      address: document.getElementById('sp-address').value.trim(),
      status: document.getElementById('sp-status').value,
      notes: document.getElementById('sp-notes').value.trim(),
    };
    try{
      if(isEdit){
        const updated = await dbUpdateSupplier(supplier.id, data);
        Object.assign(supplier, updated);
        toast('Supplier updated');
      }else{
        const created = await dbInsertSupplier(data);
        state.suppliers.push(created);
        toast('Supplier added');
      }
    }catch(err){
      toast(err.message || 'Could not save that supplier', true);
      return;
    }
    saveState();
    renderAll();
    closeModal();
  });
}

function confirmDeleteSupplier(supplier){
  const linkedItems = state.items.filter(i=>i.supplierId===supplier.id).length;
  const linkedPurchases = (state.purchases||[]).filter(p=>p.supplierId===supplier.id).length;
  const body = `
    <div class="hint">Delete <strong style="color:var(--text)">${escapeHtml(supplier.name)}</strong>?</div>
    ${(linkedItems||linkedPurchases) ? `
      <div class="hint" style="margin-top:12px;color:var(--yellow);line-height:1.6;">
        ${linkedItems} product${linkedItems===1?'':'s'} and ${linkedPurchases} past purchase${linkedPurchases===1?'':'s'}
        currently reference this supplier. They are not deleted — they'll just show
        no supplier name once this is gone.
      </div>` : ''}
  `;
  const foot = `<button class="btn ghost" id="f-cancel">Cancel</button><button class="btn danger" id="f-del">Delete</button>`;
  openModal('Delete Supplier', body, foot);
  document.getElementById('f-cancel').addEventListener('click', closeModal);
  document.getElementById('f-del').addEventListener('click', async ()=>{
    try{
      await dbDeleteSupplier(supplier.id);
    }catch(err){
      toast(err.message || 'Could not delete that supplier', true);
      return;
    }
    state.suppliers = state.suppliers.filter(s=>s.id!==supplier.id);
    saveState();
    renderAll();
    closeModal();
    toast('Supplier deleted');
  });
}

document.getElementById('btnAddSupplier').addEventListener('click', ()=>openSupplierModal('add'));

document.getElementById('tbl-suppliers').addEventListener('click', e=>{
  const editBtn = e.target.closest('[data-edit-supplier]');
  if(editBtn){
    const s = state.suppliers.find(x=>x.id===Number(editBtn.dataset.editSupplier));
    if(s) openSupplierModal('edit', s);
    return;
  }
  const delBtn = e.target.closest('[data-del-supplier]');
  if(delBtn){
    const s = state.suppliers.find(x=>x.id===Number(delBtn.dataset.delSupplier));
    if(s) confirmDeleteSupplier(s);
  }
});
