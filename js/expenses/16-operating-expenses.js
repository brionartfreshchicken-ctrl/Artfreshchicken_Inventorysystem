/* ===== js/expenses/16-operating-expenses.js =====
   Operating Expenses: categories, amounts, feeding the Profit & Loss Net Profit figure.
   (Lines 2582-2728 of the original single-file build.) */

/* ============================= OPERATING EXPENSES ============================= */
/* Spec item 18. Feeds Reports > Profit & Loss, which is the only place
   Gross Profit − Operating Expenses = Net Profit is computed — see
   renderProfitability() further down. */

function renderExpenses(){
  const body = document.getElementById('tbl-expenses');
  if(!body) return;
  const term = (filters['expenses-search']||'').toLowerCase();
  const cat = filters['expenses-cat'] || 'all';
  const list = (state.expenses||[])
    .filter(e => (cat==='all' || e.category===cat) && (!term || (e.description||'').toLowerCase().includes(term)))
    .sort((a,b)=>b.date - a.date);

  if(!list.length){
    body.innerHTML = `<tr class="empty-row"><td colspan="8">No expenses recorded yet.</td></tr>`;
    document.getElementById('foot-expenses').innerHTML = '';
    return;
  }

  body.innerHTML = list.map(e=>`<tr>
    <td>${escapeHtml(e.expenseNumber)}</td>
    <td class="muted">${new Date(e.date).toLocaleDateString()}</td>
    <td><span class="cat-tag">${escapeHtml(e.category)}</span></td>
    <td>${escapeHtml(e.description||'')}</td>
    <td class="num strong">${peso(e.amount)}</td>
    <td>${paymentLabel(e.paymentMethod)}</td>
    <td class="muted">${escapeHtml(e.recordedBy||'—')}</td>
    <td>
      <button class="btn small" data-edit-expense="${e.id}">Edit</button>
      <button class="btn small danger" data-del-expense="${e.id}">Delete</button>
    </td>
  </tr>`).join('');

  const total = list.reduce((t,e)=>t+e.amount,0);
  document.getElementById('foot-expenses').innerHTML = `<tr class="total-row">
    <td colspan="4">TOTAL — ${list.length} expense${list.length===1?'':'s'} shown</td>
    <td class="num strong">${peso(total)}</td><td colspan="3"></td>
  </tr>`;
}

function openExpenseModal(mode, expense){
  const isEdit = mode==='edit';
  const categories = ['Salaries','LPG','Electricity','Water','Rent','Internet','Cleaning Supplies',
    'Packaging','Transportation','Maintenance','Office Supplies','Other'];
  const body = `
    <div class="field-row">
      <div class="field"><label>Date</label>
        <input id="ex-date" type="date" value="${expense?isoDate(new Date(expense.date)):isoDate(new Date())}"/></div>
      <div class="field"><label>Category</label>
        <select id="ex-category">
          ${categories.map(c=>`<option ${expense&&expense.category===c?'selected':''}>${c}</option>`).join('')}
        </select></div>
    </div>
    <div class="field"><label>Description</label>
      <input id="ex-desc" placeholder="e.g. June electricity bill" value="${expense?escapeHtml(expense.description||''):''}"/></div>
    <div class="field-row">
      <div class="field"><label>Amount</label>
        <input id="ex-amount" type="number" min="0" step="any" placeholder="0.00" value="${expense?expense.amount:''}"/></div>
      <div class="field"><label>Payment Method</label>
        <select id="ex-paymethod">
          <option value="cash" ${!expense||expense.paymentMethod==='cash'?'selected':''}>Cash</option>
          <option value="gcash" ${expense&&expense.paymentMethod==='gcash'?'selected':''}>GCash</option>
          <option value="card" ${expense&&expense.paymentMethod==='card'?'selected':''}>Card</option>
          <option value="other" ${expense&&expense.paymentMethod==='other'?'selected':''}>Other</option>
        </select></div>
    </div>
    <div class="field"><label>Recorded By</label>
      <input id="ex-recordedby" value="${expense?escapeHtml(expense.recordedBy||''):(currentUser?escapeHtml(currentUser.name):'')}"/></div>
    <div class="field"><label>Notes <span class="muted">(optional)</span></label>
      <input id="ex-notes" value="${expense?escapeHtml(expense.notes||''):''}"/></div>
  `;
  const foot = `<button class="btn ghost" id="f-cancel">Cancel</button>
    <button class="btn primary" id="f-save">${isEdit?'Save Changes':'Add Expense'}</button>`;
  openModal(isEdit?'Edit Expense':'Add Expense', body, foot);
  document.getElementById('f-cancel').addEventListener('click', closeModal);
  document.getElementById('f-save').addEventListener('click', async ()=>{
    const dateRaw = document.getElementById('ex-date').value;
    const amount = parseFloat(document.getElementById('ex-amount').value);
    const description = document.getElementById('ex-desc').value.trim();
    if(!dateRaw){ toast('Please choose a date', true); return; }
    if(isNaN(amount) || amount<=0){ toast('Enter an amount greater than 0', true); return; }

    const data = {
      date: new Date(dateRaw+'T00:00:00').getTime(),
      category: document.getElementById('ex-category').value,
      description,
      amount,
      paymentMethod: document.getElementById('ex-paymethod').value,
      recordedBy: document.getElementById('ex-recordedby').value.trim() || (currentUser?currentUser.name:'—'),
      notes: document.getElementById('ex-notes').value.trim()
    };
    try{
      if(isEdit){
        const updated = await dbUpdateExpense(expense.id, { ...expense, ...data });
        Object.assign(expense, updated);
        toast('Expense updated');
      }else{
        const expenseNumber = await nextDocNumber('EXP');
        const created = await dbInsertExpense({ expenseNumber, ...data });
        state.expenses.push(created);
        toast('Expense added');
      }
    }catch(err){
      toast(err.message || 'Could not save that expense', true);
      return;
    }
    saveState();
    renderAll();
    closeModal();
  });
}

function confirmDeleteExpense(expense){
  openModal('Delete Expense',
    `<div class="hint">Delete <strong style="color:var(--text)">${escapeHtml(expense.expenseNumber)}</strong> —
       ${escapeHtml(expense.category)}, ${peso(expense.amount)}?</div>
     <div class="hint" style="margin-top:10px;color:var(--yellow);">This cannot be undone.</div>`,
    `<button class="btn ghost" id="f-cancel">Cancel</button><button class="btn danger" id="f-del">Delete</button>`);
  document.getElementById('f-cancel').addEventListener('click', closeModal);
  document.getElementById('f-del').addEventListener('click', async ()=>{
    try{
      await dbDeleteExpense(expense.id);
    }catch(err){
      return toast(err.message || 'Could not delete that expense', true);
    }
    state.expenses = state.expenses.filter(e=>e.id!==expense.id);
    saveState(); renderAll(); closeModal();
    toast('Expense deleted');
  });
}

document.getElementById('btnAddExpense').addEventListener('click', ()=>openExpenseModal('add'));

document.getElementById('tbl-expenses').addEventListener('click', e=>{
  const editBtn = e.target.closest('[data-edit-expense]');
  if(editBtn){
    const ex = state.expenses.find(x=>x.id===Number(editBtn.dataset.editExpense));
    if(ex) openExpenseModal('edit', ex);
    return;
  }
  const delBtn = e.target.closest('[data-del-expense]');
  if(delBtn){
    const ex = state.expenses.find(x=>x.id===Number(delBtn.dataset.delExpense));
    if(ex) confirmDeleteExpense(ex);
  }
});

function rowActions(i){
  const sizeBtn = i.category==='ingredient' ? '' :
    `<button class="btn small ghost" data-act="size" data-id="${i.id}" title="Add another size of ${escapeHtml(i.name)}">⧉ Add Size</button>`;
  return `<div class="row-actions">
    <button class="btn small" data-act="in" data-id="${i.id}" title="Add stock for ${escapeHtml(i.name)}">+ Stock In</button>
    <button class="btn small ghost" data-act="out" data-id="${i.id}" title="Remove stock for ${escapeHtml(i.name)}">− Stock Out</button>
    ${sizeBtn}
    <button class="btn small ghost" data-act="edit" data-id="${i.id}" title="Edit ${escapeHtml(i.name)}">✎ Edit</button>
    <button class="btn small danger" data-act="del" data-id="${i.id}" title="Delete ${escapeHtml(i.name)}">× Delete</button>
  </div>`;
}
